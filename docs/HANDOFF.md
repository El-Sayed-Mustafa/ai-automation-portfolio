# Handoff

What someone needs to run this site, put it online, keep its demos true and
know where it stops. Written for the owner, and for whoever maintains it next.

## 1. Run it

Requirements: Node 24 (the version in `.nvmrc`, used locally and in CI) and
npm. Node 20.9 is the oldest that builds the site; the live sandbox needs a
Node that offers the built-in SQLite module without a flag, which Node 24 does.

```bash
npm install
npm run dev          # http://localhost:3000
```

The checks, in the order CI runs them:

```bash
npm run lint         # ESLint, no warnings allowed
npm test             # unit tests: engine, scenario rules, sandbox, content, colours
npm run typecheck    # generates the route types, then tsc
npm run build        # production build; an invalid manifest fails it
npm run test:e2e     # browser tests against the build, on port 3100
```

The browser tests drive an installed browser: Edge by default, or
`PW_CHANNEL=chrome`. They start their own server; stop anything else on port
3100 first, or a server from an older build will be reused.

Settings, all optional, none secret (see `.env.example`):

| Variable | What it does | Default |
| --- | --- | --- |
| `SITE_URL` | The public origin, for canonical addresses, the sitemap, robots.txt and share images | On Vercel, the production host; otherwise the placeholder in `content/site.json` |
| `SANDBOX_DISABLED=1` | Switches the live sandbox off; every demo runs in the browser and says so | Sandbox on |
| `SANDBOX_DATA_DIR` | Where the sandbox keeps its ledger of runs | `.data/`, then the system's temporary directory, then memory |

## 2. Put it online

The site has not been deployed. Nothing in the repository holds a credential,
and it needs none.

### What has to be decided first

- **The address.** `content/site.json` holds a placeholder. Set `SITE_URL` on
  the host, or change the placeholder, before the first public build: the
  canonical addresses, the sitemap and the share images are built from it.
- **The repository.** The project folder is not a git repository yet. CI runs
  on GitHub, so the first step is to create one and push.

### Option A: Vercel (simplest)

1. Push the repository to GitHub and import it in Vercel. The framework is
   detected; no build setting needs changing.
2. In the project settings, choose the newest Node version the host offers,
   24 if it is there. The sandbox needs it; the rest of the site does not.
3. With a custom domain, set `SITE_URL` to it. Without one, leave it unset.
4. Deploy, then check section 2.4.

What changes on a serverless host: each instance of the sandbox has its own
rate-limit counters and its own ledger, and the ledger lives in temporary
storage or memory, so "recent runs" is short and resets. The page says which
kind of storage it is using. Runs themselves are unaffected: each one gets a
database of its own that is deleted when the request ends.

### Option B: any server that runs Node

```bash
npm ci
SITE_URL=https://your.domain npm run build
npm start            # listens on port 3000; `npm start -- -p 8080` changes it
```

Put it behind a reverse proxy that terminates TLS and sets
`x-forwarded-for`. The sandbox limits runs per address, and that header is the
address it sees; without it, only the limit for everyone together holds. Give
`.data/` a disk that survives restarts if the ledger should.

### What does not work as it is: a static host

GitHub Pages and similar hosts serve files only. This build has one server
route (the sandbox) and sends its security headers from the server, so it is
not exported as static files. On a static host the demos would still run in
the browser, which is the default, but the export and the headers would have
to be set up separately. That work has not been done.

### 2.4 After the first deployment

- Open `/sitemap.xml` and `/robots.txt`: every address should start with the
  real origin.
- Paste a page address into a link-preview checker: each case study has its
  own share image.
- Check the response headers of any page: a content security policy that
  names no other origin, `X-Frame-Options: DENY`, `nosniff`, a referrer
  policy, a permissions policy and HSTS.
- Run one demo "On the server" and read the note under it.
- Look at the first CI run on GitHub. The workflow has been checked locally,
  step by step, but it has never run there.

## 3. Keep the demos true

The site's claim is that what it shows is real or labelled. Maintenance is
mostly keeping that so.

| When this happens | Do this |
| --- | --- |
| A real system changes | Update its manifest in `content/projects/`, with the source of each changed claim. If a rule changed, change `src/engine/scenarios/<name>/rules.ts` and its test |
| A figure is re-measured | Update the metric and its `method`. Never keep a figure whose method no longer describes how it was obtained |
| A project gains a screenshot | Put it under `public/projects/<id>/` with its real size and a caption saying where it comes from. Only what the owner has published or may publish |
| A new case study | Follow `docs/AUTHORING.md`. Then add its id to the lists in `e2e/accessibility.spec.ts`, `e2e/production.spec.ts`, `e2e/layout.spec.ts` and `e2e/more-case-studies.spec.ts`, so it is audited and checked like the others |
| A new technology in a diagram | If it should show its logo, add a rule to `src/components/ui/brand.ts`. A component with no rule gets an icon for its kind |
| A layer or a connection is added to a diagram | Look at the diagram at rest (`node scripts/diagram-shots.mjs <outDir>`). If lines cross the picture, reorder `layers` in the manifest so that layers that talk to each other are neighbours. `architecture-columns.test.ts` fails when a diagram needs more than five lines that skip a layer, or when two of them cross |
| The CRM's database schema changes | `src/sandbox/crm-database.ts` holds a reduced copy for the sandbox. Change it with the scenario, and the test that runs both stores must still give equal event logs |
| The first project changes | The picture beside the headline is built from the first project of `PROJECT_SOURCES`: its layers and its traced requests. Look at it at 390, 1280 and 1920px after changing it (`node scripts/motion-shots.mjs`) |
| A colour changes | Change the token in `src/app/globals.css`. The contrast tests say whether it still passes; `src/lib/og-palette.ts` must follow, and a test fails until it does |
| Next.js is upgraded | Read the upgrade notes first: this version already differs from older ones, and `AGENTS.md` says where its documentation is |

Three rules that are easy to break by accident:

- A demo runs on invented data and says so. Never paste a real customer
  record, a real phone number or a private parameter into a scenario.
- A private repository is never linked. A test fails if a manifest tries.
- A weakness that someone could exploit in a system running for a client does
  not go on the site. It goes to the owner.

## 4. What it costs

As built, the site costs nothing to run. It uses no paid service, no API key,
no hosted database and no analytics.

| Item | Cost | Note |
| --- | --- | --- |
| Hosting | None on a free tier | Read the host's terms before using a free tier for commercial work |
| Sandbox database | None | SQLite inside the Node process, created per request |
| CI | None for a public repository | A private repository uses the monthly allowance of its GitHub plan. One run has not been timed on GitHub; locally the same steps, with two browser workers as in CI, take about sixteen minutes |
| Domain | The registrar's yearly price, if a custom domain is wanted | Not bought; no price is assumed here |
| Fonts, icons | None | Inter and IBM Plex Mono are fetched once at build time and served from the site; the icon sets are in the bundle |

Things that would add a cost, none of which exists yet: a sandbox on hosted
Postgres, a demo that calls a hosted model, analytics, error monitoring.

## 5. Where it stops

Things a maintainer should know before promising anything about the site.

**Not done**

- No deployment, and no CI run on GitHub yet.
- No pass with a screen reader. The automated audit (axe, WCAG 2.2 A and AA)
  reports nothing on any page, tab or state it visits, in both themes; that is
  not the same as a person listening to the site.
- No analytics, by decision: the site cannot say how many people visit it.
- One project is listed as a write-up only and has no interactive page.
- Three case studies (the CRM, the job triage pipeline, the lead engine) have
  no screenshot. Their cards show their own architecture instead.

**Built with a known limit**

- The sandbox database is SQLite; the CRM's is Postgres. The rules run in the
  application, so the demo behaves the same, but nothing here exercises
  Postgres itself.
- The sandbox's rate limit and ledger live in one process. Several instances
  each count on their own.
- The content security policy allows scripts written into the page. The pages
  are prerendered, so a per-request nonce is not available without giving that
  up. Everything else is closed to other origins.
- A diagram with six layers, and any diagram on a phone, opens on its first
  columns at a readable size and offers the full graph. The list under the
  diagram is the easier way to read a whole system on a phone.
- At rest a diagram draws one line per pair of layers. Which component talks
  to which is one step away (point at it, choose it, or draw every
  connection), not on the first picture. Connections inside one layer are not
  on the first picture at all.
- While one component, request, stage or layer is brought forward in a
  diagram, the rest is dimmed below the contrast a resting page must have.
  This is the one place the accessibility audit is told to look away, and only
  for that rule. Escape clears it, and the same content is listed below.
- The share images use one weight of one typeface, the one the image engine
  ships with.
- A logo is drawn in one colour. The technologies' own multi-colour marks are
  not reproduced.

**Seen once and not explained**

- In one full run of the browser tests, the phone-width sandbox test showed a
  simulated run where a server run was expected. It has not happened since.
  The test now reports the page's own reason for simulating, so a recurrence
  will say whether it was a rate limit, a timeout or a missing server.

## 6. Where things are

| To change | Look in |
| --- | --- |
| Words about a project | `content/projects/<id>.json` |
| Profile, capabilities, experience | `content/site.json` |
| What a demo does | `src/engine/scenarios/<name>/` |
| Colours, type, component classes | `src/app/globals.css` |
| The diagram's layout and routing | `src/content/architecture-columns.ts` |
| The diagram's behaviour | `src/components/architecture/` |
| Which logo a technology gets | `src/components/ui/brand.ts` |
| Share images | `src/lib/og.tsx`, `src/app/opengraph-image.tsx`, `src/app/projects/[slug]/opengraph-image.tsx` |
| Response headers | `next.config.ts` |
| The sandbox and its limits | `src/sandbox/`, `src/app/api/sandbox/route.ts` |
| CI | `.github/workflows/ci.yml` |

Read next: [ARCHITECTURE.md](ARCHITECTURE.md) for why it is built this way,
[AUTHORING.md](AUTHORING.md) to add a project, [ROADMAP.md](ROADMAP.md) for
what was checked and when.
