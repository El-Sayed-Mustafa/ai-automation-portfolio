"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nextBoundary, reduceRun } from "@/engine/reduce";
import type { ScenarioInput } from "@/engine/registry";
import { RunSession, type Scenario } from "@/engine/session";
import type { RunEvent, RunState } from "@/engine/types";
import type { SandboxRunResponse } from "@/sandbox/protocol";
import { makeRunId, playbackDelay } from "./format";
import { callSandbox } from "./sandbox-client";

/** Playback speed multiplier. 0 means "show the result immediately". */
export type Speed = 1 | 2 | 4 | 0;

/** Where a run executes: in this page, or on the server against a database. */
export type RunTarget = "browser" | "server";

/** What the server reported about the run on screen. */
export type ServerRun = Pick<SandboxRunResponse, "measured" | "database" | "ledger">;

export interface RunController {
  events: RunEvent[];
  /** Number of events currently applied to the view. */
  cursor: number;
  state: RunState;
  hasRun: boolean;
  isPlaying: boolean;
  /** The run is stopped at a human decision and the view has caught up with it. */
  awaitingDecision: boolean;
  /** The scenario has finished executing (playback may still be catching up). */
  executionFinished: boolean;
  /** Wall-clock time the scenario took to execute, in milliseconds: in this page, or measured on the server. */
  executionMs: number | null;
  /** Where the run on screen was executed. */
  origin: RunTarget;
  /** A request to the server is on its way. */
  pending: boolean;
  /** Why a run that was asked of the server was simulated here instead. */
  notice: string | null;
  /** The server's figures and tables for the run on screen, when it ran there. */
  server: ServerRun | null;
  speed: Speed;
  setSpeed(speed: Speed): void;
  /** Executes the scenario. With `paused`, playback stops after the first step. */
  run(input: ScenarioInput, faults: string[], options?: { paused?: boolean; target?: RunTarget }): void;
  step(): void;
  play(): void;
  pause(): void;
  replay(): void;
  reset(): void;
  cancel(): void;
  decide(choiceId: string): void;
  seek(cursor: number): void;
}

/** What is needed to ask the server for the next part of a run it started. */
interface RemoteRun {
  runId: string;
  input: ScenarioInput;
  faults: string[];
  decisions: string[];
}

/**
 * Owns one scenario run and its playback cursor.
 *
 * The scenario executes immediately and completely (up to the next human
 * decision). Run, Step, Replay and the timeline only move a cursor over the
 * recorded log, so what the visitor watches is always a faithful replay of
 * what was executed.
 *
 * With `sandboxScenarioId`, a run can be asked of the server instead. The
 * server sends back the same kind of log, so everything after that is the
 * same. If the server refuses or does not answer, the run is executed here and
 * `notice` says why: a visitor is never left without a demo, and is never
 * shown a simulation as a server run.
 */
export function useRun(scenario: Scenario<ScenarioInput>, sandboxScenarioId?: string): RunController {
  const sessionRef = useRef<RunSession<ScenarioInput> | null>(null);
  const remoteRef = useRef<RemoteRun | null>(null);
  /** Bumped on every run and reset, so an answer to an abandoned request is ignored. */
  const requestRef = useRef(0);
  const sequenceRef = useRef(0);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [executionMs, setExecutionMs] = useState<number | null>(null);
  const [origin, setOrigin] = useState<RunTarget>("browser");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [server, setServer] = useState<ServerRun | null>(null);

  const state = useMemo(() => reduceRun(scenario.stepIds, events.slice(0, cursor)), [scenario, events, cursor]);

  const isPlaying = playing && cursor < events.length;

  useEffect(() => {
    if (!isPlaying) return;
    if (speed === 0) {
      const id = setTimeout(() => setCursor(events.length), 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setCursor((c) => Math.min(c + 1, events.length)), playbackDelay(events[cursor]) / speed);
    return () => clearTimeout(id);
  }, [isPlaying, cursor, events, speed]);

  const runHere = useCallback(
    (input: ScenarioInput, faults: string[], paused: boolean) => {
      sequenceRef.current += 1;
      const startedAt = performance.now();
      const session = new RunSession(scenario, { runId: makeRunId(sequenceRef.current, input, faults), input, faults });
      setExecutionMs(performance.now() - startedAt);
      sessionRef.current = session;
      remoteRef.current = null;
      setOrigin("browser");
      setServer(null);
      setEvents([...session.events]);
      setCursor(paused ? nextBoundary(session.events, 0) : 0);
      setPlaying(!paused);
    },
    [scenario],
  );

  /**
   * Rebuilds, in this page, the run the server was executing: same input, same
   * faults, the decisions made so far. A scenario is deterministic, so the log
   * comes out the same and the cursor keeps its place.
   */
  const takeOver = useCallback(
    (remote: RemoteRun): RunSession<ScenarioInput> => {
      const session = new RunSession(scenario, { runId: remote.runId, input: remote.input, faults: remote.faults });
      for (const decision of remote.decisions) session.resume(decision);
      sessionRef.current = session;
      remoteRef.current = null;
      return session;
    },
    [scenario],
  );

  const run = useCallback(
    (input: ScenarioInput, faults: string[], options?: { paused?: boolean; target?: RunTarget }) => {
      const paused = Boolean(options?.paused);
      requestRef.current += 1;
      setNotice(null);
      if (options?.target !== "server" || !sandboxScenarioId) {
        setPending(false);
        runHere(input, faults, paused);
        return;
      }
      const ticket = requestRef.current;
      setPending(true);
      void callSandbox({ scenarioId: sandboxScenarioId, input, faults, decisions: [] }).then((answer) => {
        if (ticket !== requestRef.current) return;
        setPending(false);
        if (!answer.ok) {
          setNotice(`${answer.message} This run is a simulation in your browser instead.`);
          runHere(input, faults, paused);
          return;
        }
        const body = answer.body;
        sessionRef.current = null;
        // What the server ran is its normalised copy of the input; the decisions that follow must be asked with the same.
        const started = body.events[0];
        const ranWith = started?.type === "run.started" ? (started.input as ScenarioInput) : input;
        remoteRef.current = { runId: body.runId, input: ranWith, faults, decisions: [] };
        setOrigin("server");
        setServer({ measured: body.measured, database: body.database, ledger: body.ledger });
        setExecutionMs(body.measured.ms);
        setEvents(body.events);
        setCursor(paused ? nextBoundary(body.events, 0) : 0);
        setPlaying(!paused);
      });
    },
    [runHere, sandboxScenarioId],
  );

  const decide = useCallback(
    (choiceId: string) => {
      const remote = remoteRef.current;
      if (remote && sandboxScenarioId) {
        if (pending) return;
        const ticket = (requestRef.current += 1);
        setPending(true);
        void callSandbox({ scenarioId: sandboxScenarioId, input: remote.input, faults: remote.faults, decisions: [...remote.decisions, choiceId], runId: remote.runId }).then(
          (answer) => {
            if (ticket !== requestRef.current) return;
            setPending(false);
            if (answer.ok) {
              remote.decisions.push(choiceId);
              setServer({ measured: answer.body.measured, database: answer.body.database, ledger: answer.body.ledger });
              setExecutionMs(answer.body.measured.ms);
              setEvents(answer.body.events);
              setPlaying(true);
              return;
            }
            // The server stopped answering part-way. Carry on here, and say so.
            const session = takeOver(remote);
            const startedAt = performance.now();
            session.resume(choiceId);
            setExecutionMs(performance.now() - startedAt);
            setNotice(`${answer.message} The rest of this run is a simulation in your browser.`);
            setOrigin("browser");
            setServer(null);
            setEvents([...session.events]);
            setPlaying(true);
          },
        );
        return;
      }
      const session = sessionRef.current;
      if (!session?.isWaiting) return;
      const startedAt = performance.now();
      session.resume(choiceId);
      setExecutionMs((previous) => (previous ?? 0) + (performance.now() - startedAt));
      setEvents([...session.events]);
      setPlaying(true);
    },
    [pending, sandboxScenarioId, takeOver],
  );

  const cancel = useCallback(() => {
    // A server run that is waiting holds nothing on the server, so cancelling it is a local matter.
    const session = remoteRef.current ? takeOver(remoteRef.current) : sessionRef.current;
    if (!session || session.isFinished) return;
    session.cancel();
    setEvents([...session.events]);
    setCursor(session.events.length);
    setPlaying(false);
  }, [takeOver]);

  const step = useCallback(() => {
    setPlaying(false);
    setCursor((c) => nextBoundary(events, c));
  }, [events]);

  const reset = useCallback(() => {
    requestRef.current += 1;
    sessionRef.current = null;
    remoteRef.current = null;
    setEvents([]);
    setCursor(0);
    setPlaying(false);
    setExecutionMs(null);
    setOrigin("browser");
    setPending(false);
    setNotice(null);
    setServer(null);
  }, []);

  const replay = useCallback(() => {
    setCursor(0);
    setPlaying(true);
  }, []);

  const seek = useCallback(
    (next: number) => {
      setPlaying(false);
      setCursor(Math.max(0, Math.min(next, events.length)));
    },
    [events.length],
  );

  const last = events.at(-1);
  const caughtUp = cursor >= events.length;

  return {
    events,
    cursor,
    state,
    hasRun: events.length > 0,
    isPlaying,
    awaitingDecision: caughtUp && last?.type === "step.waiting",
    executionFinished: last?.type === "run.finished",
    executionMs,
    origin,
    pending,
    notice,
    server,
    speed,
    setSpeed,
    run,
    step,
    play: useCallback(() => setPlaying(true), []),
    pause: useCallback(() => setPlaying(false), []),
    replay,
    reset,
    cancel,
    decide,
    seek,
  };
}
