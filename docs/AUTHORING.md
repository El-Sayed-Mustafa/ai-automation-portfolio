# Authoring guide

## Add a case study

1. Copy `content/projects/pest-control-crm.json` to a new file and edit it. The
   schema is `src/content/schema.ts`; every field is described there.
2. Import the file in `src/content/load.ts` and add it to `PROJECT_SOURCES`.
3. Run `npm test`. The content tests check, among other things, that:
   - every edge connects two nodes that exist and no node is left unconnected;
   - every request flow is built from existing edges that join up;
   - every component cites at least one source;
   - every metric states its method and has a value or a before and after pair;
   - every decision has exactly one chosen option.
4. Run `npm run build`. The page appears at `/projects/<id>`, on the home page
   and on the work index, its workflows appear in the Automation Lab, it gets a
   share image of its own, and it is added to the sitemap.
5. Add its id to the lists at the top of `e2e/accessibility.spec.ts`,
   `e2e/production.spec.ts`, `e2e/layout.spec.ts` and
   `e2e/more-case-studies.spec.ts`, so it is audited and checked like the rest.

No component changes are needed for a new project.

A case-study card on `/projects` shows the same things for every project: a
picture, the title and `statusLabel`, the tagline, the categories and one
result with its evidence label. The engineer lens adds the problem
(`problem.text`) and the contribution (`role.text`). The result is the first
metric that has both `before` and `after`, or the first metric if none has.
Put the figure you most want compared first. A card on the
home page is shorter: the tagline, the categories that fit on one row, and a
picture. The picture is the project's first screenshot, or, when it has none,
its own architecture drawn small. Nothing else may stand in for a screenshot.

How a project is recognised and summarised:

- `icon` and `tone` pick the icon and the colour of its tile, by name. The
  lists are in `src/content/schema.ts` (`iconSchema`, `toneSchema`); the icon
  component in `src/components/ui/Icon.tsx` owns the drawing. Give each project
  its own tone so two neighbours in a list never look alike. A tone only tells
  things apart; it never means a status.
- `highlights` are three to eight lines of at most 90 characters, shown as
  "Key features" beside the study. Each repeats, in a few words, a claim that
  is made in full elsewhere on the page, and carries its own provenance.
- `statusLabel` and `roleLabel` are the status and the author's part in at
  most 34 characters each, for the row of three facts under the title and for
  the share image: "In production", "Design and development". Each must say no
  more than `status.text` and `role.text` do, in words taken from them; the
  full sentences and their evidence open under "Details".
- Write short. The short lens shows a tagline, a summary, a few bullets and a
  row of technology names; the rest is for the engineer lens or one press
  away. A line that does not help a reader decide in twenty seconds belongs in
  the engineer lens.
- The first four `metrics` are shown as "Project impact" beside the study, so
  order them by how much they say.
- The first project of `PROJECT_SOURCES` is also the picture beside the
  headline: its first three layers become cards, its fourth and fifth become
  stacks of up to three components each, and its `flows` play through them.
  Order its layers and trace its flows with that in mind. A flow needs at
  least two hops between different parts of the picture to be played.
- The home page shows the first four projects of `PROJECT_SOURCES` in full and
  lists the rest compactly. Every project appears on `/projects`, in the
  project rail and in the Automation Lab.

Where content lands on the page. A case study has six tabs, and their order
and names are fixed:

| Tab | Built from |
| --- | --- |
| Overview | `summary`, `architecture` (as a picture), the first workflow's phases, `screenshots`, `problem`, `context` (engineer lens), `solution`, `challenges` (engineer lens), `metrics`, `beforeAfter`, `stack` (names in the short lens, uses in the engineer lens) |
| Demo | `workflows` |
| Architecture | `architecture`, as the diagram and as a list, with the first workflow's phases under the diagram |
| Decisions | `decisions` |
| Limits | `limitations` |
| Evidence | `repository`, `evidence` |

## Provenance

Every claim needs one of these. Choose the weakest one that is true.

| Value | Use when |
| --- | --- |
| `code` | You read it in the source, and you can name the file |
| `documented` | The project's own docs say so and you did not re-derive it |
| `owner` | The owner states or confirms it and no file shows it |
| `inferred` | It follows from evidence but nobody has confirmed it |
| `proposed` | It does not exist yet |

Rules that keep the site honest:

- A number needs a `method`: who measured it, where, and how.
- Do not use figures from mock-ups, sample data or test fixtures.
- Something implemented but switched off is a node with `status: "disabled"`,
  not an active one.
- A weakness you read in the code goes under `limitations`, with the fix as a
  `proposal`. Never describe a proposal in the present tense.
- If a project's repository should not be linked, set
  `repository.linkSources` to `false`. References then render as plain text and
  the page offers the source on request. A private repository must have it
  `false`; a test fails otherwise.
- When a private project has a public write-up, set `repository.writeUpUrl`.
  Cite the write-up's files with a `showcase/` prefix, and say so once in the
  evidence section.
- `repository.url` and `repository.branch` may be left out when the address is
  not yours to publish, for example an employer's private repository. Give
  `name` a plain description instead. Never invent an address.
- When the only source is a public write-up, nothing in the manifest may be
  labelled `code`: you did not read the code. Use `documented` and cite the
  write-up, and say "not described in the public write-up" where it is silent.
- A weakness that is an exploitable hole in a system running for someone is
  the one thing that does not go under `limitations`. Tell the owner instead.
- Never copy a private parameter into a manifest or a scenario. If the owner's
  public write-up withholds the values, the demo uses invented ones, keeps them
  in one object, and says so in `modeNote`.
- A screenshot goes under `public/projects/<id>/` with its real pixel size, and
  only if the owner has published it or it shows nothing private. Its caption
  says where it comes from.

## Architecture

- `layers` become the columns of the diagram, left to right in the order they
  are listed, and the groups of the layer filter. Their order decides how
  readable the diagram is, so choose it with care:
  - Put layers that talk to each other next to each other. Two neighbours are
    joined by one short trunk between them; two layers further apart need a
    line over or under everything between, and those are what make a diagram
    look tangled.
  - Start with who starts things (people, a schedule) where that costs
    nothing, and put what is switched off or being replaced at an edge.
  - A system with one busy layer in the middle of everything cannot have all
    its partners beside it. Put its two busiest partners on either side.
  - `architecture-columns.test.ts` fails if a diagram needs more than five
    lines that skip a layer, or if two of them cross. When it does, reorder;
    do not raise the limit.
  - `node scripts/diagram-shots.mjs <outDir> [baseUrl] [projectId]` captures a
    diagram at rest, with a component pointed at, with a request followed and
    with every connection drawn. Look at the first one.
- You do not place anything. `src/content/architecture-columns.ts` stacks a
  layer's components in its column and routes every connection around the
  components. `nodes[].position` is no longer read; leave it out of a new
  manifest.
- A diagram stays readable up to five layers of about five components on a
  desktop. With a sixth layer it opens on the first columns and offers the
  full graph. Prefer merging two thin layers to adding a sixth.
- A workflow step's `nodeId` is what ties a stage of "How it works" to the
  components it brings forward in the diagram, so point each step at the
  component that really does the work.
- A component shows the logo of what it is built with when
  `src/components/ui/brand.ts` has a rule for it. The rule looks at the
  component's `label` first and its `technology` second, and takes the first
  technology the text names, so write the main technology first: "Streamlit,
  reading the same database", not "A dashboard in Streamlit". To add a logo,
  add a rule there; the icon set is `simple-icons`. Use a logo for a
  technology only, never for a client or an employer.
- `nodes[].kind` picks the icon and its colour when there is no logo. Use
  `actor` for a person; a person never gets a logo.
- `nodes[].technology` is the second line of a component card and is cut after
  two lines; keep it short and put the detail in `details`.
- `edges[].protocol` is shown in the system view and `edges[].data` in the
  data-flow view. `kind` is `sync`, `async`, `fallback` or `disabled`.
- `flows[].path` lists edge ids in the order a request travels. A flow is
  offered in the diagram's Data flow view, where each hop shows `edges[].data`
  and, in the engineer lens, `edges[].protocol`. Keep both to a few words.

## Add a workflow demo

A workflow has two halves that must agree: the manifest describes it, and a
scenario executes it.

1. **Write the rules** as pure functions in
   `src/engine/scenarios/<name>/rules.ts`. Each one mirrors a piece of the real
   system and names the file it was read from. Test them.
2. **Write the scenario** in `scenario.ts`. It is a generator that records what
   happens through the tracer:

   ```ts
   t.start("step.id", input);      // open a step
   t.advance(120);                 // move the virtual clock
   t.log("info", "what happened");
   t.change("table", "insert", key, null, row);
   t.ok(output);                   // or t.fail(code, message, retryInMs?)
   ```

   - To retry, call `t.fail(code, message, waitMs)`, advance the clock, and
     `t.start` the same step again.
   - To ask for a human decision, call `t.wait(prompt, choices)` and then
     `const choice = yield;`.
   - When a run ends early, call `t.skipRemaining(reason)` before `t.finish`.
   - Never read the wall clock or use randomness. Never import seed data that
     came from a real system.
3. **Register it** in `src/engine/registry.ts` with its default input, presets,
   fault ids and an input validator.
4. **Describe it** under `workflows` in the project manifest. Step ids, fault ids
   and input keys must match the scenario exactly; the content tests fail if
   they drift.
5. **Label it.** `mode` is `simulation` unless a real backend runs it, and
   `modeNote` must say plainly what is and is not real. If a step stands in for
   a model, say that the answer is scripted.
6. **Say what it shows.** `proves` is one sentence on what the run demonstrates;
   it is the first thing a visitor reads above the controls. `technologies`
   lists what the real workflow runs on and appears in the Automation Lab
   library.

The demo UI needs no change for a new workflow: scenario chips come from the
registered presets, the form from `inputs`, the failure list from `faults`, and
the decision buttons from whatever the scenario passes to `t.wait`.

Each fault is classified as `implemented` (the real system handles the case as
shown) or `limitation` (it does not, and the demo shows the real, imperfect
behaviour). Do not add a fault for behaviour you have not read in the code.

## Let the server run a workflow

A workflow can also run on the server against a database. Do this only where a
real database adds something a simulation cannot show, and where no step would
have to reach a real service.

1. **Put the scenario's data access behind a store interface**, as
   `scenarios/crm/store.ts` does, with an in-memory implementation. Every write
   returns the stored row and the scenario records that row. The existing
   scenario tests must pass unchanged.
2. **Write the SQL store** in `src/sandbox/<name>-database.ts`: a schema taken
   from the project's real one, reduced to what the workflow touches, a seed
   built from the same rows as the simulation, and prepared statements with
   bound parameters. Write down every place where the sandbox's engine differs
   from production.
3. **Register it** in `OPENERS` in `src/sandbox/executor.ts` and add the
   scenario id to `SANDBOX_SCENARIO_IDS` in `src/sandbox/protocol.ts`.
4. **Add the parity test**: every preset, decision and fault through both
   stores, with equal event logs. See `src/sandbox/sandbox.test.ts`.
5. **Describe it** under the workflow's `sandbox` in the manifest: a `note`
   that says it is not the production database and that no message is sent,
   what is `real` and what stays `simulated`. Leave `mode` as `simulation`. A
   content test fails if a workflow has `sandbox` without an executor, or the
   other way round.

Never let a sandbox send anything: no email, no message, no webhook. A step
that would do so stays simulated and is listed under `simulated`.

## Site content

`content/site.json` holds the profile, capabilities, experience, education,
certifications and the catalogue of work without an interactive page yet. A
capability's evidence line may name a `projectId`; it must exist.

A catalogue entry with `sourceOnRequest: true` gets a "Source on request" link
beside its write-up and appears in the list on `/source-access`. Set it only
when the write-up is not the source itself.

The About section of the home page is built from `about` (one paragraph),
`approach` (a short list of working principles) and the optional `seeking`
line. Write only what the owner has stated; there is no provenance label on
these, so nothing inferred belongs here.

## Checking how it looks

`node scripts/screenshots.mjs <outDir> [baseUrl] [filter]` captures every page,
every tab of a case study and the main states of the demo and the diagram at
phone, tablet, laptop, desktop, wide (1600px) and full (1920px) widths, and at
the sizes of the two reference screens (`ref`, 1672px, where the project rail
is open; `home`, 1536px), in an installed browser. The default theme is light;
`THEMES=light,dark` and `LENSES=recruiter,engineer` add the other
combinations; `WIDTHS=phone,wide` narrows the run. The server must already be
running.

`node scripts/motion-shots.mjs <outDir> [baseUrl]` is for what moves: it
captures the same spot several times, a moment apart, with motion left on.
The first script asks for reduced motion, so it never sees an animation.

`links.resume` is `/resume`, a page generated from this same content. Point it
at a file under `public/` instead to serve a PDF.
