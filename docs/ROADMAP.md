# Roadmap

Status as of 2026-10-11. A milestone is done only when its acceptance criteria
have been checked, not when its screens exist.

## M1. Foundation and flagship vertical slice — done

Checked on 2026-10-10: type-check and lint clean, 108 unit tests and 33 browser
tests passing against the production build.

| Deliverable | Acceptance | Checked by |
| --- | --- | --- |
| Content schema and loader | An invalid manifest fails the build; provenance and metric method are required | `src/content/content.test.ts` |
| Workflow engine | Deterministic; any prefix of a log reduces; scenario bugs become failed runs | `src/engine/engine.test.ts` |
| CRM scenario | Rules mirror the production code; every fault and preset finishes cleanly | `rules.test.ts`, `scenario.test.ts` |
| Home, projects index, case-study page | Prerendered; no console errors; no sideways scroll on a phone; 404, sitemap and robots work | `next build`, `e2e/journeys.spec.ts`, `e2e/responsive.spec.ts` |
| Architecture explorer | Select a component, focus a layer, follow a request, switch system and data-flow views, fit to screen, read it as a list | `e2e/journeys.spec.ts` |
| Workflow demo | Run, step, resume, replay, cancel, reset, scrub the timeline, make the human decision, block invalid input | `e2e/journeys.spec.ts` |
| Execution inspector | Per-step status, attempts, payload, logs, data changes; credentials masked | `e2e/journeys.spec.ts` |
| Failure injection | Eight faults, each labelled as handled or as a known limitation; grouped faults are exclusive | Unit tests for all eight; browser tests for three |
| Lens and theme | Persist across reloads; reader keeps their place when the lens changes | `e2e/journeys.spec.ts` |

Not covered by a test: the Pause button, the 1x, 2x and 4x speeds as distinct
speeds, and the visual design itself.

## M2. Automation Lab and the second demo — done

Checked on 2026-10-10 together with the redesign below.

| Deliverable | Acceptance | Checked by |
| --- | --- | --- |
| `/automation-lab` | A library of every workflow; choosing one is a link (`?workflow=`); switching gives a clean run, input and selection | `e2e/journeys.spec.ts` |
| Job triage scenario, from `apply-agent` | Fingerprint and dedupe, targeting policy, score, adversarial second pass, send decision, CV bullets chosen by id, Telegram, three human decisions, follow-ups | `scenarios/triage/rules.test.ts`, `scenario.test.ts` |
| Model output | Scripted, never called; the page says so before the run and the visitor picks which answer the model gives | `e2e/journeys.spec.ts` |
| Second case study | Built from a manifest alone: page, architecture, demo, cards, lab entry | `src/content/content.test.ts`, `next build` |
| Thirteen faults | Each classified as handled in the real code; grouped faults are exclusive | Unit tests for all thirteen; browser tests for three |

The repository's LinkedIn automation module is deliberately not part of the
case study. The role statement on that page is labelled "Inferred" until the
owner confirms it.

## Site-wide redesign, first pass — replaced

The owner did not like this look. The second pass below replaces its visual
design; the layout rules, the tests and the defects it fixed carry over.

Scope: every route and every shared component. Checked on 2026-10-10: type-check
and lint clean, 280 unit tests and 123 browser tests passing against the
production build.

| Deliverable | Acceptance | Checked by |
| --- | --- | --- |
| Design system | One token set for both themes; text and field borders meet WCAG AA contrast; component classes take their state from ARIA attributes | `src/app/tokens.test.ts` |
| No sideways scroll | Five routes, both lenses, at 390, 768, 1280 and 1440px | `e2e/layout.spec.ts`, `e2e/responsive.spec.ts` |
| Navigation | Current page marked; one-row header at every width; mobile menu with lens and theme; Contact always visible | `e2e/layout.spec.ts` |
| Anchors and sticky bars | A link to any section, opened fresh, rests just below the header and the section bar; the two bars never overlap; the section bar marks the section being read | `e2e/layout.spec.ts` |
| Home page | Leads with a trace of a real run of the engine, then the demo; featured projects answer the same questions in the same order | `e2e/journeys.spec.ts` |
| Case-study pages | Same sections in the same order for every project; limitations and evidence labels visible in both lenses; ends with a next step | `e2e/journeys.spec.ts` |
| Demo layout | Controls, progress, decision and outcome stay together; steps beside inspector on wide screens, one pane at a time below 1024px | `e2e/layout.spec.ts` |
| Diagram | Opens at a readable size at every width and says when it shows only part; layer boxes; full graph, expanded view and list alternative; details as a side panel or a bottom sheet | `e2e/layout.spec.ts`, `e2e/journeys.spec.ts` |
| CRM demo paths | Enquiry to booking to notification; double booking with no appointment written; wrong webhook key; worker retry and recovery; worker that keeps failing; existing customer; returning lead; replay, reset, stepping, timeline | `e2e/journeys.spec.ts` |
| Keyboard and motion | Skip link, visible focus, named controls, a keyboard-only run of the demo, reduced motion | `e2e/layout.spec.ts` |

Defects these tests found, which were fixed rather than designed around:

- The diagram's loading placeholder was about 190px shorter than the diagram, so
  everything below it moved when the diagram arrived. The placeholder now uses
  the same toolbar and canvas height.
- A case study was delivered as a hidden segment revealed by a script, so a link
  to a section could be resolved before its target was on the page and land at
  the top. The page is now complete in the static HTML, which also makes it
  readable without JavaScript.
- A long file name in a source reference pushed the page wider than a tablet in
  the engineer lens. Source references now wrap.
- The header's border made it one pixel taller than the offset the section bar
  sticks at, so the two bars overlapped by that pixel.
- In the light theme the quietest text colour fell just short of 4.5:1 on inset
  surfaces, and field borders were below 3:1 in both themes.

Not covered by a test: the Pause button, the 1x, 2x and 4x speeds as distinct
speeds, a screen-reader pass, and visual taste. The last two were reviewed by
eye from screenshots, not measured.

## M3. Failure and recovery lab — done

Checked on 2026-10-10: type-check and lint clean, 584 unit tests and 171 browser
tests passing against the production build.

| Deliverable | Acceptance | Checked by |
| --- | --- | --- |
| Market data platform case study, from `stocks-platform` | Built from a manifest alone; states that it runs in shadow and that the switch is not made | `src/content/content.test.ts`, `e2e/journeys.spec.ts` |
| Queue, breaker and scanner rules | Mirror the Python source: enqueue once, claim under a lease, backoff with jitter, dead after three attempts, reap, requeue, breaker states, fallback, alert key | `scenarios/stocks/rules.test.ts` |
| Slot-to-alert scenario | Nine faults; a dead job is reported and a person decides; requeueing a job whose slot has passed expires it | `scenarios/stocks/scenario.test.ts`, `e2e/journeys.spec.ts` |
| What is not live | The Telegram step is skipped with its reason; its node is marked disabled; the old poller is marked legacy | `e2e/journeys.spec.ts` |

The retry delay's random half is fixed at its midpoint in the simulation, and
the page says so.

## M4. Remaining case studies — done

Checked on 2026-10-10: type-check and lint clean, 1,596 unit tests and 272
browser tests passing against the production build. Seven case studies, each
built from a manifest alone, each with a workflow that runs.

| Case study | Source | What keeps it honest | Checked by |
| --- | --- | --- | --- |
| Solana trading research platform | Private repository and its public write-up | Paper trading is the default and the real-execution layer is shown as switched off; every threshold in the demo is invented | `scenarios/solana/*.test.ts`, `e2e/journeys.spec.ts` |
| Rug inventory and Shopify synchronisation | Private repository, with the public write-up as the limit of what is disclosed | The client is not named; limits and timings are invented and kept in one object; the apply step is a labelled stand-in because its database function is not in the repository; nine limitations | `scenarios/rugs/*.test.ts`, `src/content/content.test.ts`, `e2e/more-case-studies.spec.ts` |
| Lead discovery and contact enrichment engine | Public repository | The matcher is a port of the Python, checked against values computed by running it; run totals are labelled as the author's and not re-derived; the cases where the gate verifies a wrong match are shown as limitations | `scenarios/leads/*.test.ts`, `e2e/more-case-studies.spec.ts` |
| Amazon rating estimator | Public write-up only | Nothing is labelled as verified in code; the role does not claim the product; unfinished parts are marked as not running; the demo shows the documented average and planner and no model estimate | `scenarios/rating/*.test.ts`, `src/content/content.test.ts`, `e2e/more-case-studies.spec.ts` |

Generic checks run against all seven: the overview, the demo to an outcome,
the diagram, every tab, and that a source which is not public is offered on
request and never linked.

Left out on purpose, and reported to the owner instead of published: weaknesses
in the rug application that someone could exploit while it runs for a client.

## Site-wide redesign, second pass — look replaced, structure kept

The owner supplied a reference: a light, lavender and indigo page of white
cards, coloured icon tiles and pastel tags, with a project page in three
columns under a bar of tabs. Checked on 2026-10-10 with the same run as M4.
The third pass below replaces the palette, the typeface, the first screen of a
case study, the project rail and the architecture diagram. The tabs, the
overview lanes, the projects index, the Lab and the defects fixed here carry
over.

| Deliverable | Acceptance | Checked by |
| --- | --- | --- |
| Palette | Light by default, dark by choice; indigo accent, ink for the main action, eight tones that only tell things apart; every text pair at AA in both themes | `src/app/tokens.test.ts` |
| Case study in three columns | Project rail with search and a fold that is remembered; the study; a side column with measured figures, what it does and links. The rail shows from 1536px | `e2e/case-study.spec.ts` |
| Tabs | Six tabs driven by the address; deep links to a tab or to a section inside one; Back and Forward walk them; all panels in the HTML without JavaScript | `e2e/layout.spec.ts`, `e2e/case-study.spec.ts` |
| System overview | One lane per layer; a component opens beside the lanes and never over one; following a request numbers its path and lists it in order | `e2e/case-study.spec.ts` |
| Projects index | Search across case studies and write-ups, together with the category filter | `e2e/case-study.spec.ts` |
| Automation Lab | Seven workflows; a link to one never shows another first; the library is one sideways row on small screens | `e2e/case-study.spec.ts`, `e2e/responsive.spec.ts` |
| Home | Four case studies in full, the other three listed, then the write-ups | `e2e/more-case-studies.spec.ts` |
| No sideways scroll | Twelve routes and every tab, both lenses, at 390, 768, 1280 and 1440px | `e2e/layout.spec.ts`, `e2e/responsive.spec.ts` |

Defects the tests found in this pass, fixed rather than designed around:

- A panel's entry animation kept a transform after it ended, which trapped the
  component sheet inside the panel: on a phone it opened at the bottom of the
  page, out of sight.
- Moving from one case study to another wiped the attribute that shows a tab,
  so the new page showed nothing selected. The router keeps the old page in the
  document, hidden, so a link could also resolve to the old page's section.
- The details card covered other components, so the next one could not be
  opened without closing it first. It is docked beside the lanes now.
- "Try the demo" switched the tab and left the reader at the top of the page.
- The Automation Lab is prerendered with its first workflow. A link to another
  one showed the first until the page hydrated, and a speed chosen in that
  moment was lost. The workspace is now held back until it shows the right one.
- The decision prompt scrolled into view smoothly, which a growing step list
  could cancel. It jumps, and checks once more.
- The light theme's green fell just short of 4.5:1 on its own tint.

Not covered by a test: a screen-reader pass, the Pause button, and visual
taste. The look was reviewed by eye from screenshots at five widths in both
themes; `docs/screenshots/` holds a set from the production build.

## Site-wide redesign, third pass — done, then refined by the fourth

The fourth pass below changed parts of what this section describes: the
overview no longer has lanes, the diagram's controls moved onto the canvas and
into the Data flow view, and the tones gained vivid values. The numbers in
this section are the ones checked at the time.

The owner supplied two reference screens, a home page and a project page, and
asked for their visual language closely: a cool white page, navy text, a blue
accent, Inter, a project explorer against the left edge, a compact first
screen, and an architecture drawn as tinted columns with precise connectors.
The references were treated as a visual specification only: every project,
figure, technology and screenshot on the site is still its own.

Checked on 2026-10-11: type-check and lint clean, 1,723 unit tests and 295
browser tests passing against the production build.

| Deliverable | Acceptance | Checked by |
| --- | --- | --- |
| Palette and type | Page `#f8faff`, cards `#ffffff`, text `#101b35`, accent `#2563eb`, as the brief names them; Inter; every text pair at AA in both themes | `src/app/tokens.test.ts`, `e2e/journeys.spec.ts` |
| Project explorer | A rail on the left edge: open from 1660px, a strip of icons from 1280px, a drawer below; search; current project marked; the choice remembered | `e2e/case-study.spec.ts` |
| First screen | Breadcrumb, title, tags, two actions and one row of status, role and context; long text clamped, opened in place by "Details" | `e2e/case-study.spec.ts` |
| Side column | "Project impact", "Key features", "Links and resources"; only measured figures, each with its evidence label | `e2e/case-study.spec.ts`, `e2e/more-case-studies.spec.ts` |
| Architecture as columns | One tinted column per layer; right-angled connectors; no line through a component and no two lines on top of each other, on all seven projects | `src/content/architecture-columns.test.ts` (59 tests) |
| Architecture interactions | Select a component: highlight, direct connections, the rest dimmed, details card or bottom sheet; follow a request: numbered hops and a strip of steps; data-flow view; focus a layer; zoom, pan, full graph, expand; keyboard; list alternative | `e2e/journeys.spec.ts`, `e2e/layout.spec.ts` |
| How it works | Numbered stages under the diagram; pointing at one brings its components forward, pressing keeps them | `e2e/journeys.spec.ts` |
| Screenshots | Open at full size in a dialog; close by button or Escape; a plain link without JavaScript | `e2e/case-study.spec.ts` |
| Home | Hero beside the real layers of the first case study; counts taken from the content; four featured cards with a screenshot or the project's own diagram; demo and contact cards | `e2e/journeys.spec.ts` |
| Nothing lost | Seven case studies, every tab, both lenses, both themes, the demos, the sandbox, search and deep links behave as before | The whole suite |

Decisions in this pass, and why:

- **The diagram is computed.** Hand-placed coordinates could not promise that
  no connector crosses a component, and seven manifests would each have needed
  re-placing. A layout with tested guarantees does it once for all of them, and
  for any project added later. `position` in a manifest is no longer read.
- **Words are kept off the canvas.** Labels on connectors covered components in
  the first two passes. A connector now carries at most a number; the words are
  in the details card or in the strip of steps.
- **The accent is the brief's blue, and its tint was chosen around it.**
  `#2563eb` is 5.2:1 on a white card and 4.6:1 on `accent-soft`, the lowest
  of the pairs the contrast test checks. The tint cannot get darker without
  dropping below 4.5:1, and the test holds it there.
- **No summary figures were invented to fill the reference's cards.** Where the
  reference shows a percentage, the site shows a measured figure with its
  method, or a count taken from its own content, or nothing.
- **A stage highlight is not a run.** Pointing at a stage only brings its
  components forward. The page says so, and the demo is one click away.

Defects found and fixed in this pass:

- Pointing at a stage and then pressing it cancelled the press, so with a mouse
  a stage could never be kept.
- The steps of a followed request sat in a card over the canvas, which left
  the route about a third of the width and shrank it to an unreadable size.
- On a phone the two actions under the title ran past the right margin.
- The home page scrolled sideways on a phone.

Compromises that remain:

- The two projects with six layers do not fit the canvas at a readable size, so
  their diagram opens on the first five columns and offers the full graph.
- On a phone the diagram is a window onto the first columns; the list under it
  is the easier way to read the whole system there.
- In a search field, Escape clears the text before it closes the project
  drawer. That is the browser's behaviour for a search field and was left as
  it is.
- The Overview tab still showed the architecture as lanes, top to bottom,
  while the Architecture tab showed columns. The fourth pass replaced the lanes
  with a picture of the same columns.

Seen once and not explained: in one of the full runs of the browser tests, the
phone-width sandbox test showed a simulated run where a server run was
expected. It did not happen again in the full run after it, in the sandbox
tests run alone, or in four parallel repeats on a freshly started server. That
run may have reused a server left over from before a rebuild, but that was not
confirmed. The sandbox tests now put the page's own reason for simulating into
the failure message, so a recurrence will say whether it was a rate limit, a
timeout or a server that was not there.

Not covered by a test: a screen-reader pass, the Pause button, and visual
taste. The look was compared by eye with the two references at their own
sizes, 1672px and 1536px, and at 390, 768 and 1280px, in both themes;
`docs/screenshots/` holds a set from the production build.

## Source on request and resume — done

| Deliverable | Acceptance | Checked by |
| --- | --- | --- |
| `/source-access` | A request is an email written in the visitor's own mail app; nothing is sent or stored by the site; a name and a purpose are required; typed text cannot add recipients | `src/content/source-access.test.ts`, `e2e/journeys.spec.ts` |
| Entry points | Each case study's evidence section, each write-up that keeps its source private, the contact section and the footer | `e2e/journeys.spec.ts` |
| Private repositories | Never linked; shown as private with the request link and, when there is one, the public write-up | `src/content/source-access.test.ts`, `e2e/journeys.spec.ts` |
| `/resume` | Built from the same content as the site; prints as ink on white in either theme, without the site chrome | `e2e/journeys.spec.ts` |

## M5. Live sandbox — done

Checked on 2026-10-11. The CRM's enquiry-to-booking workflow can run on the
server against a SQLite database created for the request. The simulation stays
the default and the fallback.

| Acceptance | How it is met | Checked by |
| --- | --- | --- |
| Server executor against an isolated database | The same scenario program on a SQL store; a database in memory per request, from a reduced copy of the CRM's schema, closed when the request ends | `src/sandbox/sandbox.test.ts` (both stores give equal event logs for every preset, decision and fault), `e2e/sandbox.spec.ts` |
| Server-side validation | Allow-list of scenarios, strict request shape, the scenario's own validator, faults and decisions checked against what the scenario offers; SQL only through bound parameters | `src/sandbox/sandbox.test.ts`, `e2e/sandbox.spec.ts` (ten refusals, none with a stack trace) |
| Rate limit per address | 30 a minute for an address and 300 for everyone, counted before the body is read; the address is kept only as a salted hash in memory | `src/sandbox/sandbox.test.ts`, `e2e/sandbox.spec.ts` |
| Execution timeout | A budget of 1.5 s, 400 statements and 2,000 events, checked before each statement and each event; the page gives up after 6 s | `src/sandbox/sandbox.test.ts` |
| Cleanup of old runs | The run's database is closed with the request. The ledger drops rows older than a day and keeps the newest 500 | `src/sandbox/sandbox.test.ts` |
| Visible fallback to simulation | Unreachable, static host, rate-limited, switched off, or lost part-way: the run is simulated in the page, the reason is shown, and the badge says Simulation | `e2e/sandbox.spec.ts` (five cases) |
| Results stored and shown | A ledger of runs on the server, shown in the demo's Database tab with the rows read back from the run's database | `e2e/sandbox.spec.ts` |

Decisions that differ from the first plan, and why:

- **SQLite inside Node, not a hosted Postgres.** A hosted database needs an
  account, a credential on the server and a plan for when the free tier
  pauses. The rules of this workflow run in the application, so they behave
  the same on either engine, and a database per request is trivial in memory
  and awkward on a shared server. What is lost is stated on the page: it is
  not the production engine.
- **No state between requests.** The page sends the decisions made so far and
  the server runs the scenario again. Determinism makes that correct, and it
  removes sessions, cookies and expiry from the design.
- **The ledger holds no input.** It is public, and the input can contain what
  a visitor typed.

Not done: the same for a second workflow, a Postgres sandbox, and a shared
store for the rate limit on a host with several instances.

## Site-wide redesign, fourth pass — done

The owner looked at the third pass and said, on 2026-10-11, that the site was
crowded and still did not look like the two reference screens: say less, show
more, raise the contrast between the colours; and that the icons and pictures
were not like the references. This pass is the answer to those two messages.

Checked on 2026-10-11 with the same run as M6: type-check and lint clean,
1,822 unit tests and 370 browser tests passing against the production
build.

| What the owner said | What changed | Checked by |
| --- | --- | --- |
| Crowded | The diagram's card lost three rows of controls: only its title and the Architecture and Data flow switch remain. The canvas takes the diagram's own shape, so no empty band surrounds it. A request is followed from the Data flow view; a layer is brought forward by its column's title; the whole graph and the expanded view are two buttons on the canvas | `e2e/journeys.spec.ts`, `e2e/layout.spec.ts` |
| Say less | Status, role and context are a few words each (`statusLabel`, `roleLabel`), one line under them, the rest under "Details". The short lens goes from the problem to what was built; technology is a row of names; a component's details are three short blocks with the rest one press away. Home cards lost their figure and their two buttons; the projects index keeps the problem and contribution for the engineer lens | `e2e/case-study.spec.ts`, `e2e/journeys.spec.ts` |
| Show more | The overview opens on a picture of the system, drawn on the server from the manifest. The home page's picture is a hub of the first case study's real layers and components. Every card on the projects index has a picture: a screenshot, or the project's own architecture drawn small | `e2e/case-study.spec.ts`, `e2e/journeys.spec.ts`, `e2e/more-case-studies.spec.ts` |
| Icons like the references | A component shows the logo of what it is built with (Supabase, Apps Script, Gmail, Postgres, Telegram, Shopify and others) in its own colour; a component with no logo gets an icon and a colour for its kind. The same logos mark the technology tags | `src/components/ui/brand.ts`, reviewed against all 106 components |
| More contrast between colours | Each tone has a vivid value for icons, large figures and solid tiles, beside the darker one kept for small text. Column tints, numbered stages and impact figures use it | `src/app/tokens.test.ts` |

Decisions in this pass, and why:

- **Logos are used for technologies, never for a client or an employer.** A
  logo says "built with this". It is one colour, not the company's artwork,
  and it always sits beside the technology's name.
- **A picture that stands in for a screenshot is the project's own diagram.**
  Three case studies have no screenshot. A screenshot of this site's demo
  would look like the product and is not it, so it was not used.
- **Less text means moved, not removed.** Everything the short lens stopped
  showing is in the engineer lens or one press away, and evidence labels
  stayed on every figure that is shown.
- **The vivid colours never carry small text.** They fail 4.5:1 on white by
  design; a test holds them to 3:1 for icons and large figures and keeps the
  darker tone for anything small.

Compromises that remain:

- A layer with two components leaves most of its column empty, because every
  column is as tall as the tallest. Centring them would have meant new routing
  rules for the connections.
- With five layers beside the side column, a component's name often takes two
  lines and its technology is cut short on its card. The full text is in its
  details and in the list under the diagram.
- Three case studies still have no screenshot.

## Site-wide redesign, fifth pass — done

The owner looked at the fourth pass on a 1920px screen and at the dark diagram
and said, on 2026-10-11: the page does not take the width of the window; add
animation everywhere; make the picture beside the headline move, with the
flow running through it and each working part lit while the rest is dimmed;
the diagram's columns have empty parts that look bad; make the arrows easier
to see; use better icons and make them glow.

Checked on 2026-10-11: type-check and lint clean, 1,822 unit tests and
384 browser tests passing against the production build.

| What the owner said | What changed | Checked by |
| --- | --- | --- |
| Does not take the page width | A page is as wide as the window up to 108rem, with a margin that grows with it | `e2e/motion.spec.ts`, `e2e/layout.spec.ts` |
| The picture should move, with the flow in it, the working part lit and the rest dimmed | The hub beside the headline plays the requests traced in the first case study, one hop at a time: the part a hop reaches is lit, the rest steps back, light runs along the line, and a caption names the request and the hop. Pause button; nothing plays under reduced motion or off screen | `e2e/motion.spec.ts` |
| Animation everywhere | The first screen arrives in order; blocks ease in as they are scrolled to; figures count up; cards, tiles and arrows answer the pointer; diagram components arrive one by one | `e2e/motion.spec.ts`; the audit and every other test run with it on or off as they did before |
| Empty parts in the columns | A column is as tall as its own components and sits in the middle of the tallest. Lines that pass over columns stay close to the ones they pass | `src/content/architecture-columns.test.ts` (the same guarantees as before, on all seven projects), `e2e/motion.spec.ts` |
| Arrows easier to see | Lines and arrowheads are heavier and nearly opaque at rest; pointing at a component brings its connections forward | `e2e/motion.spec.ts` |
| Better icons, glowing | A component's icon is a filled tile in the technology's or the kind's own colour with a white mark, a coloured shadow on the light theme and a glow on the dark one | Reviewed by eye in both themes |

Decisions in this pass, and why:

- **The animation replays real routes and says so.** A moving diagram is the
  easiest thing on the site to mistake for a live system. Every hop it shows
  is a hop of a request traced in the case study, the caption names it, and
  the line under the picture calls it a replay.
- **No line is drawn for a hop that has none.** The hub has lines from the
  middle card outwards. A hop between two outer parts lights them in turn and
  draws nothing, rather than sending light through the middle and implying a
  call that is not in the data.
- **Scroll animations are CSS only.** Hiding content until a script reveals
  it fails badly when the script does not run. Tied to scrolling in CSS, a
  block is simply visible wherever that is not supported.
- **Columns stay on one grid of rows.** Centring a short column by half a row
  would have looked a little better and would have put its sides out of step
  with its neighbours', which is what keeps lines from overlapping.
- **What changes never moves the page.** The owner saw the row under the
  picture jump: the pause button wrapped to two lines whenever the words
  beside it were long. The button now has one size for both of its labels,
  the line beside it is one row that cuts long text short, and the row has a
  fixed height that is held even before the page knows whether it may
  animate. A test samples it through two whole requests and through a pause,
  at three widths, and fails on a pixel of movement.
- **A block that a link can jump to only fades.** One that slid in as well
  was missed by a deep link by the distance it still had to slide.

Compromises that remain:

- A short column sits up to half a row above the true middle, for the reason
  above.
- On a phone the picture beside the headline is small: it is scaled as one
  piece, so its words are about half size there.
- Scroll animations do not run in a browser without scroll-driven animations;
  the content is there, without the easing.
- The glow on icons was judged by eye. No test says whether it looks good.

## Site-wide redesign, sixth pass — done

The owner looked at the Solana diagram with every connection drawn and said,
on 2026-10-11: the flow is not clear at all, and everything runs into
everything else.

Checked on 2026-10-11: type-check and lint clean, 1,857 unit tests passing,
and 390 browser tests against the production build, run the way CI runs
them: 389 passed in that run, and the one that failed was a test that still
counted one arrow per connection in the overview picture. Its expectation was
brought up to date and its file passed when run again.

He was right, and the cause was in two places. Twenty-three connections each
had a line of their own, so every gutter held five or six parallel lines; and
the layers were listed in an order that put the busiest layer five columns
away from the services it calls, so most of those lines crossed the whole
picture.

| What was wrong | What changed | Checked by |
| --- | --- | --- |
| A line for every connection | At rest a diagram draws one line per pair of connected layers: a trunk with branches between neighbours, one line over or under the columns between layers further apart. The Solana diagram has ten lines where it has twenty-three connections | `src/content/architecture-columns.test.ts` (five new guarantees on all seven projects), `e2e/motion.spec.ts` |
| The exact connections were the only picture | They are drawn on request: for the component pointed at or chosen, for a layer brought forward, for a request followed, or all at once with a button. The grouped lines step back while they show | `e2e/motion.spec.ts` |
| Long lines across the picture | The layers of three case studies were reordered so that layers that talk to each other are neighbours: Solana (nine lines that skipped a layer, now five, none crossing), market data (six, now four) and the lead engine (six with a crossing, now five with none). Only the order changed | The same test, which now fails on more than five such lines or on any crossing |
| Buttons over the corner of the drawing | The diagram's three buttons moved into its header, so nothing covers the canvas | Reviewed by eye; the existing journeys still find them by name |
| The overview picture and the small pictures on cards drew every connection too | Both use the same grouped lines | `e2e/motion.spec.ts`, reviewed by eye |

Decisions in this pass, and why:

- **Group, do not delete.** Dropping connections would have made a tidy
  picture of a system that does not exist. Every connection is still in the
  data, still routed, and one gesture away. What changed is which picture
  comes first.
- **A trunk between neighbours shows who takes part, not who talks to whom.**
  Five components writing to one database is one trunk with five branches and
  one arrowhead. That is all a first look can carry; the pairs are the next
  step. The line under the canvas says so.
- **The order of the layers is content, and it is the author's job.** The
  layout could have reordered columns by itself. It does not, because the
  order is also how the page reads elsewhere, and a system should not change
  shape when one connection is added. A test holds the author to a readable
  order instead.
- **Over or under is decided for all long lines together.** With at most a
  dozen of them, every combination can be tried; the one with the fewest
  crossings wins, then the one that stacks the fewest lines.

Compromises that remain:

- A first look no longer shows which component talks to which, or any
  connection inside a layer. It takes pointing at a component.
- On a touch screen there is no pointing: a component's connections appear
  when it is chosen, together with its details.
- Solana still needs five lines that skip a layer, two of them for the part
  that is switched off. One busy layer cannot have every partner beside it.
- Whether the picture is now clear was judged by eye, on seven diagrams. The
  tests hold the counts and the geometry, not the impression.

## An eighth case study: the review pipeline — done

The owner said, on 2026-10-11, that the Marketplace Review Intelligence
Pipeline is a very important project to show, and gave the path of its
private source. It had been listed as a write-up only.

| What | How | Checked by |
| --- | --- | --- |
| The case study | `content/projects/review-intelligence-pipeline.json`: 16 components in 6 layers, 24 connections, 5 traced requests, 6 decisions, 8 limitations. Built from the private source and the public write-up; every reference to the write-up begins with `showcase/` | The content tests, and the layout test (four lines that skip a layer, none crossing) |
| The demo | `src/engine/scenarios/reviews/`: 15 steps, 8 failures, 5 presets, one decision. Rules re-implemented from the Python and SQL, each naming the file it mirrors | 36 rule tests and 33 scenario tests, including every pair of failures |
| What stays private | No client, account, sheet or marketplace name; no product id; no threshold from the code. The demo's limits are its own and are kept in one object | A content test that fails on any of those words or shapes |
| A colour of its own | A ninth tone, cyan, since every project needs its own | The contrast tests, both themes |

Checked on 2026-10-11: lint and type-check clean, 1,976 unit tests passing,
and 401 browser tests against the production build. 394 passed in the full
run; the seven that failed all encoded "seven case studies" or the old order
(counts, the next project after the first, the home page's four), were brought
up to date, and passed when their files were run again.

How the source was read: three read-only passes over the repository, each
told never to open credentials, data files or account files, and each
returning facts with file and line. The lines cited on the page were then
checked against the files. References to the repository's own notes
(`.project-brain/`) are by file, without line numbers.

What reading the code changed. The public write-up says one formula drives
both the difficulty label and the "too hard" gate. The code has since retired
that formula; the page says so under the decision it belongs to instead of
repeating the older claim.

Left out on purpose: how sessions sign in, how they are kept from being
limited, and anything else that would read as instructions for getting around
a marketplace's controls. The page describes leases, locks and evidence, not
access.

## M6. Production readiness — done, except what needs a repository

Checked on 2026-10-11 with the fourth pass.

| Acceptance | How it is met | Checked by |
| --- | --- | --- |
| CI runs lint, type check, unit and browser tests on every push | `.github/workflows/ci.yml`: lint, unit tests, type check, build, browser tests on an installed Chrome with two workers, traces kept on failure | The file parses, and its steps were run locally in the same order and with the same settings (two workers, its own server, a test address), on Edge instead of Chrome. It has not run on GitHub: the folder is not a repository |
| The accessibility audit reports no serious issue | axe-core with the WCAG 2.2 A and AA rules, on every route, every tab of every case study in both lenses, and the states a visitor can reach, in both themes. Any finding fails, not only serious ones | `e2e/accessibility.spec.ts` |
| Open Graph image | One image per page that is likely to be shared, made at build time from the content: the site, and each case study | `e2e/production.spec.ts`, `src/lib/og-palette.test.ts` |
| Analytics only if privacy-friendly | None. Nothing is loaded from another origin and no cookie is set; a content security policy and a test enforce it | `e2e/production.spec.ts` |
| Deployment and `SITE_URL` | Canonical addresses, sitemap, robots.txt and image addresses come from `SITE_URL`; `.env.example`; a deployment guide for a serverless host and for a plain server | `e2e/production.spec.ts`, `docs/HANDOFF.md`. Not deployed |

Also added: security headers on every response (`next.config.ts`), a page for
a failure of the root layout (`global-error.tsx`), a pinned Node version
(`.nvmrc`), and `lint` and `typecheck` scripts that match what CI runs.

What the audit found and what was done is in `docs/ARCHITECTURE.md`, under
Accessibility. One rule is skipped in one place, and it is written there.

Not done, and why: the first CI run and the first deployment both need a
GitHub repository and a decision on the address, which are the owner's.

## M7. Handoff — done

`docs/HANDOFF.md`: how to run the site, how to put it online on a serverless
host or a plain server and what a static host would need, how to keep the
demos true when a real system changes, what it costs (nothing, as built),
where it stops, and where each kind of change is made.

## Decided by the owner

On 2026-10-10:

- The flagship's decision records and role statement: confirmed.
- The job triage role statement: confirmed.
- Cleaning the public repositories: not part of this project. Source links
  stay off for those two and the site offers the source on request instead.
- `stocks-platform` and `solana-market-bot` may be featured.
- Source code is shared on request: the visitor writes to the owner and gives a
  purpose.
- The first redesign was not wanted. The look follows the reference the owner
  supplied: light, lavender and indigo, cards, icons, tabs, interactive.
- Finish the remaining case studies (M4), then the live sandbox (M5).

On 2026-10-11:

- The wording of the role on the Solana, market data, rug inventory, lead
  engine and rating estimator case studies is accepted. All seven roles are
  now labelled "Stated by owner".
- The rating estimator's code is the owner's. It keeps "Request the source",
  and the page no longer says the code belongs to the company.
- The lead engine may link straight to its public code.
- The screenshots in the owner's public write-ups may be used. The rug
  inventory and the rating estimator each show one.
- The second look was not close enough to what the owner wants. The look
  follows two reference screens closely: cool white, navy and blue, Inter, a
  project explorer on the left edge and an architecture in columns. Everything
  the site does and says is kept.
- The third look was crowded: say less, show more, raise the contrast between
  the colours, and make the icons and pictures like the references.
- Finish the whole project, and keep everything that needs the owner for one
  list at the end.
- The fourth look should fill the window, move everywhere, play the flow
  through the picture beside the headline with the working part lit, have no
  empty parts in the diagram's columns, show its arrows clearly, and use
  better icons that glow.
- A diagram with every connection drawn is not clear: the flow cannot be
  followed and the lines run into each other.

## Waiting on the owner

Everything that needs a decision or an action from the owner, in one place.

To put the site online:

1. Create a GitHub repository for this folder and push it. The first CI run
   happens then; it has only been run locally.
2. Choose the address. `content/site.json` holds a placeholder; `SITE_URL`
   overrides it, and on Vercel the production host is used automatically.
3. Choose the host. `docs/HANDOFF.md` describes a serverless host and a plain
   server. A static host such as GitHub Pages would need extra work.

About the content:

4. Screenshots of the CRM, the job triage pipeline and the lead engine. They
   have none, and their cards show their own architecture instead. The CRM's
   would show the client's figures.
5. Whether the text of the rug case study may name the client. It does not;
   the screenshot and the public write-up do.
6. Whether to add the rating estimator's second screenshot. It is left out
   because it shows the review identifiers of a real product.
7. Relocation preference. The site says only what the owner has stated: open
   to remote work.
8. Material for the one project still listed as a write-up only (the
   wholesale operations platform).
12. The review pipeline's case study, added on 2026-10-11 from its private
    source. To read and accept or correct:
    - its role line. It says "Engineer on the project at BlueBug" and that
      the history lists him on 270 of 271 commits; it is labelled "Inferred"
      until he accepts it.
    - what it discloses beyond his public write-up, which is older: the
      shared queue, the fleet of machines and their agent, the control panel,
      the change log and guarded functions, and eight limitations read in the
      code. It names no client, account, sheet or marketplace, and no
      threshold from the code; the demo's limits are invented.
    - the sentence "The review table drives client billing", taken from a
      decision record in the repository.
    - whether the page may name the marketplace. It does not, following the
      write-up; the rating estimator's page does.
13. That case study is second on the home page, as the project he called very
    important. Job Triage, the only one with a language model in it, moved
    from fourth place to the compact list. Swapping it back in for Market
    Data is one line in `src/content/load.ts`.

About the site itself:

9. Whether visitor numbers are wanted. There is no analytics, by decision; a
   cookieless counter could be added and would be named in the security
   policy.
10. A pass with a screen reader, by a person. The automated audit is clean.
11. Whether the order of the four projects on the home page should change. It
    is the order of `PROJECT_SOURCES`; two of the four have no screenshot.
