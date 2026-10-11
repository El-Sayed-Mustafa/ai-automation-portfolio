# Elsayed Mustafa: engineering portfolio

An interactive portfolio that shows systems rather than describing them. Each
case study has an explorable architecture diagram and a workflow you can run,
break and inspect.

Three rules shape everything here:

1. **Every claim carries its provenance.** A statement is labelled as verified in
   code, documented by the author, stated by the owner, inferred, or proposed, and
   in the engineer lens it lists the files it comes from.
2. **A simulation is always labelled as a simulation.** Demos run on invented data
   in the visitor's browser and never call a production system. One workflow can
   also run on the server against a database created for the run; a run is
   labelled "Live sandbox" only when the server really made it.
3. **Private stays private.** A private repository is never linked, and a
   parameter its owner has not published does not appear here: the demo of the
   trading platform runs on invented thresholds and says so.

## Run it

Requires Node 20.9 or newer.

```bash
npm install
npm run dev
```

Checks:

```bash
npm run lint
npm test            # unit tests: engine, scenario rules, sandbox, content contracts, colour contrast
npm run typecheck
npm run build
npm run test:e2e    # browser journeys, layout, the accessibility audit and the production checks, against the build
```

The end-to-end tests drive an installed browser rather than a downloaded one:
Edge by default, or set `PW_CHANNEL=chrome`.

Set `SITE_URL` to the deployed origin before building for production; it is used
for canonical URLs, the sitemap and Open Graph metadata.

The live sandbox uses the SQLite built into Node. Node 24 is what it is tested
on. On a Node that does not offer that module without a flag, or on a static
host, it reports itself unavailable and every demo runs as a simulation. Two optional settings:

- `SANDBOX_DISABLED=1` switches the sandbox off.
- `SANDBOX_DATA_DIR` is where the ledger of runs is kept. The default is
  `.data/` beside the app.

## How it is put together

```
content/                 Structured content. No code.
  site.json              Profile, capabilities, experience, catalogue
  projects/*.json        One manifest per case study
src/content/             Zod schema, loader, source-link helpers, the layout of the architecture diagram
src/engine/              Workflow execution: event log, reducer, session
  scenarios/<name>/      Executable scenarios (rules, seed data, program)
  registry.ts            Maps a manifest's scenarioId to its code
src/sandbox/             The live sandbox: SQL store, executor, limits, ledger
src/app/api/sandbox/     Its one route: GET status and ledger, POST a run
src/components/
  site/                  Header, mobile menu, footer, lens and theme toggles
  ui/                    Section, disclosure, evidence labels, icon tiles and tags, technology logos
  simulator/             Workflow demo UI: pipeline, controls, inspector
  architecture/          Column diagram explorer, the same diagram as a picture and drawn small, component details
  project/               Case-study tabs and panels, project rail and drawer, summary row, side column, screenshot gallery, cards
  lab/                   Automation Lab workspace
src/app/                 Routes, share images, and globals.css: the design tokens and component classes
src/lib/                 Tab and preference helpers, the share-image frame and its colours
.github/workflows/ci.yml Lint, unit tests, type check, build and browser tests on every push
scripts/screenshots.mjs  Captures every page, tab and demo state at eight widths for visual review
scripts/diagram-shots.mjs  Captures each architecture diagram in the states a reader meets
docs/                    Architecture notes, roadmap, authoring guide, handoff, screenshots of the built site
```

Routes: `/` (work, capabilities, about and contact), `/projects`,
`/projects/<id>` for each of the eight case studies, `/automation-lab`,
`/resume` (built from the same content, printable) and `/source-access`
(a request to read private source code, sent from the visitor's own mail app).

- Pages are prerendered from the manifests. An invalid manifest fails the build.
- A workflow run is an append-only event log. The UI is derived from the log, so
  replay, step-through and the timeline scrubber only move a cursor.
- Scenarios are deterministic: virtual clock, no randomness, a fresh in-memory
  database per run.

Read next:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the decisions and their trade-offs
- [docs/AUTHORING.md](docs/AUTHORING.md) to add a project or a workflow
- [docs/ROADMAP.md](docs/ROADMAP.md) for what is done and what is next
- [docs/HANDOFF.md](docs/HANDOFF.md) to run it, deploy it, maintain it, and know where it stops
- [docs/screenshots](docs/screenshots) for how the site looks at desktop, tablet and phone widths in both themes
