# Runner protocol — executing the checklist accurately

How an AI agent runs [the platform checklist](./README.md) so that its verdicts can be
trusted. Every rule here was paid for: the #3358 sweeps produced three showcase-defect
discoveries, two real regressions — and also one self-inflicted false alarm and several
"ticked on a label" temptations. The protocol turns those lessons into mechanics.

Prerequisite reading: the **dogfood-verification** skill
(`.claude/skills/dogfood-verification/SKILL.md`) — environment isolation (§0), the
build/runtime model incl. the vendored-console staleness trap (§2), and the
anti-false-positive rule (§3). This file assumes it and adds the checklist-specific
contract.

## Verdicts

Per **clause** (each acceptance entry gets exactly one):

| verdict | meaning |
|---|---|
| `pass` | oracle consulted, expectation held, evidence captured |
| `fail` | oracle consulted, expectation violated, evidence captured, issue filed |
| `blocked` | could not consult the oracle — carries `{by: fixture\|environment\|dependency\|product-bug, ref}` |
| `skipped` | deliberately not attempted this run (out of scope) |

Per **item**, derived — never hand-assigned:

- `pass` — every clause passed;
- `partial` — some passed, none failed (the "proved half, left it unticked" state from
  #3358, now first-class instead of a prose apology);
- `fail` — any clause failed;
- `blocked` / `not-run` — nothing consulted.

**No verdict without evidence.** A clause with no captured artifact is `not-run`, not
`pass`. Evidence means: the API/network trace, the screenshot, the log excerpt, or the
test-run output the clause's `evidence` field names.

## The accuracy rules

1. **Oracle hierarchy** — server truth (`api`, `network`, `build`, `test`) outranks
   `screenshot`, which outranks `dom`. A `dom` oracle may only be consulted **after** a
   screenshot (or equivalent) confirms the surface rendered — post-navigation DOM dumps
   return transitional emptiness and are the #1 source of fake "P0: feature missing"
   findings (dogfood skill §3).
2. **`fail` is expensive, on purpose.** Before recording one:
   - reproduce it **twice**, on fresh loads;
   - run the *automation self-check*: could your own driving have caused this?
     Coordinate-based clicks, React controlled-input fills, and shared browser tabs
     have each produced convincing fake bugs (#3358 had to retract a "dead approve
     button" that was a coordinate-click artifact — a ref-targeted click worked);
   - check the `traps` field and rule each listed trap out;
   - for console UI failures, confirm against current objectui source or a fresh build
     — the vendored `/_console` bundle may be stale (skill §2);
   - then capture the **reproduction rule** — ordered steps / API calls (method · path ·
     body) / the ref-targeted selector path + expected-vs-actual — into the run's result
     issue. A `fail` with no reproduction rule in its issue is not a completed verdict.
     (The screenshot that convinced you is a live judgment aid, not report content —
     describe what it showed in one line; never attach it.)
   - **Carve-out — authentication and authorization findings only.** ⛔ Never publish a
     reproduction for an authentication or authorization hole **anywhere on GitHub**: not
     the run issue, not a tracking or extracted card, not a comment. Relocating it is not a
     mitigation — a tracking card is a public issue in a public repo just the same. Such a
     `fail` **is a completed verdict** when it records the item id, the clause, and `detail
     withheld pending maintainer`; the reproduction stays in the runner session, and the
     runner stops there and waits for the maintainer. Existence published, recipe withheld,
     is a complete and actionable report — getting a defect fixed never requires handing
     anyone a working exploit. (Maintainer disclosure ruling, 2026-08-18, recorded on
     #9387; the `checklist-test` skill states the same guardrail in the same terms — one
     rule written in both places, not a precedence claim by either.) **No other failure
     class is softened by this**: everything else owes its reproduction rule in full.
3. **Classify blockers honestly.** Missing seed/persona/fixture → `blocked(fixture)`,
   and *record the gap on the item* (`fixtures.knownGaps` or `blocked`) so the next
   sweep doesn't rediscover it. A defect in the fixture itself (seed silently failing,
   as in #3408/#3415) is a **`fail` against the seed**, not a block — "nothing reports
   this" was the actual bug.
4. **Both sides of every gate.** For any permission/visibility/feature gate, verify
   presence for the entitled persona AND absence (or server-side rejection) for the
   unentitled one. UI absence alone is a client courtesy; the server is the authority
   (ADR-0057 D10) — where feasible, prove denial with a direct forged request.
5. **Severe findings are hypotheses.** "The whole surface is unreachable" gets
   disproven-or-confirmed via screenshot + the server's own metadata before it is
   written down (the golden rule of the dogfood skill).
6. **Don't re-prove what automation pins.** If `automated.ref` is set, run that test
   and cite its output as the evidence; drive the browser only for what the pin doesn't
   cover. The reverse also holds: when a sweep hand-proves something repeatedly,
   propose promoting it to a permanent test and set `automated` in a revision.
7. **Verify pass for high-stakes claims.** For P0 `fail`s and any finding that would
   ship or block a release: a second, independent agent re-derives the verdict from the
   captured evidence alone (not from the first agent's narrative) before it is acted
   on. Disagreement → re-run the item.

### Environment facts the runner should not re-derive

Standing facts about the stock showcase environment that have each cost a run a
detour. They are briefing material, not verdicts — re-confirm one only when a run
contradicts it, and correct it here when it does.

- **`view` is in the overlay-allowed set, so authoring a view on the stock read-only
  showcase package is NOT blocked and needs no escape hatch.** The org-overridable
  types are derived from the metadata-type registry, not a hand-written list, and are
  exactly **`view`, `dashboard`, `report`, `translation`, `email_template`**
  (`packages/spec/src/kernel/metadata-plugin.zod.ts` — the `allowOrgOverride: true`
  entries; pinned by `protocol.org-scoped-write-refused.test.ts` G5). So
  `PUT /api/v1/meta/view/<name>` answers 2xx on stock showcase with no
  `OS_METADATA_WRITABLE` and no `?package=` trick, while the same shape on `object`,
  `field`, `hook`, `seed`, `mapping` or `flow` is refused. ⛔ Do not record a view
  step as `blocked(environment)` on a "the showcase package is read-only" assumption:
  read-only-ness is per metadata TYPE here, not per package, and the read-only-package
  lock the console renders is a *different* gate (see
  `access-security.readonly-package-locks-studio`).

- **`objectstack verify --rls` is a separate invocation — bare `verify` prints no RLS
  section at all.** `runRlsProofs` runs only behind the flag
  (`packages/cli/src/commands/verify.ts`: `rls: Flags.boolean({ default: false })`, the
  proofs sit inside `if (flags.rls)`, and the report prints `if (rls)`). **Check:** the
  last block of a bare run is the CRUD summary — `── 15 verified, 0 gaps, 0 FAILED, 1
  needs-fixture, 7 skipped` on stock showcase — with no `PROVEN`/`HOLES` line anywhere.
  Adding `--rls` appends the RLS block: `20 PROVEN (20 consistent, 0 HOLES)` over 23
  objects, plus `9 of 9 declared position(s) probed`. ⛔ Do not cite plain `verify`
  output as the oracle for an RLS clause — that run never consulted one.

- **Playwright needs an explicit `executablePath` on these containers.**
  `@playwright/test` 1.62.1 resolves chromium build **1234**; only **1194** is installed.
  **Check:** `grep -A2 '"name": "chromium"' node_modules/playwright-core/browsers.json`
  against `ls $PLAYWRIGHT_BROWSERS_PATH` (`/opt/pw-browsers` here, holding
  `chromium-1194` / `chromium_headless_shell-1194` only). The stock
  `examples/app-showcase/playwright.config.ts` sets no `executablePath`, so every test
  dies at browser launch — the error names the **headless-shell** variant it wanted
  (`Executable doesn't exist at .../chromium_headless_shell-1234/...`), which is the
  signature to recognise. Pass `launchOptions.executablePath=/opt/pw-browsers/chromium`
  and the same specs pass (verified: Playwright launches through it, reporting Chromium
  141.0.7390.37, and drives a real page). ⚠️ Use that **alias**, not the versioned
  `chromium-1194/chrome-linux/chrome` beneath it: `/opt/pw-browsers/chromium` is a
  symlink maintained by the image build, so it still resolves after the image moves to
  1234, while the versioned literal stops existing at exactly that moment — and a dead
  path copied out of this section is the `absence-inference` trap one level up.
  **The discriminator is uniformity:** a launch/environment failure
  takes down the whole run at once (`showcase-smoke.spec.ts` generates one test per
  `SURFACES` entry — 31 today, so "31 failed" means all of them), while a product defect
  fails selectively. ⛔ Do not file a whole-run red as a product defect before checking
  the browser resolved.

- **`?id=` on `/api/v1/meta/app` keys on the app NAME, never the package id.** The filter
  matches `a.name === id` against the App document's identity (`packages/rest/src/rest-server.ts`),
  and App declares no `id` of its own. `?id=com.example.showcase` (the package id, from
  `objectstack.config.ts`) returns `{"items":[]}` — which reads exactly like "the app
  metadata is gone", the highest-value false P0 shape there is. Real names: `showcase_app`
  (showcase), `setup` / `studio` / `account` (platform built-ins). ⚠️ **An empty
  `items` has two distinct causes** — a wrong spelling, or an app that is genuinely not
  installed. `studio` is defined (`packages/platform-objects/src/apps/studio.app.ts`) but
  the showcase does **not** install it, so `?id=studio` is legitimately empty there; a
  stock admin list is `["showcase_app","setup","account"]`. **Check:** fetch
  `/api/v1/meta/app` with no query first and read the names it actually returns, then
  filter.

- **`ss` is not installed in these containers — read liveness with `curl`, never a socket
  table.** `ss` and `netstat` are both absent (`command not found`); `lsof` and `fuser`
  are present. The trap is that the usual spelling hides the cause: `ss -ltn | grep :3000`
  sends the error to stderr and prints nothing, so a **live** server is indistinguishable
  from a dead one — empty stdout, exit 1, no clue why. **Check instead:**
  `curl -s -o /dev/null -w '%{http_code}' http://localhost:PORT/api/v1/health` (substitute
  the real port). This is "zero hits needs a positive control" applied to one tool: a
  negative from a command that never ran is not evidence.

- **Console session auth is a bearer token in `localStorage`, and a form sign-in ALSO
  sets a cookie — you need both halves.** The console's auth client stores the session
  under `auth-session-token` (objectui `packages/auth/src/createAuthClient.ts`:
  `TOKEN_STORAGE_KEY = 'auth-session-token'`) and sends it as an `Authorization` header;
  its own metadata-client note says outright that *"there is no session cookie"* for that
  path. Two consequences, and each has already misled a round on its own:
  1. **A `clearCookies()` gesture expires nothing.** The bearer token survives it, so the
     shell keeps rendering fully authed data — which reads exactly like the "dead shell
     serving stale data as if authed" failure the console-login item warns about, and
     nearly produced a false P0. **Check:** after the gesture, an in-page
     `fetch('/api/v1/meta/app?id=showcase_app')` still answers **200**. True expiry is
     server-side: `POST /api/v1/auth/sign-out` (clearing `localStorage` is the
     client-side equivalent); after either, the same fetch answers **401**.
  2. **The cookie is not decorative — some routes need it.** `better-auth.session_token`
     is set by a real form sign-in, and the storage family resolves its caller through
     better-auth's own `getSession` (`resolveSessionData` in
     `packages/runtime/src/security/resolve-session-principal.ts`) rather than the REST
     bearer seam. So a session driven with the localStorage token alone gets **401
     `AUTH_REQUIRED`** from `POST /api/v1/storage/upload/presigned` while
     `GET /auth/get-session` on the same page returns 200 — a convincing fake "avatar
     upload is broken". ⛔ Do not drive any storage/upload surface from an injected
     token: **sign in through the form** so both halves exist.

- **A cold tree cannot boot the app from the console-build recipe alone.**
  `pnpm objectui:build` runs `scripts/build-console.sh`, which builds the **console**, not
  the framework CLI. On a fresh tree `packages/cli` has no `dist`, and the bare binary
  then answers `Error: command dev not found` (exit 2) — a message that names neither the
  cause nor the fix. **Check:** `node scripts/check-dev-prereqs.mjs`; it reports every
  package whose declared `dist/` entry point is missing, and exits non-zero. **Fix:
  `pnpm build`** — that is what the guard itself prescribes, and it is what turns the
  guard green. ⛔ A targeted `turbo run build --filter=@objectstack/cli...
  --filter=@objectstack/example-showcase...` is **not** enough: it makes the `objectstack`
  binary resolve `dev`, but measured here it still left 8 of 67 packages unbuilt, so
  `check:dev-prereqs` stays red and `pnpm dev` still refuses to boot. Note the root
  `pnpm dev` script runs that guard **before** booting, so a runner who uses `pnpm dev`
  gets the diagnostic and the fix; the cryptic `command dev not found` only appears when
  the bare binary is invoked directly.

### Trap vocabulary (`traps` field)

| trap | what it fakes | counter |
|---|---|---|
| `hydration-race` | empty nav/list right after navigation | screenshot first; settle; then read DOM |
| `stale-console-bundle` | UI bug already fixed upstream in objectui | check against objectui HMR console / fresh build (skill §2). `os dev` refuses to mount a console whose stamp ≠ the `.objectui-sha` pin, so a 404 `/_console/` reads "rebuild with `pnpm objectui:build`", never "console broken" |
| `stale-dist` | src edits with no runtime effect | rebuild package + restart before judging |
| `automation-input` | dead buttons / empty submits caused by the driver | ref-targeted clicks; native setter + input/change events |
| `shared-browser-tab` | drifting origin, foreign drafts | pin absolute origin; own port/DB (skill §0) |
| `seed-data-thin` | features with nothing to show; silent seed rejections | check row counts vs built artifact; read boot log |
| `single-datapoint` | charts "render" but prove little | prefer multi-bucket fixtures; note weakness in evidence |
| `dispatcher-vs-hono-route` | route exists in unit tests, 404s on the real server | oracle = live server trace, never simulated dispatch |
| `wrong-panel` | feature looks missing on a sibling surface | item's `steps` name the exact surface; check it |
| `wrong-persona` | admin privileges mask a guard | run guard checks as the non-privileged persona |
| `absence-inference` | a missing flag/key/script read as a missing capability | follow the forwarding chain to where the default is actually decided, before writing the finding down. A scaffold's bare `objectstack dev` still serves the console: `serve`'s `ui` flag is `default: true, allowNo: true`, so `--no-ui` is the off switch and absence means on |

## Run records — the GitHub issue is the report

Every completed run — **pass or fail alike** — files **one GitHub issue** as its durable
record, labeled `qa-run` and nothing else (extraction obligation below). **Nothing lands
in the repo** — not the JSON, not screenshots; `runs/` is git-ignored except its README.

**The issue is text only.** Screenshots and DOM dumps are oracles you consult *live* to
reach a verdict — never report artifacts. What the report carries for a defect is the
**reproduction rule**: ordered steps / API calls (method · path · body) / the
ref-targeted selector path + expected-vs-actual from the oracle, enough to re-hit it on a
fresh boot with no picture — **except under rule 2's authentication/authorization
carve-out**, where the report carries the item, the clause and `detail withheld pending
maintainer`, and nothing else. A clause whose oracle was a screenshot is recorded as a
one-line text description of what it showed, not a link.

The in-environment JSON scratch (RUNNER shape, never committed):

```jsonc
{
  "run": "2026-08-07-v17-release-sweep",
  "date": "2026-08-07",
  "scope": "since:v17 + P0",            // the filter that selected items
  "app": "showcase",
  "env": {
    "framework": "<commit sha>",
    "objectuiPin": "<.objectui-sha>",   // stale-bundle honesty: record what the console was
    "port": 3456, "db": "file:/tmp/<run>/data.db"
  },
  "runner": "<agent/session identifier>",
  "results": [
    {
      "id": "approvals.per-group-signoff",
      "revision": 1,                     // ← the revision this verdict is valid for
      "verdict": "pass",
      "clauses": [
        { "clause": 0, "verdict": "pass", "evidence": "…text: what the oracle returned — no image links…" }
      ],
      "issues": [],                      // filed failures / fixture gaps
      "notes": "…"
    }
  ]
}
```

The issue body is: env fingerprint · scope (selector + per-item `revision`) · the
per-clause verdict table (text oracle evidence) · a reproduction rule per `fail` (rule 2's
carve-out excepted) · derived item verdicts + fixture gaps. The durable,
version-controlled truth is still the checklist under `areas/`; a run is a dated assertion
about one build, and it lives in its issue, not the tree.

### Extraction obligation — the run record is a protocol carrier, not work

Run issues are excluded from the PM's backlog sweep, same class as the `pm:seat` post
(maintainer ruling, 2026-08-17: 「把 qa-run 加进 sweep 排除清单 —— run 记录和 pm:seat
贴同类:协议载体,不是工作」). Nobody fishes a run record for dispatchable work — so
closing out the report includes the extraction, owed by the runner:

- **The run issue carries run evidence only.** It is ⛔ not a dispatchable unit, and it
  ⛔ never carries work labels (`bug`, priority, …) — work labels ride the extracted
  cards.
- **Product defects found during the run**: at close-out, extract each one into its own
  standalone issue — self-contained title, reproduction and mechanism itemized in the
  card, a pointer back to the run record for the full evidence chain. A defect card does
  not carry `qa-run`; it enters triage first-touch normally. ⛔ An authentication or
  authorization defect is extracted under rule 2's carve-out — item, clause, `detail
  withheld pending maintainer`, no recipe. The extracted card is public too.
- **Checklist-accuracy findings and fixture gaps** close out through the wave's anchor
  card (the sweep's tracking issue) — ⛔ not extracted.
- **Environment blockers**: recorded in the run record is enough.
