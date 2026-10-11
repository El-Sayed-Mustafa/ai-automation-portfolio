# Architecture

## Requirements that drive the design

- A hiring manager must reach a credible, verifiable claim within seconds, so
  content pages have to be fast, static and indexable.
- A visitor must be able to run a workflow, break it and inspect it, and the UI
  must never present a simulation as a real execution.
- Adding a project must be mostly a content change.
- Running cost should stay near zero, with nothing public that can be abused.

## Options considered

| | A. Static site + in-browser engine | B. A plus a server sandbox | C. SPA + separate Python API |
| --- | --- | --- | --- |
| Content pages | Prerendered | Prerendered | Client-rendered |
| Demo execution | Deterministic scenario in the browser | Same scenario on a server, against an isolated database | Server only |
| Backend to secure and monitor | None | One function, rate-limited | A whole service |
| Running cost | None | Free tiers, with a paused-project risk | A container host |
| What it cannot do | Touch a real database or API | Survive abuse without limits | Rank well without extra prerendering |

**Chosen: A for every workflow, and B for one of them behind the same
interface.** C was rejected: two deployables, cold starts and a second runtime
to maintain, for no benefit the demo needs.

## Stack

| Concern | Choice | Reason | Rejected |
| --- | --- | --- | --- |
| Framework | Next.js 16, App Router, Cache Components | Static prerendering per route, metadata and sitemap built in, room for a route handler later | Vite SPA (weaker SEO, no server path); Astro (awkward for shared client state across islands) |
| Content | JSON manifests validated by Zod at import | Reviewable diffs, build fails on bad content, no CMS to host | A CMS (a service to run for six documents); MDX (structure is the point, not prose) |
| Diagram | React Flow, lazy-loaded | Pan, zoom and custom nodes are solved; loaded only where used | Hand-rolled SVG pan and zoom |
| Workflow view | Custom vertical pipeline | Linear workflows read best as a list; works on a phone and with a keyboard | React Flow for the pipeline too |
| Styling | Tailwind 4 with CSS-variable tokens | One token set drives light, dark and status colours | A component kit (more dependencies than components used) |
| Unit tests | Vitest | Engine, rules and content contracts are pure TypeScript | |
| Browser tests | Playwright, driving an installed browser | Covers the visitor journeys end to end without downloading a browser | Manual checking (it missed a real pointer-events bug) |

Dependencies added on top of the scaffold: `@xyflow/react`, `zod`,
`lucide-react` and `simple-icons` (the logos of the technologies a diagram
names), plus `vitest`, `@playwright/test` and `axe-core` for development.

## Execution model

```
Scenario (deterministic program)
   │  records events through a Tracer on a virtual clock
   ▼
Event log  ──reduceRun()──▶  RunState  ──▶  pipeline, inspector, timeline
   ▲
RunSession: runs until finished or until a human decision is needed
```

- **Events are the only source of truth.** `reduceRun` folds any prefix of the
  log into the state the UI renders. Run, Step, Replay, Reset and the timeline
  scrubber only move a cursor, so the visitor always watches a faithful replay
  of what was executed.
- **Scenarios are deterministic.** No wall clock, no randomness, a fresh
  in-memory database per run. The same input and faults always produce the same
  log, which is what makes the behaviour testable.
- **Human steps are real pauses.** A scenario is a generator that yields when it
  needs a decision; the session resumes it with the chosen option.
- **Content cannot inject behaviour.** A manifest names a `scenarioId`; code can
  only come from `src/engine/registry.ts`. Tests assert that a manifest's steps
  and faults match what its scenario implements.
- **Step states:** pending, running, success, failed, retrying, skipped, waiting
  for approval, cancelled.

## Live sandbox

One workflow, the CRM's enquiry-to-booking flow, can also run on the server
against a real database. The browser simulation stays the default and the
fallback; the sandbox is what a visitor gets by choosing "On the server".

```
page ── POST /api/sandbox ──▶ route handler
                               │  same origin? JSON? size? rate limit?
                               ▼
                             parse (strict shape) ──▶ scenario on the allow-list?
                               ▼
                             the scenario's own validator ──▶ normalised input
                               ▼
                             a SQLite database in memory: schema, seed
                               ▼
                             the same scenario program, on a SQL store,
                             under a budget of time, statements and events
                               ▼
                             read the tables back ──▶ close the database
                               ▼
                             ledger: scenario, preset, outcome, duration
```

**Same program, different store.** The scenario is written against a small
interface (`CrmStore`): find a lead by phone, insert an appointment, find a crew
clash. In the browser the store is arrays in memory; on the server it is SQL.
A test runs every preset, every decision and every fault through both and
requires the two event logs to be equal. Every write records the row the store
returned, so in a server run the "after" of a data change is what the database
returned from `INSERT ... RETURNING *`.

**The database.** SQLite as it ships inside Node (`node:sqlite`; Node 24 is
what is used and tested here, and on a Node that does not offer the module
without a flag the sandbox reports itself unavailable), so there is no
dependency, no service and no credential. The schema is a
reduced copy of the CRM's Postgres schema: the same seven tables, the columns
the workflow touches, and their constraints (primary and foreign keys, NOT
NULL, the outbox's unique event key, stored digits-only phone columns). Where
SQLite differs from Postgres the difference is written beside the schema.

**Isolation.** Each request gets a database of its own, created in memory from
the schema, seeded with the same invented rows as the simulation, and closed
when the request ends. Nothing one visitor writes exists for the next.

**No state between requests.** A run that stops for a human decision is not
held on the server. The page sends the decisions made so far with each request
and the server runs the scenario again from the start. A scenario is
deterministic, so it arrives at the same place. This is why there is no
session, no cookie, and nothing to expire.

**What stays simulated, and why.** The WhatsApp gateway, the Edge Function's
token check, the Apps Script job store and the email to the technician. A
public page must never be able to send a message to an address a visitor
chooses, so the sandbox has no code path that sends one. The times beside each
step stay on the scenario's virtual clock; what the server measured is shown
separately, as one figure.

| Guard | Where | What it does |
| --- | --- | --- |
| Allow-list | `src/sandbox/protocol.ts`, `executor.ts` | A request names a scenario from a fixed list. It never carries code, SQL, a table name or a recipient |
| Shape | `request.ts` | Strict schema: an unknown field is an error; 8 KB body limit, checked before parsing |
| Input | the scenario's `validate` | The same validator as the browser form. The normalised value is what runs |
| Faults and decisions | `executor.ts` | A fault must be one the scenario implements; a decision must be on offer at that moment |
| SQL | `crm-database.ts` | Prepared statements with bound parameters only |
| Rate limit | `rate-limit.ts` | 30 requests a minute for an address, 300 for everyone, counted before the body is read |
| Budget | `executor.ts`, `engine/tracer.ts` | 1.5 s, 400 statements, 2,000 events; checked before every statement and every event |
| Origin | `route.ts` | A request whose `Origin` is another site is refused |
| Errors | `route.ts` | A refusal has a code and a sentence; an unexpected error never returns its message or a stack |
| Fallback | `useRun.ts` | Refused, unreachable or slow (6 s): the run is simulated in the page, and says why |

**The ledger.** Runs are recorded in a second SQLite database, a file under
`.data/` (or `SANDBOX_DATA_DIR`, or the temporary directory, or memory if no
disk is writable). It is public, so it holds no input: the scenario, the id of
the preset or the word "custom", the fault ids, how the run ended, the count of
events and statements, and the measured time. Rows older than a day are
deleted, and only the newest 500 are kept.

**The address.** The rate limiter needs to tell callers apart. It keys on an
HMAC of the address with a salt drawn when the process starts. The address
itself is never stored, and the key means nothing after a restart.

**Honest labels.** The badge on a demo describes the run on screen. A run the
server made says "Live sandbox"; a run that was asked of the server and
simulated instead says "Simulation" and shows the reason. `mode` in the
manifest stays `simulation`, because that is what the workflow is without the
server.

**Switching it off.** `SANDBOX_DISABLED=1` makes the route answer 503 and every
demo runs as a simulation. A static host has no route at all, which the page
treats the same way.

## Lens: one page, two depths

`data-lens` on `<html>` is `recruiter` or `engineer`. CSS hides `.eng-only` or
`.rec-only` content, so switching re-renders nothing and both lenses read the
same data. An inline script applies the saved lens before first paint. Switching
keeps the reader's place by pinning the section under the top of the viewport.

The recruiter lens hides depth, never caveats: results, limitations and
evidence labels are shown in both lenses. What the engineer lens adds is the
source file behind each claim and the engineering challenges.

## Design system

All of it lives in `src/app/globals.css`. Components use the tokens and the
component classes below; nothing defines its own colour.

The look was set by the owner from two reference screens, a home page and a
project page: a cool, almost white page (`#f8faff`), white cards with a
one-pixel border and a soft shadow, navy text, one blue accent, navy for the
main action, vivid icons on pastel tiles, the real logos of the technologies
in the diagrams, and tinted diagram columns that give each layer its own
colour. Two rules came with it: say less on a screen and show more, and keep
the colours far enough apart to tell things at a glance. The references fix
the look, not the content: no project, figure or technology was taken from
them.

**Themes.** Light is the default and lives on `:root`; dark is on
`[data-theme="dark"]`. The site does not follow the system colour scheme: it is
light until the visitor chooses dark with the header toggle, and the choice is
stored. An inline script applies it before first paint.

**Tokens.** One set of names, two sets of values.

| Group | Tokens | Rule |
| --- | --- | --- |
| Surfaces | `bg`, `surface`, `surface-2`, `surface-3` | They step in lightness, so a card reads as a layer without leaning on its border |
| Lines | `line`, `line-strong`, `line-control` | `line` separates; `line-strong` outlines a labelled control; `line-control` outlines a text field at 3:1 |
| Text | `fg`, `muted`, `subtle` | All three meet WCAG AA on every surface they are used on |
| Accent | `accent`, `accent-hover`, `accent-strong`, `accent-fg`, `accent-soft` | Blue. It means "interactive" or "selected". `accent-strong` is for small text that may sit on any tinted card |
| Primary | `primary`, `primary-hover`, `primary-fg` | Navy. The one main action in a group |
| Status | `success`, `warn`, `danger`, `hold`, each with a `-soft` pair | What happened to a step |
| Tones | `tone-indigo`, `-blue`, `-teal`, `-green`, `-violet`, `-amber`, `-rose`, `-slate`, each with a `-vivid` and a `-soft` value | Only to tell things apart: a project, a layer, a kind of component, a kind of tag. Never a status. The tone itself is dark enough for small text; the vivid one is for icons, large figures and solid tiles; the soft one is the background behind them |

Colour has three jobs and they are kept apart: the accent marks what can be
pressed or is selected, a status colour says what happened, and a tone only
distinguishes one thing from another.

`data-tone="teal"` on an element sets `--tone`, `--tone-vivid` and
`--tone-soft` for everything inside it, so a tile, a tag and a column colour
themselves from one attribute. Content picks a tone and an icon by name (`tone`, `icon` in a
manifest); it never carries a colour or markup.

`src/app/tokens.test.ts` reads the stylesheet and fails if a text and background
pair drops below 4.5:1 in either theme, if a tone is unreadable as a tag or as
a figure on a card, if a vivid colour drops below 3:1 as an icon, a large
figure or a solid tile, if an evidence label drops below 4.5:1 on any tinted
card, or if the two themes define different tokens.

**Icons.** Three kinds, each with one job.

- A project has an icon chosen by name in its manifest, on a tile in the
  project's tone.
- A component of a diagram shows the logo of what it is built with, in the
  logo's own colour, when it is built with something that has one: Supabase,
  Apps Script, Gmail, Postgres, Telegram and so on. `src/components/ui/brand.ts`
  decides from the component's name first and its technology second, and takes
  the first technology the text names. A page made of HTML and served by Apps
  Script is therefore not drawn as Apps Script, and a person never gets a logo.
- A component with no logo gets an icon for the kind of thing it is, in that
  kind's colour, so a column is not one flat tint.

A logo here means "built with this" and nothing else. No client's or
employer's mark is used, and a logo is drawn in one colour, not as the
company's multi-colour artwork.

In a diagram both kinds are drawn the same way: white on a filled tile in the
technology's or the kind's colour, with a soft shadow of that colour under it
on the light theme and a glow around it on the dark one (`.lit-tile`). A tile
colour is darkened, a step at a time, until a white mark on it reaches 3:1.

**Width.** A page is as wide as the window, up to 108rem, with a margin on
each side that grows with the window (`clamp(1.25rem, 4vw, 4.5rem)`). A phone
keeps its gutter; a 1920px screen is filled, not framed.

**Motion.** Four kinds, one rule for all of them.

- The first screen arrives in order (`.enter`, with `--i` for the place in
  line).
- A block eases in as it is scrolled to (`.reveal`). The animation is tied to
  scrolling in CSS (`animation-timeline: view()`), with no script; a browser
  that cannot do that shows the block as it is.
- Things answer the pointer: cards lift, tiles tilt, an arrow leans the way it
  points, a diagram component brings its connections forward.
- Two things move by themselves: the figures under the headline count up to
  their values once, and the picture beside the headline plays a request
  through the system (below).

The rule: every animation ends at `none`, so nothing keeps a transform (a
transformed ancestor would trap a fixed bottom sheet), and all of it stops for
a visitor who asked for less motion. An animation tied to scrolling has no
duration to shorten, so those are switched off by name. A block that holds a
fixed sheet, the diagram's card, is never given `.reveal`.

**The picture beside the headline** is the first case study as a hub: three
of its layers as cards, two as stacks of their components, built from the
manifest by `hubOf` on the home page. The requests traced in that case
study's diagram play through it one hop at a time. The part a hop arrives at
is lit, the part it left is marked, everything else steps back, and a length
of light runs along the line between them when the hop touches the middle
card. A hop between two parts that have no line of their own lights them one
after the other and draws nothing, so no line claims a route that is not in
the data. The line under the picture names the request and the two real
components of the hop, and says that it is a replay of recorded routes, not a
running system.

It plays only while it is on screen, it has a pause button (anything that
moves by itself for more than a few seconds needs one), and it does not play
at all under reduced motion. The button and the line beside it have a fixed
size and a fixed row, so nothing on the page moves as the words change.
A block that a link can jump to (`.reveal[id]`) only fades in: a sliding one
would be missed by the jump. It is drawn at one size and scaled to its frame
as one piece, so on a phone it is a smaller picture and not a reflowed one.

**Type.** Inter for headings and text, bold rather than extra-bold, with
slightly tight tracking on headings; IBM Plex Mono only for identifiers, paths,
payloads and timings (`.code`). A page title is 28 to 36px, a section heading
about 22px, a card heading 16 to 18px, body text 14 to 16px, a label 12 to 13px.

**Component classes.** `.btn` with `-primary` (ink), `-accent`, `-secondary`,
`-ghost` and `-sm`; `.link`; `.panel`, `.panel-inset` and `.panel-link` (a card
that is a link); `.tile` with `-sm` and `-solid` (the coloured square behind an
icon); `.tag` (a label, not a control); `.chip` (a toggle, state from
`aria-pressed`); `.segmented`; `.field`; `.tabbar` (links, state from
`aria-current`); `.tablist` and `.tab` (state from `aria-selected`);
`.eyebrow`; `.label`; `.container-page` and `.container-wide`. State comes from
ARIA attributes, so a control cannot look selected without also being announced
as selected.

**Status.** `data-status` on an element sets `--status` and `--status-soft`
for everything inside it. Steps, the progress strip, the inspector header and
the outcome banner all colour themselves from that one mapping.

**A case study is three columns and six tabs.**

- The project list is a rail against the left edge of the window, not a card
  in the page: every project with its icon, two lines and its tags, a search,
  and the current project marked. From 1660px it is open; from 1280px it is a
  strip of icons that opens on request; below that it is a drawer opened from
  an "All projects" button. Folding or opening it is stored
  (`html[data-rail]`, restored before first paint), so the page does not jump.
- Beside it, the study; beside that, from 1280px, a side column with "Project
  impact" (the first four measured figures, each with its evidence label), "Key
  features" and "Links and resources". Below 1280px the side column moves under
  the study.
- The first screen is the breadcrumb, the title and tagline, the kind of
  project and its two main technologies as tags, the two actions, and one row
  of three facts: status, role and context. Each fact is a few words
  (`statusLabel`, `roleLabel`, the kind of engagement) with a mark for where
  it comes from and at most one line under it. "Details" opens the full
  sentences and the evidence in place. Without JavaScript nothing is clamped.
- The study is split into tabs: Overview, Demo, Architecture, Decisions,
  Limits and Evidence. The current tab is whatever the address points at
  (`#demo`, or a section inside a tab such as `#results`), so every tab and
  section has a link, and Back and Forward walk them.
- `html[data-tab]` shows one panel and hides the rest. A script in `<head>`
  sets it from the address before first paint; `CaseStudyTabs` keeps it in
  step afterwards. With JavaScript off the attribute is never set, every panel
  is on the page, and the tabs are plain links to anchors.
- Pressing a tab shows the top of its panel: the page moves up if the reader
  had scrolled past it, and down if the bar was so low on the screen that the
  panel would have opened out of sight.
- The Demo tab takes the full width. The Architecture tab does too wherever
  the side column would leave the diagram too little room.
- The Overview shows the system as a picture: the same columns, components,
  logos and routed connections as the interactive diagram, drawn on the server
  as plain SVG (`ArchitecturePicture`). It needs no script and does not load
  the diagram library, and it links to the Architecture tab. What is legacy or
  switched off is marked on it too.
- The short lens says less: the overview goes from the problem straight to
  what was built, technology is a row of names, and a component's details are
  what it does, what it is built with and what the claim rests on. The
  engineer lens adds the context, what each technology is used for, and a
  component's inputs, dependencies and failure modes. In the short lens the
  same details are one press away, never removed.
- Screenshots open at full size in a native dialog. A card is a plain link to
  the file, so it works without JavaScript too.

**The architecture diagram is laid out by the site, not by hand.**
`src/content/architecture-columns.ts` turns layers, components and connections
into a picture: one tinted column per layer, in the order the layers are
listed, with the components of a layer stacked inside it. A manifest holds no
coordinates.

- A column is as tall as its own components and sits in the middle of the
  tallest one, so a layer with two components is a short box and not a long
  empty one. Components still stand on one grid of rows shared by every
  column; that is what lets a line between two of them be straight.
- A connection that passes over columns stays close to the ones it passes: it
  clears those, not the tallest column in the diagram. It is then moved
  outwards, a lane at a time, until it runs along nothing else.

- Rows are ordered so that a component sits near what it talks to.
- A connection is drawn with right angles only. It leaves a component from a
  side, travels in the gutter between two columns, and reaches columns further
  away through a channel above or below the columns.
- Each connection gets its own lane in a gutter and its own slot on the side
  of a component, so two lines never run on top of each other and a line never
  crosses a component it does not connect.
- `architecture-columns.test.ts` checks those guarantees on every project:
  columns in layer order, every component inside its column, every segment
  horizontal or vertical, no line through a component, no two lines sharing a
  stretch, and the same input always giving the same picture.

**At rest a diagram shows one line per pair of layers, not one per
connection.** Every connection drawn at once is exact and unreadable: a
system with twenty of them fills every gutter with parallel lines, and the
eye cannot follow one. So the layout works out a second, smaller set of lines
(`links`), and that is what a diagram shows until someone asks for more.

- Two neighbouring layers are joined through the gutter between them by one
  trunk. Each component that takes part has a branch to it, and a branch ends
  in an arrowhead where a connection arrives. The trunk says that the two
  layers talk and which components do the talking.
- Two layers further apart are joined by one line from the edge of one column
  to the edge of the other, over or under the columns between. Which lines go
  over and which go under is chosen for all of them together, by trying every
  combination, so that as few cross as possible.
- A line that stands for several connections is drawn in the style of the
  most definite of them: solid if any is a plain request, dashed if all are
  background work, faint if all are switched off.
- Connections inside one layer have no line at rest.

Nothing is lost by this. The exact line of every connection is still worked
out, and it is drawn when it is asked for: by pointing at a component or
reaching it with the keyboard, by choosing a component, a layer, a stage or a
request, or by the button that draws every connection at once. While exact
lines are on show the grouped ones step back to a faint trace.

How readable the picture is at rest depends on the order of the layers, which
is the author's. A test fails if a case study needs more than five lines that
skip a layer, or if two of them cross; the fix is to put layers that talk to
each other next to each other (`docs/AUTHORING.md`).

What the explorer adds on top of the picture:

- Its card has one row of controls: the title, the switch between
  Architecture and Data flow, and three buttons (every connection, the whole
  graph, the whole window). Nothing sits over the canvas, so no control ever
  covers part of the drawing.
- The canvas takes the shape of the diagram (`aspect-ratio` from the layout's
  own bounds), so there is no empty band around it, and the placeholder shown
  while the library loads has the same shape: nothing below it moves when the
  diagram arrives.
- At rest it shows the grouped lines described above, each plainly visible
  with its arrowheads. Pointing at a component, or reaching it with the
  keyboard, draws that component's own connections and sets them moving,
  without dimming any component.
- When the diagram first appears its components arrive one after another,
  left to right, and the lines follow them.
- Selecting a component marks it, draws its direct connections in full, dims
  everything else and opens its details: a card over the right of the canvas
  on a wide screen, a sheet from the bottom of the viewport on a narrow one.
  The canvas only slides when the component would otherwise be off it or
  under the card. Escape, the close button and a click on the canvas all
  close it.
- The title of a column brings that layer forward and draws each of its
  connections; pressing it again shows every layer.
- The Data flow view offers the requests that have been traced through the
  system. Choosing one draws its route and numbers its hops on the canvas. The
  words for each hop (what it carries, and in the engineer lens how the call
  is made) are in a strip above the canvas on a wide screen and under it on a
  narrow one, never over the diagram: the gutters are narrower than any
  sentence. Where the whole diagram is readable it stays whole while a
  request is followed.
- Under the diagram the first workflow is shown as three to five numbered
  stages. Pointing at a stage, or focusing it, brings forward the components
  its steps run on; pressing it keeps them forward. This is a way to read the
  diagram, not an execution: the run is the Demo tab.
- The buttons in the header draw every connection at once, show the whole
  graph and open the diagram over the whole window; zoom and pan are there
  for the mouse; every component and every column title is a button, so the
  keyboard reaches all of them; and the same content is under the diagram as
  a list. The line under the canvas says what one line stands for.

**Layout rules.**

- Wide screens place a list beside its details (steps and inspector). Below
  1024px the same two panes take turns: a segmented switch in the demo, a
  bottom sheet for component details.
- Two sticky bars at most: the site header (`--header-h`) and, on a case study,
  the tab bar (`--subnav-h`). Anchor targets use both in their scroll margin,
  so a deep link never lands under a bar.
- A panel that eases in must not keep a transform when it has finished: a
  transformed ancestor would trap a fixed bottom sheet inside the panel.
- The router can keep the page a reader came from in the document, hidden, so
  an id may exist twice. The tab bar looks elements up inside its own case
  study, never on the whole document.
- The diagram never opens smaller than is readable. When the whole graph would
  not fit at a readable size it opens on the first columns and says so, with
  the full graph one tap away and a list alternative under it. That is the case
  on a phone, and on any screen for the two projects that have six layers.
- Evidence labels are an icon and a word beside the claim. In the side column,
  where space is tight, the label is the icon alone, with the word kept for
  screen readers and as a tooltip.

## Accessibility

`e2e/accessibility.spec.ts` runs axe-core inside the page against every route,
every tab of every case study in both lenses, and the states a visitor can
put a page in: a demo waiting, finished and refused; a run on the server; a
component, a request, a stage and a layer brought forward; the expanded
diagram; the menu, the project drawer and a component sheet on a phone; a
screenshot at full size. It does so in both themes, with the WCAG 2.2 A and AA
rules, and any finding fails the test, whatever its severity.

What the first run found, all fixed in the markup or the tokens:

- Description lists whose terms were wrapped two levels deep. They are lists
  of plain items now, or description lists with their terms where the element
  expects them.
- Controls whose announced name did not contain the words shown on them: a
  diagram component, the link to a project's source request, the picture of
  the system. A component's name is now exactly the text on its card.
- The "documented" evidence label, which fell to 4.4:1 on three of the tinted
  cards. It has its own token, and a test checks every evidence label on every
  tint.
- Log lines of the steps that were not selected, dimmed below 4.5:1. They are
  not dimmed.
- The diagram library's attribution link, grey on a tinted column.

One thing is left out on purpose, and only one. While a component, a request,
a stage or a layer is brought forward in a diagram, everything else is dimmed,
below the contrast a resting page must have. The audit skips the contrast rule
on what is dimmed, and on nothing else. The dimming lasts as long as the
selection, Escape clears it, and the same content is listed under the diagram.

An automated audit finds what a machine can check: names, roles, contrast,
structure. It does not replace reading the site with a screen reader, which
has not been done.

## Privacy, headers and what leaves the page

The site has no analytics and loads nothing from another origin: fonts and
icons are served from the site itself. That is a decision, not an omission.
The cost is that the owner cannot see how many people visit; if that is ever
wanted, the choice is a cookieless counter, and the content security policy
below would have to name it.

`next.config.ts` sends the same headers with every response: a content
security policy, `X-Content-Type-Options`, `X-Frame-Options`, a referrer
policy, a permissions policy that asks for no device feature, a cross-origin
opener policy and HSTS. The policy allows the site itself and nothing else: no
script, font, image or request from another origin, no plugin, no framing.

The policy allows scripts and styles written into the page. The pages are
prerendered, and a policy that allows only scripts carrying a per-request
nonce would make every page dynamic. That trade is taken deliberately: the
site renders no visitor text as markup, and static pages are what make it
free to host.

`e2e/production.spec.ts` checks the headers on a page, the API, an image and
a 404; walks the main pages and a server run and fails on any request to
another origin, any policy violation and any cookie; and checks that the only
things stored in the browser are the visitor's own choices of theme, lens and
rail.

## Share images and addresses

Every page that is likely to be shared has an image made for it at build
time (`opengraph-image.tsx` at the root and under `projects/[slug]`): the
title, one or two whole sentences, the status and role as pills, and a small
picture with one column per layer of the real system and one card per
component. Nothing in it is typed by hand. The image engine reads no
stylesheet, so its colours are written out in `src/lib/og-palette.ts`, and a
test fails when they stop matching the tokens.

Canonical addresses, the sitemap, robots.txt and the image addresses are built
from `SITE_URL`, or the host's own production address on Vercel, or the
placeholder in `content/site.json`. The browser tests read them back.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: lint with no
warnings allowed, unit tests, type check, production build, then the browser
tests against that build with two workers and an installed Chrome, keeping the
traces of anything that fails. `SITE_URL` is set to a test origin so the
address checks have something to read back.

The workflow file parses, and its steps were run locally in the same order
with the same settings, except installing the browser, which the local
machine already has (Edge there, Chrome on the runner). It has not run on
GitHub: the project folder is not a repository yet.

## Safeguards in place

| Risk | Control |
| --- | --- |
| A simulation mistaken for a real run | Mode badge and note on every demo; simulated timings labelled; measured figures only in the Results section with their method |
| A scripted model answer mistaken for a real one | The triage demo states that no model is called; the visitor picks which scripted answer the model gives |
| Fabricated or drifting claims | Provenance required by the schema; metrics require a method; components require sources; tests enforce it |
| Client data exposure | Seed data is invented; sample phone numbers are unassignable; email domain is reserved for testing; source links can be switched off per repository |
| Secrets in payloads | Scenarios record masked values; a test fails if a token-shaped string or project URL appears in a log |
| Hostile input | Input is validated and length-limited; everything renders as text through React. Only a sandbox run sends it to the server, where it is validated again and bound as SQL parameters |
| Abuse of the sandbox | Fixed list of scenarios, strict request shape, rate limits, an execution budget, a database per request, no outbound message; see Live sandbox |
| Visitor text shown to other visitors | The ledger of sandbox runs holds no input, only the preset id or "custom" |
| A scenario bug breaking the page | The session turns an exception into a failed run; the route has an error boundary |
| Motion sensitivity | `prefers-reduced-motion` disables animation |
| A regression in accessibility | Every page, tab and state is audited with axe on every run; any finding fails |
| A third party seeing a visitor | No analytics; a content security policy that names no other origin; a test that fails on any request leaving the site |
| The site framed or sniffed | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff` |
| A logo read as an endorsement | Logos are used for technologies only, in one colour, beside the technology's name |
| Private source or parameters leaking | A private repository is never linked and a test enforces it; the trading demo keeps every threshold in one invented settings object; source is offered on request by email |
| A contact form that silently fails | There is none: the source request writes an email in the visitor's own mail app, and the page says nothing is sent or stored |
| A demo that could place an order | The trading demo models the real-money switches as a step that always refuses; nothing in the browser can call a provider |

## Hosting and cost

| Stage | Hosting | Cost |
| --- | --- | --- |
| Now | Any static-capable Next.js host (Vercel hobby tier is the simplest) | None |
| Live sandbox | A Node host (Node 24 is what is tested) for the route handler. The database is the SQLite inside Node | None. A Postgres sandbox on a hosted free tier remains an option if the engine itself has to match production |
| Optional AI demo | A hosted model with a hard spending cap, defaulting to recorded output | Capped |

## Known gaps

- The sandbox database is SQLite; production is Postgres. The rules run in the
  application, so they behave the same, but nothing here exercises
  Postgres-specific behaviour.
- The sandbox's rate limit and its ledger live in one process. On a host that
  runs several instances, or that freezes them between requests, each instance
  counts on its own and the ledger file may not outlive the instance. The
  limits still bound each instance; the page says when the ledger is in memory.
- The address used for the rate limit is the one a proxy reports. Served
  without a proxy that sets it, a caller can forge it; the limit for everyone
  together is the one that holds then.

- The CI workflow is written and its steps pass locally; it has not run on
  GitHub, because the project is not a repository yet.
- The site is not deployed.
- No pass with a screen reader has been made.
- The content security policy allows inline scripts, for the reason given
  above.
- No automated accessibility audit with a tool such as axe yet. What is tested:
  token contrast, the skip link, visible focus, control names on the case-study
  page, a keyboard-only run of the demo, and reduced motion.
- `npm audit` reports `braces` through `eslint-config-next`. It is a
  development-only dependency and is not shipped to visitors.
- No Open Graph image.
- About and Contact are sections of the home page, not routes of their own.
- The CRM and job triage case studies have no screenshots; see each manifest's
  `screenshotsNote`. The other two show one each.
- The source request depends on the visitor having a mail app; the page offers
  copying the request as the way round that.
