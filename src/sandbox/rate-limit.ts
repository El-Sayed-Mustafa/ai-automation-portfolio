export interface RateLimitOptions {
  windowMs: number;
  perAddress: number;
  everyone: number;
  /** Addresses remembered at once. Past it, the oldest windows are dropped. */
  maxKeys?: number;
}

export interface RateDecision {
  ok: boolean;
  /** Which limit refused the request, when one did. */
  scope?: "address" | "everyone";
  retryAfterMs: number;
  remaining: number;
}

interface Window {
  start: number;
  count: number;
}

/**
 * A fixed-window counter held in memory.
 *
 * It bounds what one address can ask for and, separately, what everyone
 * together can: the second limit is the one that holds when the address is
 * forged or missing. Counters live in this process only. A deployment that
 * runs several instances gets these limits per instance, which the
 * architecture notes say plainly.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const maxKeys = options.maxKeys ?? 5_000;
  const windows = new Map<string, Window>();
  let everyone: Window = { start: 0, count: 0 };

  function current(window: Window | undefined, now: number): Window {
    return window && now - window.start < options.windowMs ? window : { start: now, count: 0 };
  }

  function prune(now: number): void {
    for (const [key, window] of windows) {
      if (now - window.start >= options.windowMs) windows.delete(key);
    }
    // Still too many live windows: drop the oldest. A Map iterates in insertion order.
    for (const key of windows.keys()) {
      if (windows.size <= maxKeys) break;
      windows.delete(key);
    }
  }

  return {
    /** Counts one request for `key` at time `now` (milliseconds), or refuses it. */
    take(key: string, now: number): RateDecision {
      everyone = current(everyone, now);
      if (everyone.count >= options.everyone) {
        return { ok: false, scope: "everyone", retryAfterMs: everyone.start + options.windowMs - now, remaining: 0 };
      }
      const mine = current(windows.get(key), now);
      if (mine.count >= options.perAddress) {
        return { ok: false, scope: "address", retryAfterMs: mine.start + options.windowMs - now, remaining: 0 };
      }
      mine.count += 1;
      everyone.count += 1;
      windows.delete(key);
      windows.set(key, mine);
      if (windows.size > maxKeys) prune(now);
      return { ok: true, retryAfterMs: 0, remaining: options.perAddress - mine.count };
    },
    /** How many addresses are being counted right now. */
    get size(): number {
      return windows.size;
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
