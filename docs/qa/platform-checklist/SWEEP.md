# Coverage sweep runbook — for an AI session, on request

How to re-run the capability-coverage gap hunt that built and audited this checklist.
A human should only need to say **"跑一轮 coverage sweep"** — everything below is
executable by the AI session itself. Expected cadence: before each major release, or
after any large platform surface lands.

This is the AI-participation half of keeping the checklist current. The other half is
automatic and needs no human at all: `scripts/check-platform-checklist.mjs` (CI, every
PR) fails when a new metadata **kind** is unmapped (coverage ratchet) or a spec **enum**
grows a value a matrix item was pinned against (`enumSource` freshness ratchet). Those
catch drift on the PR that causes it. This sweep catches the harder class — a whole
surface or behavior nobody wrote an item for — which no deterministic gate can find.

## What a sweep is

Five READ-ONLY gap-hunter agents, each enumerating the platform from a different angle
and diffing it against the current checklist. Different angles catch different miss
classes — the 2026-08 sweep's finds (4 factually-stale waivers, the untested built-in
apps, sharing rules, the ACTION_LOCATIONS matrix) each came from a different angle a
single reader would not have covered.

| angle | enumerate from | catches |
|---|---|---|
| 1. Console UI surfaces | objectui packages (app-shell chrome, plugin-*, e2e specs) | interactions covered piecemeal but never as a surface (drag, guards, personalization, buttons) |
| 2. Spec enums | every `z.enum` / union / const array in packages/spec/src + the formula function lib | behavior-bearing enums with no `variants` matrix |
| 3. Routes & runtime | ALL route ledgers (runtime, rest, service-*, auth) + non-ledgered mounts | routes reachable but semantically untested; dispatcher-vs-hono seams (#3361 class) |
| 4. Built-in apps | packages/apps/{setup,studio,account} page by page | admin/user pages nobody walked; settings/session/org surfaces |
| 5. Docs claims | content/docs/capabilities/*.mdx, release plans, showcase tours | promised capabilities with no item; docs advertising retired features (PD#10) |

## How to run it

1. **Read the current state first** — every `areas/*.json`, `coverage.json`, and this
   dir's README/RUNNER. The gap is only real if nothing already covers it.
2. **Dispatch the five hunters in parallel**, READ-ONLY (they write no files). Each
   returns a structured gap table: `surface | evidence path | current coverage (item id
   or NONE/partial) | proposed item id | sketch | stock fixture?`. Give each hunter the
   list of already-resolved gaps so they don't re-report.
3. **Dedupe** the five reports into one register (the 2026-08 sweep used a
   `PENDING-GAPS.md` scratch file, since deleted). Overlap is expected and is signal —
   a gap found from three angles is high-priority.
4. **Author** the new items via per-area writer agents, one area file per writer so
   they never collide. Every item follows the deep-test contract in README.md; a fixture
   that doesn't exist is a `blocked`/`knownGap`, never faked coverage.
5. **Reconcile `coverage.json` centrally** (a single writer): un-waive any kind a hunter
   proved has a stock fixture, map new items to their kinds, pin `enumSource` on any new
   variants matrix.
6. **Validate** `node scripts/check-platform-checklist.mjs` until green, then land the
   run record under `runs/` and surface product defects / docs drift to the maintainer
   in `FOLLOW-UPS.md`.

## Discipline that made the 2026-08 sweep trustworthy

- **Ground every claim in source before asserting** — hunters cite real file paths;
  writers read the cited source before writing a clause. Several briefs I gave the
  writers were factually wrong (`referenceFilters` renamed to `lookupFilters`,
  crm-workbench is React not declarative, MCP-off is 404 not 501) and the agents
  corrected them against source rather than parroting.
- **Stale waivers are the highest-value find.** Four of six coverage waivers turned out
  false (api/datasource/mapping/hook all ship stock fixtures). Re-audit every waiver
  each sweep — a waiver is a claim that ages.
- **Defects found while grounding go to FOLLOW-UPS.md as expected-fail probes**, not
  silent passes; security-sensitive ones are not filed publicly without the maintainer.
