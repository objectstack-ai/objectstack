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

**Who sees a red gate.** `pnpm check:platform-checklist` is not wired into per-PR CI (a
standing maintainer decision — see the README's "Operating cadence"), so the channel that
sees its red is
[`.github/workflows/platform-checklist-watchdog.yml`](../../../.github/workflows/platform-checklist-watchdog.yml):
it runs the gate on `main` daily, files or refreshes exactly one issue when the gate is red,
and does nothing at all when it is green.

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
- `blocked` / `not-run` — nothing consulted;
- `planned` — the item's `status` is `planned`: the definition requires the capability
  and the platform does not verify it yet. Read off the item, never derived from a run.

**No verdict without evidence.** A clause with no captured artifact is `not-run`, not
`pass`. Evidence means: the API/network trace, the screenshot, the log excerpt, or the
test-run output the clause's `evidence` field names.

**A `planned` item is never driven, and never scores.** `scripts/checklist-select.mjs`
returns it in no selector's runnable set — it prints the matches under a separate
PLANNED heading and hands the runner only what can run. Carry each one into the run
record as `planned`, with no clause table: there are no `steps` to follow and no
`acceptance` to consult, so ⛔ it is never `pass`, never `fail`, never `blocked` and
never `not-run`. The distinction that matters is against `blocked`: a blocked item is a
**real test** the environment cannot run today, so its gap is a fixture debt and the
right answer is to provision it; a planned item has **nothing to run at all**, so its
gap is a platform debt and the right answer is to build the capability. Scoring one as
the other sends the next sweep to fix the wrong thing. A planned item earns `active`
only through a run record in which it passed — see the README's "Implementation status".
The completion criterion is unchanged by them: an area is run when every item the
selector handed you has a verdict; planned ids are listed, not chased.

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
     withheld pending maintainer`; the reproduction stays in the runner session, and the run
     ends there with that report — a one-shot runner has no channel to wait on. Existence
     published, recipe withheld, is a complete and actionable report — getting a defect
     fixed never requires handing anyone a working exploit. (Maintainer disclosure ruling,
     2026-08-18, recorded on #9387; the `checklist-test` skill states the same guardrail in
     the same terms — one rule written in both places, not a precedence claim by either.)
     **No other failure class is softened by this**: everything else owes its reproduction
     rule in full.
3. **Classify blockers honestly.** Missing seed/persona/fixture → `blocked(fixture)`,
   and *record the gap on the item* (`fixtures.knownGaps` or `blocked`) so the next
   sweep doesn't rediscover it. A defect in the fixture itself (seed silently failing,
   as in #3408/#3415) is a **`fail` against the seed**, not a block — "nothing reports
   this" was the actual bug.
4. **Both sides of every gate.** For any permission/visibility/feature gate, verify
   presence for the entitled persona AND absence (or server-side rejection) for the
   unentitled one. UI absence alone is a client courtesy; the server is the authority.
   (That rule is `ADR-0124 D1`, and this rule is its verification half — `ADR-0124 D5`
   states it directly: a test that asserts only that the interface hides something has
   tested the courtesy layer and left the enforcement point unobserved.)
   Where feasible, prove denial with a direct forged request.
5. **Severe findings are hypotheses.** "The whole surface is unreachable" gets
   disproven-or-confirmed via screenshot + the server's own metadata before it is
   written down (the golden rule of the dogfood skill).
6. **Don't re-prove what automation pins.** If `automated.ref` is set, run that test
   and cite its output as the evidence; drive the browser only for what the pin doesn't
   cover. The reverse also holds: when a sweep hand-proves something repeatedly,
   propose promoting it to a permanent test and set `automated` in a revision.

   **A pin scores only the layer it drives.** Before a pin scores a clause whose oracle
   is a public door's answer (an HTTP status, an error envelope, a row the door left
   behind), name the layer the pin reaches — a **plugin unit** (one plugin's hooks or
   middleware over a stub), the **engine** (a real ObjectQL engine and driver, no HTTP),
   or **HTTP** (a booted server answering the door) — and write that layer in the
   clause's evidence. Read it off the pin's own harness, never off its file name or its
   `automated.ref` prose: a stub terminal standing in for the engine means "lands" is
   "the middleware called `next()`", and nothing below it ran. A pin that stops above
   the layer the clause's oracle sits at scores that clause **`partial`**, naming the
   missing layer, and the live leg is driven, or recorded `blocked` with its fixture
   cited. It never scores `pass`. The instance that made this a rule is
   `access-security.no-active-org-session-semantics`: the `group` CONTROL of
   `no-active-organization-write-refusal.test.ts` "lands" a write by a member with no
   active organization at the plugin-security layer, two rounds scored the walled legs
   from it while a walled boot was refused, and on a full walled `group` boot the engine
   answers that same write with a 500 (#24784).
7. **Verify pass for high-stakes claims.** For P0 `fail`s and any finding that would
   ship or block a release: a second, independent agent re-derives the verdict from the
   captured evidence alone (not from the first agent's narrative) before it is acted
   on. Disagreement → re-run the item.
8. **Keep an off-clause probe budget.** Clauses only ask what someone already thought
   to ask. Every run keeps time AFTER its clauses have verdicts for probing the doors its
   selector covers past those clauses — on the same boot, as the same personas. Probe
   where a clause stops:
   - **boundary values** on the inputs the clauses drive: the empty string, a missing
     id, an unknown id;
   - **the opposite severity or posture** of a path a clause asserts: the `warning`
     twin of an `error` rule, `group` beside `isolated`;
   - **recipients or readers outside the asserted scope**: who else a notification,
     share or read reaches.

   A probe is not a clause, so it scores nothing and no item verdict moves on it. A
   finding that passes the filing gate is extracted like any other product defect (see
   "Extraction obligation" below), and its card carries
   `QA-source: #<run record> · <area.item> · observed beside the clauses`, naming the
   item whose doors were probed. A probe that finds a gap the ledger should have asked
   about is also a checklist-accuracy finding for the wave's anchor card: the clause it
   was missing. The run record states how long the probes took and what they covered
   (doors, personas, the boundary classes tried), and says so when the budget was
   spent on nothing. A record that omits the probe line reads as a run that skipped it.
   Round 3 of the 18.0 sweep (QA run #24779) found #24781 and #24782 this way, beside
   items whose clauses all passed.

### Environment facts the runner should not re-derive

Standing facts about the stock showcase environment that have each cost a run a
detour. They are briefing material, not verdicts — re-confirm one only when a run
contradicts it, and correct it here when it does.

- **`view` is in the overlay-allowed set, so authoring a view on the stock read-only
  showcase package is NOT blocked and needs no escape hatch.** The org-overridable
  types are derived from the metadata-type registry, not a hand-written list, and are
  exactly **`view`, `dashboard`, `report`, `translation`, `email_template`**
  (`packages/spec/src/kernel/metadata-plugin.zod.ts` — the `allowEnvironmentOverlay: true`
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
  needs-fixture, 8 skipped` on stock showcase — with no `PROVEN`/`HOLES` line anywhere.
  Adding `--rls` appends the RLS block. ⛔ Do not cite plain `verify` output as the
  oracle for an RLS clause — that run never consulted one.

  **The discriminator is the PRESENCE of a `PROVEN`/`HOLES` line, never its digits.**
  The counts move with the seed set and are recorded here only as the shape to expect:
  the CRUD tail read `15 verified` through 2026-08-18 and `16` on 17.1.0 because
  the showcase gained one object (`client-brief.object.ts`, added between the two sweep
  subjects), and reads `15 verified … 1 needs-fixture, 8 skipped` again by 2026-10-01
  (QA run #21056, re-measured for #21060): one object moved from verified to skipped,
  the 24-object total unchanged. A run whose digits differ has a different seed, not a
  regression. Re-derive the number, do not file it.

  ⚠️ **The `--rls` block prints TWO summary lines in DIFFERENT units — do not compare
  them.** `formatRlsReport` (`packages/verify/src/rls.ts`) emits a per-persona
  `── <n> PROVEN (<n> consistent, <n> HOLES) · <n> NOT PROVEN (…)` for the probe
  persona, then — once position personas have run — a total line
  `══ all personas: … [unit: one object × persona probe]`. The first counts OBJECTS for
  one persona; the second counts object × persona PAIRS across all of them, and the
  source stamps that unit into the line precisely so the two are not read as one number
  moving. Measured on 17.1.0: the total line reads
  `all personas: 38 PROVEN (38 consistent, 0 HOLES) · 226 NOT PROVEN`, alongside
  `9 of 9 declared position(s) probed`; re-measured 2026-10-01 (#21060), the total line is
  unchanged and the positions read `10 of 10` — the showcase declares ten positions
  now (digits only, as above). An older note here recorded
  `20 PROVEN … over 23 objects` — that was the per-persona line, so it is **not
  comparable** to the total rather than merely stale. Name which of the two lines you
  are quoting whenever you cite either.

- **Playwright needs an explicit `executablePath` on these containers.**
  `@playwright/test` 1.63.0 (the `^1.63.0` `examples/app-showcase/package.json` declares, the
  only version in the store) resolves chromium build **1243**; only **1194** is installed.
  Re-measured at `bfc1539fe0`: this entry read 1.62.1 and build 1234 until the tree moved
  to 1.63.0; `playwright-core` sits only in the pnpm store (there is no root
  `node_modules/playwright-core`), so the check reads it there.
  **Check:**
  `grep -A2 '"name": "chromium"' node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/browsers.json`
  against `ls $PLAYWRIGHT_BROWSERS_PATH` (`/opt/pw-browsers` here, holding
  `chromium-1194` / `chromium_headless_shell-1194` only). The stock
  `examples/app-showcase/playwright.config.ts` sets no `executablePath`, so every test
  dies at browser launch — the error names the **headless-shell** variant it wanted
  (`Executable doesn't exist at .../chromium_headless_shell-1243/...`), which is the
  signature to recognise. Pass `launchOptions.executablePath=/opt/pw-browsers/chromium`
  (for the smoke, `OS_TEST_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`, which the
  config reads since #21060) and the same specs pass (verified: Playwright launches through it, reporting Chromium
  141.0.7390.37, and drives a real page). ⚠️ Use that **alias**, not the versioned
  `chromium-1194/chrome-linux/chrome` beneath it: `/opt/pw-browsers/chromium` is a
  symlink maintained by the image build, so it still resolves after the image moves to
  1243, while the versioned literal stops existing at exactly that moment — and a dead
  path copied out of this section is the `absence-inference` trap one level up.
  **The discriminator is uniformity:** a launch/environment failure
  takes down the whole run at once (`showcase-smoke.spec.ts` generates one test per
  `SURFACES` entry — 49 today, so "49 failed" means all of them), while a product defect
  fails selectively. ⛔ Do not file a whole-run red as a product defect before checking
  the browser resolved.

- **`?id=` on `/api/v1/meta/app` keys on the app NAME, never the package id.** The filter
  matches `a.name === id` against the App document's identity (`packages/rest/src/rest-server.ts`),
  and App declares no `id` of its own. `?id=com.example.showcase` (the package id, from
  `objectstack.config.ts`) returns `{"items":[]}` — which reads exactly like "the app
  metadata is gone", the highest-value false P0 shape there is. Real names: `showcase_app`
  (showcase), `setup` / `account` (the platform built-ins a stock boot registers). ⚠️
  **An empty `items` has two distinct causes** — a wrong spelling, or an app that is
  genuinely not registered. `studio` is the standing instance of the second cause: the
  App document is defined (`packages/platform-objects/src/apps/studio.app.ts`) and
  packaged (`packages/apps/studio`, `com.objectstack.studio`), but **no stock boot loads
  it, by design** — both boot paths skip it with the identical note, "`@objectstack/studio`
  is intentionally NOT default-loaded — the console ships a dedicated Studio surface at
  `/_console/studio/<pkg>/<pillar>`, so Studio no longer needs to exist as a navigable
  app tile" (`packages/plugins/plugin-dev/src/dev-plugin.ts`, the ADR-0048 app-package
  loop; `packages/cli/src/commands/serve.ts`, same loop — both register only
  `@objectstack/setup` and `@objectstack/account`). So `?id=studio` is legitimately empty
  on every stock boot, not just on the showcase, and a stock admin list is
  `["showcase_app","setup","account"]`. ⛔ Do not file the absence as a missing built-in,
  and do not install the package to "restore" it — that changes what the boot ships.
  **Check:** fetch `/api/v1/meta/app` with no query first and read the names it actually
  returns, then filter.

- **A boot on its own non-3000 port breaks the showcase's self-pinging connectors
  unless you export `OS_PORT` — `-p` alone is not enough, and the symptom impersonates an
  egress block.** The showcase's REST/OpenAPI connector instances point at the running
  server itself, resolved by `resolveShowcaseSelfUrl()`
  (`examples/app-showcase/src/system/self-url.ts`) in this order: `SHOWCASE_SELF_URL` →
  `OS_PORT` → `PORT` → the literal `http://127.0.0.1:3000`. Those are **environment**
  reads. The CLI's `-p` flag is only a *default sourced from* `OS_PORT`
  (`packages/cli/src/commands/serve.ts`: `port: Flags.string({ char: 'p', … default:
  readEnvWithDeprecation('OS_PORT','PORT') ?? '3000' })`) and nothing writes the variable
  back, so the dogfood §0 boot on its own port — `objectstack dev … -p <port>` with the env
  untouched — listens on `<port>` while every declarative connector dials **3000**. Every
  dispatch then fails `connector_action(showcase_status_api.request) failed: fetch failed`.
  ⚠️ **That string is not evidence of a sandbox network restriction**, and reading it as
  one is the expensive mistake: the module's own header records that #7516 burned a run
  proving it was an address problem by putting a TCP forwarder on 3000, and #7538 fixed
  the resolution but could not fix a boot that never exports the variable. **Check:**
  before scoring any connector clause, read the instance's own metadata —
  `GET /api/v1/meta/connector/showcase_status_api`, field `item.providerConfig.baseUrl`,
  which is the value `resolveShowcaseSelfUrl()` produced
  (`examples/app-showcase/src/system/connectors/index.ts`). ⛔ Not
  `GET /api/v1/automation/connectors`: that route lists registry descriptors — `name`,
  `label`, `type`, `description`, `icon`, `origin`, `state`, `degradedReason`, `actions`
  (`getConnectorDescriptors()`, `packages/services/service-automation/src/engine.ts`) —
  and carries no `baseUrl` at all. On `os dev` the value follows the serving process's
  environment, not the compiled artifact. Measured on `main` at `2889760a`: `-p 47311`
  alone answered `http://127.0.0.1:3000`, and `showcase_declarative_connector_ping`
  (fired by a `showcase_task` create) failed `fetch failed`; `OS_PORT=47312` with
  `-p 47312` answered `http://127.0.0.1:47312` and the same flow completed, while
  `dist/objectstack.json` still held `http://127.0.0.1:3000`. Only an artifact-only boot
  (`os start --artifact`) freezes the value at build time (the `self-url.ts` header). If
  it names a port your server does not listen on, the fixture is misconfigured, not
  blocked. **Fix:** boot with `OS_PORT=<port>` exported (or
  `SHOWCASE_SELF_URL=http://127.0.0.1:<port>`) *in addition to* `-p <port>`. ⛔ Do not
  record a connector clause as `blocked(environment)` on the strength of `fetch failed`
  alone.

- **Package-authored scheduled work is OFF on a stock boot — no `schedule` or
  `time_relative` flow binds and no packaged `defineJob` is scheduled unless you export
  `OS_AUTOMATION_SCHEDULED_WORK_ENABLED=1`.** The switch is an environment read,
  `resolveScheduledWorkEnabled()` / `resolveScheduledWorkPolicy()` in
  `packages/types/src/env.ts`: unset, empty, or anything other than `true` / `1` / `on` /
  `yes` (case-insensitive) is off, in every tenancy posture, and `os dev` sets nothing for
  you. Every binder reads that one answer — the automation engine's trigger bind and its
  `/_status` row (`packages/services/service-automation/src/engine.ts`), the schedule
  trigger (`packages/triggers/trigger-schedule/src/schedule-trigger.ts`), and AppPlugin's
  declarative-job loop, which logs `declarative jobs NOT scheduled — …` at info level
  (`packages/runtime/src/app-artifact-handlers.ts`). It does not gate platform-internal
  jobs (approvals escalation, the lifecycle Reaper, the messaging dispatch loop).
  **Check:** the boot banner. Measured on `main` at `2889760a` with the canonical boot
  below: a default boot printed `32 flow(s) 19 bound` and `1 flow declares a 'schedule'
  trigger but is NOT bound — disabled by deployment policy …: showcase_scheduled_digest`
  (the same line for `time_relative`: `showcase_task_due_reminder`), and
  `GET /api/v1/automation/_status` answered `bound: false` with that reason for both; the
  same boot with the switch exported printed `21 bound`, `_status` answered
  `bound: true` for both, and `showcase_scheduled_digest` completed its first run
  (`trigger.type: 'schedule'`) within a minute. **Fix:** export the switch before the boot,
  beside `OS_PORT`. ⛔ Do not score a clock-driven clause on a default boot, and do not
  file the unbound flow: it is the deployment policy working, not a trigger defect.

- **A per-boot `OS_HOME` and `OS_STORAGE_LOCAL_ROOT` do NOT isolate a package install —
  boot every item that installs a package from a scratch copy of the app, never from the
  shared tree.** install-local caches each installed manifest under the server's
  **working directory**, `.objectstack/installed-packages/`
  (`packages/cloud-connection/src/local-manifest-source.ts`, `DEFAULT_INSTALLED_PACKAGES_DIR`
  resolved against `process.cwd()`; the CLI mounts the plugin with no `storageDir`), so
  a boot started in `examples/app-showcase` writes into the checked-out tree, and every
  later boot from that tree rehydrates the package. **Check:** `ls
  examples/app-showcase/.objectstack/installed-packages/` after the install leg — any
  file there means the install escaped. ⚠️ `git status` cannot see it: `.objectstack` is
  in the root `.gitignore`, so a clean status is no evidence either way. Items this applies to:
  `platform-core.marketplace-install-local-lifecycle` and
  `platform-core.marketplace-console-honesty`. A QA run that installed from the tree
  wrote a CRM manifest there for 25 s before removing it through
  `DELETE /api/v1/marketplace/install-local/<id>` (#23163).

- **`ss` is not installed in these containers — read liveness with `curl`, never a socket
  table.** `ss` and `netstat` are both absent (`command not found`); `lsof` and `fuser`
  are present. The trap is that the usual spelling hides the cause: `ss -ltn | grep`
  sends the error to stderr and prints nothing, so a **live** server is indistinguishable
  from a dead one — empty stdout, exit 1, no clue why. **Check instead:**
  `curl -s -o /dev/null -w '%{http_code}' http://localhost:PORT/api/v1/health` (substitute
  the real port). This is "zero hits needs a positive control" applied to one tool: a
  negative from a command that never ran is not evidence.

- **`rsync` is not installed in these containers — copy a scratch app with `tar` or `cp -a`.** QA run #24841 met it.

- **A SIGTERM to the `pnpm` wrapper does not stop the server under it — start a
  backgrounded boot with `setsid` and stop its process group.** The canonical boot (in the
  `--no-ui` entry below) is `pnpm -C … exec objectstack dev …`: pnpm spawns `os dev`, which
  spawns `serve --dev` (`packages/cli/src/commands/dev.ts`). `os dev` forwards a SIGINT or
  SIGTERM sent to its own pid to that child (its `process.on('SIGTERM', …)` handler calls
  `beginShutdown()` of `ServeRestartCoordinator`, `packages/cli/src/utils/dev-restart.ts`),
  but nothing forwards one sent to pnpm, so `kill` on the pnpm pid leaves the `serve`
  grandchild listening. Both runners of the 18.0 sweep's round 3 met it (wave anchor
  #24579 §6). Measured at
  `46bb5e3e54` with a stand-in tree, `pnpm -C examples/app-showcase exec node parent.js`
  where `parent.js` forwards SIGTERM to an HTTP child as `os dev` does: two seconds after a
  SIGTERM to the pnpm pid the child still answered 200, and a SIGTERM to the process group
  stopped all four processes. ⚠️ `$!` is not the group id: a backgrounded `setsid` forks
  when the shell made it a group leader, so `$!` names a process that has already exited.
  **So:** `setsid pnpm -C … exec objectstack dev … > LOG 2>&1 &`; once the port answers,
  read the group from the listener, `PGID=$(ps -o pgid= -p "$(lsof -ti tcp:PORT)" | tr -d ' ')`;
  stop it with `kill -TERM -- -$PGID`, and confirm `lsof -ti tcp:PORT` then prints nothing.
  ⛔ Never stop a server by name (`pkill`), and never a group you did not start.

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

- **A stock showcase boot refuses self-registration — no item can mint a member by
  "fresh sign-up".** The showcase declares no `auth.audience`, so its posture is the
  `invite_only` default (`packages/plugins/plugin-auth/src/audience-posture.ts`:
  `resolveAudience` — undeclared ⇒ `invite_only`; the migration entry
  `audience-posture-default-invite-only` records the flip), and
  `POST /api/v1/auth/sign-up/email` for an address holding no pending invitation answers
  **`403 SELF_REGISTRATION_CLOSED`** (`decideAudienceAdmission` in the same file; the code
  is in the ADR-0112 ledger, `error-code-ledger.zod.ts`). QA run #21056 met it on every
  member persona it needed. Two doors mint one instead:
  1. **Invite, then sign up.** As admin, `POST /api/v1/auth/organization/invite-member`
     with `{"email": "EMAIL", "role": "member"}`; a pending, unexpired `sys_invitation`
     row for that address is what admits the following `sign-up/email`
     (`packages/plugins/plugin-auth/src/auth-manager.ts`, `hasPendingInvitationFor`).
     ⚠️ **The sign-up does not apply the invitation's role.** It binds the new user to the
     Default Organization as `member` whatever role was invited, and leaves the invitation
     `pending` (`reconcileMembership` in
     `packages/plugins/plugin-auth/src/reconcile-membership.ts` writes `role: 'member'`). For
     any other role (`admin`, `owner`), the persona — signed in as itself — then sends
     `POST /api/v1/auth/organization/accept-invitation` with `{"invitationId": "ID"}` (the
     `id` the invite-member call answered, or the row its own
     `GET /api/v1/auth/organization/list-user-invitations` lists). Acceptance writes the
     invitation's role onto that membership and the invitation reads `accepted`
     (`adoptExistingMembership` in `packages/plugins/plugin-auth/src/adopt-membership.ts`,
     which never lowers a grade; pinned by `accept-invitation-adopt-membership.test.ts`
     beside it, 6 passed at `bfc1539fe0`). The invitee's email need not be verified: the
     deployment declares `requireEmailVerificationOnInvitation: false`. QA run #24616 met it:
     an `admin` invitation signed up as `member`, and the persona held `org_admin` only after
     the accept. **Check:** read the persona's `sys_member` row (`role`) before scoring a
     role-gated clause, never the invitation you sent.
  2. **Admin create.** `POST /api/v1/auth/admin/create-user`, which answers
     `mustChangePassword: true` by default
     (`packages/plugins/plugin-auth/src/admin-user-endpoints.ts`, `runAdminCreateUser`);
     have the persona `POST /api/v1/auth/change-password` before driving it.

  The worked example is the shared recipe `search:qa-contributor-bound-member`
  (`areas/search.json`), whose `requires` carries the invite ahead of its step-1 sign-up.
  Wherever an item still says "fresh sign-up", read it as an identity minted one of these
  two ways. ⛔ Do not record a member clause `blocked(fixture)` on the strength of the 403,
  and do not file it: the refusal is the posture working. The seeded demo personas
  (`examples/app-showcase/src/security/demo-personas.ts`, password `showcase123`) are
  loginable already, but they hold fixed positions, so they fit only where an item names
  them.

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

- **`--no-ui` is a flag of `serve` and `start`, NOT of `dev` — boot flags are not portable
  between the three, in either direction.** Measured on `main` at `736cfb14` by reading
  each command's own `--help` FLAGS block:

  | boot command | console flag | `--artifact` |
  |---|---|---|
  | `os dev` | `--ui` — **no negation**, so `--no-ui` is a parse error | `-a, --artifact` |
  | `os serve` | `--[no-]ui` | ⛔ not a flag here |
  | `os start` | `--[no-]ui` | `-a, --artifact` |

  `dev` is the odd one out on `ui`, which is why the flag gets carried across to it:
  `objectstack dev --no-ui` never runs — `Error: Nonexistent flag: --no-ui`, exit **2**.
  The absence is real and not a help-rendering artifact: `dev` *does* render
  `--[no-]compile`, `--[no-]restart` and `--[no-]seed-admin`, and in a single
  `dev --no-restart --no-ui` run the parser names only `--no-ui`. It cuts the other way
  too — `serve --no-ui --artifact <path>` rejects only **`--artifact`**. **Check:**
  `<cmd> --help`; the `--[no-]x` spelling in FLAGS is the only proof that `--no-x`
  parses. ⛔ Never copy a flag from a sibling command's line.

  **The canonical checklist boot is one invocation, and it makes no `ui` decision to get
  wrong** (the same line dogfood skill §0 prescribes — a checklist run wants the console):

  ```
  pnpm -C <abs>/examples/app-showcase exec objectstack dev --ui --seed-admin -p <port> -d file:/tmp/<run>/data.db
  ```

  `--ui` on `dev` is a no-op forwarder onto `serve`'s `default: true` (`dev` forwards
  `--ui` only when set, and never forwards a negation), so it is written out for intent,
  not effect. Use the line as-is and the off switch never comes up.

  ⚠️ **Why this is briefed rather than left to the error message: backgrounded — which is
  how a runner boots a server — a rejected flag looks exactly like a server that booted
  and died.** The process is gone, nothing is listening, and the usage dump scrolls past
  in a log nobody reads until the first request times out — at which point the reader
  starts debugging the **application**, which was never started. Since #10181 the CLI
  says so in its own first line, ahead of the usage dump:

  ```
  objectstack: INVOCATION ERROR — Nonexistent flag: --no-ui. The command never ran: nothing was started and nothing is listening. Invoked as: objectstack dev --no-ui
  ```

  **So: when a backgrounded boot never answers, read the FIRST line of its log before
  touching the app** — `INVOCATION ERROR` means the parse failed and no application code
  ran. The same commit gave the other boot-lookalike a voice:
  `node packages/cli/dist/index.js` (the package `main`, a re-export barrel) now refuses
  by name and exits **1**, where it used to exit **0** in silence — the entry point is
  `packages/cli/bin/run.js`.

- **Some items carry an `automated.ref` that lives ENTIRELY in the `objectui` repo — from
  this checkout they are neither runnable nor pin-evidenced.** No count is kept here: the
  set moves with every pin re-point and every `automated` edit, and the count this line
  used to carry went stale with nothing to notice it (wave anchor #24579). **Find them by
  the rule, not by a number:** an item is in the set when its `automated.ref` names an
  objectui path and no path that exists in this checkout. Their refs name only
  objectui paths (`e2e/live/*.spec.ts`, `e2e/import-console/*`, `e2e/import-harness/*`,
  and unit suites under `packages/plugin-grid`, `plugin-gantt`, `plugin-calendar`,
  `plugin-form`, `fields`, `core`, `app-shell`). This repository builds no console bundle
  and holds none of those specs, so a run here can neither execute the pin nor cite its
  output. **Every one of those items now says so in its own `fixtures.knownGaps`** — the
  rediscovery this fact exists to stop (each sweep re-derived it from scratch). ⚠️ The
  distinction that matters is *exclusive*: items whose `automated.ref` names an
  objectui spec **alongside** a framework pin (`packages/qa/dogfood/**`,
  `packages/objectql/**`) are partly runnable here — run the framework half and score the
  objectui half separately, never one for the other.

  **Two honest options, and the run record must say which it took:** (a) drive the item
  **by hand** in the browser against a live boot and score it as a manual browser run —
  the `automated` field does not make it exempt; or (b) run the pin inside an **objectui
  checkout at the pinned revision** and cite that output, **naming the revision** (the
  17.1.0 sweep subject was `9a3daf8d37ad`). ⛔ Never record such an item as covered on the
  strength of the `automated` field alone: an unrun pin is a claim, not evidence — which
  is the same "ticking on a label" failure clause-grained acceptance exists to prevent.

- **A walled boot is a fixture of its own: `os serve` boots `group` and `isolated` once the
  walled prerequisites are provisioned, and the stock showcase provisions none of them.**
  18.0.0 boots a walled posture: under ruling record 6282882793 on the v18 epic it is
  published only after 18.x step 4 (#24580) has merged, and step 4 deleted the boot refusal
  (`walledPostureRefusal()` in `packages/cli/src/commands/serve.ts`). Of the builds published
  so far, only the `18.0.0-next.5` prerelease carries that refusal, as `main` did from
  `ae6bd1a6` until step 4: `next.0` to `next.3` predate it, and no `next.4` was published.
  So on 18.0.0
  `OS_TENANCY_POSTURE=group` or `isolated` (or the legacy `OS_MULTI_ORG_ENABLED=true`, which
  `resolveTenancyPosture()` in `packages/types/src/env.ts` reads as `isolated`) boots through
  `os serve`, and so `os dev` and `os start`. Through `os dev`, each prerequisite below
  refuses the boot with a FATAL naming itself when absent (QA run #24783 measured all three),
  so a refusal tells the runner what is missing, never that the posture is unsupported:
  1. the multi-org runtime **declared by the app**: `@objectstack/organizations` in the app's
     own `package.json` and installed there. Reachable only through `NODE_PATH` or a hoisted
     store is refused on purpose (ADR-0093 D5). No example app declares it, so a walled run
     uses a scratch app that does: a **full copy** of `examples/app-showcase`, `src/`
     included (without `node_modules`, `.objectstack` or `dist`), whose own `package.json`
     carries every showcase dependency as a `link:` to its workspace package plus
     `"@objectstack/organizations": "link:<abs>/packages/plugins/organizations"`, installed
     from the copy with `pnpm install --ignore-workspace` (QA run #24783). A scratch config
     that only re-exports the showcase's `objectstack.config.ts` does not boot: a package-file
     reference resolves against the root being served, and the showcase's OpenAPI connector
     names its document that way (`spec: './src/system/connectors/status-openapi.json'` in
     `examples/app-showcase/src/system/connectors/index.ts`, read relative to the package
     root at materialization, where a missing document fails the boot);
  2. `OS_PLATFORM_OWNER_EMAIL`, the deployment's platform administrators: first-registrant
     promotion is off under a wall;
  3. a declared membership policy, `OS_AUTH_MEMBERSHIP_POLICY` (for example `invite-only`).

  ⚠️ **A bare `os serve` in production mode judges none of the three until it has an auth
  secret.** Without `--dev`, and with `NODE_ENV` anything but `development`, `serve` composes
  the auth family only when `OS_AUTH_SECRET` (or a legacy spelling) resolves —
  `resolvePlatformAuthComposition()` in `packages/core/src/stack-auth.ts`, reason
  `no-secret` — and all three checks sit behind it: the multi-org runtime is loaded inside
  `serve.ts`'s auth-composition branch, the owner-email check runs in `AuthPlugin`'s `init()`
  (`packages/plugins/plugin-auth/src/auth-plugin.ts`), and the membership-policy gate skips a
  kernel with no `auth` service (`assertWalledMembershipPolicyDeclared()` in
  `packages/plugins/organizations/src/membership-policy-gate.ts`). With the secret unset the
  boot prints `⚠ AuthPlugin skipped — set OS_AUTH_SECRET …` and comes up
  `⚠ Server is ready — DEGRADED: missing core services: auth` (`printServerReady()` in
  `packages/cli/src/utils/format.ts`), not a FATAL: QA run #24783 measured it with
  `os serve --no-ui` from the scratch app, once with prerequisite 2 absent and once with
  prerequisite 3 absent. A production `serve` also needs a stable encryption key,
  `OS_SECRET_KEY` or a key file an earlier boot persisted; without one `LocalCryptoProvider`
  refuses the boot naming `OS_SECRET_KEY`
  (`packages/services/service-settings/src/local-crypto-provider.ts`). `os dev` needs
  neither: it spawns `serve --dev`, whose development boot falls back to
  `DEV_AUTH_SECRET_FALLBACK` (`resolveAuthSecret()`, same `stack-auth.ts`) and persists a key.
  `os start` hands its `serve` child an auth secret (its `--auth-secret` flag, the
  environment, or the `auth-secret` file it persists in its home directory) and opts the
  provider into a persisted key (`OS_CRYPTO_AUTOKEY`), in `packages/cli/src/commands/start.ts`
  — read from the code, not booted. **So:** boot a walled run through `os dev`, or give a bare
  `serve` `OS_AUTH_SECRET` and a stable key first. ⛔ Never read a DEGRADED walled boot as
  "the prerequisites are met", and never score a walled clause on it.

  **Walled personas come from the admin door.** The walled boot keeps self-registration
  closed: the showcase declares no `auth.audience`, so `POST /api/v1/auth/sign-up/email`
  answers **`403 SELF_REGISTRATION_CLOSED`** exactly as on a stock boot
  (`decideAudienceAdmission()` in `packages/plugins/plugin-auth/src/audience-posture.ts`; the
  entry "A stock showcase boot refuses self-registration" above). QA run #24783 minted every
  walled persona as the operator (the seeded admin, the address `OS_PLATFORM_OWNER_EMAIL`
  names) with `POST /api/v1/auth/admin/create-user` (`runAdminCreateUser()` in
  `packages/plugins/plugin-auth/src/admin-user-endpoints.ts`), then had each persona
  `POST /api/v1/auth/change-password`. Under `invite-only` each lands with
  `membershipCreated: false` and in no organization (the reconciler's `policy-skip`,
  `reconcileMembership()` in `packages/plugins/plugin-auth/src/reconcile-membership.ts`); a
  persona that needs an organization creates its own with
  `POST /api/v1/auth/organization/create` and switches to it with `set-active` (the next
  entry).

  Measured at `45898dbf6`: a scratch app declaring the real runtime, booted by the built CLI
  under `isolated` with the other two set, mounted `Organizations`, answered
  `GET /api/v1/discovery` 200 and logged no system-write refusal. The seven walled
  e2e cases in `packages/cli/test/serve-organizations-*.e2e.test.ts` spawn that boot.
  **So:** score a walled clause's live leg on such a boot, and its pins as its item says.
  A run that does not provision the walled boot records the leg `blocked(fixture)`, naming
  this entry and the missing prerequisite — never `fail`, and never on a faked posture.
  Each item that carries such a leg names it in its own `fixtures.knownGaps`.

- **A stock `single` boot holds exactly one organization, and no door mints a second; a
  walled boot mints them through the auth API.**
  `POST /api/v1/auth/organization/create` answers **`403 ORGANIZATION_CREATION_DISABLED`**
  wherever the effective posture enforces no organization wall (`beforeCreateOrganization`
  in `packages/plugins/plugin-auth/src/auth-manager.ts`, the same derivation `/auth/config`
  publishes as `features.multiOrgEnabled: false`; pinned by
  `packages/plugins/plugin-auth/src/org-create-posture-gate.test.ts`), which is every stock
  boot: the stock showcase boots `single`. `sys_organization` offers no create over the
  data API (`apiMethods: ['get', 'list', 'update']`,
  `packages/platform-objects/src/identity/sys-organization.object.ts`). On a stock boot
  `POST /api/v1/auth/organization/set-active` therefore has the Default Organization, or
  null, to switch between. On a walled boot (the entry above) a signed-in user creates an
  organization with that same `POST /api/v1/auth/organization/create` and switches to it
  with `set-active`; the walled dogfood suites
  (`packages/qa/dogfood/test/wall-*.dogfood.test.ts`) create two that way. **So:** a clause
  that needs a second organization (an org switch mid-flow, organization A against B) is
  scored on a walled boot. On a stock boot record its live leg `blocked(fixture)` with this
  entry cited, and score what its pins prove. A run that stages the second organization
  with a system write (QA run #24560 did) scores a fixture of its own making, not a stock
  boot, and its record says so. QA runs #24560 and #24558 met the 403; the pin reports 25
  passed at `bfc1539fe0`.

- **One container builds one tree at a time: never run `pnpm build` and
  `pnpm objectui:build` together, and give the heavy steps a concurrency the shell's memory
  can hold.** `pnpm objectui:build` (`scripts/build-console.sh`) runs `turbo run build` in
  THIS checkout as well — `@objectstack/spec` when its dist is absent or incomplete,
  `@objectstack/client`, and every `@objectstack/*` package the objectui pin overrides,
  declarations included — so a `pnpm build` beside it writes the same `packages/spec/dist`
  from a second turbo process nothing serialises, and the spec's DTS pass races (the 18.0
  sweep, #24579 §6). The shell's cgroup is capped near 13.4 GiB (`memory.limit_in_bytes`
  read `14343688192` on the cgroup `/proc/self/cgroup` names, at `bfc1539fe0`), and the
  console's dependency build is `turbo run build --filter=@object-ui/console^...` at turbo's
  default concurrency unless overridden. The 18.0 sweep's runner held both under that cap
  only at `--concurrency=2`, and the Tier 1 vitest pins only at `--maxWorkers=1`, and was
  killed with exit **137** otherwise (#24579 §6; QA run #24598's environment fingerprint
  records the settings that held; the OOM itself is not re-run here). **Fix:**
  `pnpm build --concurrency=2` first; then
  `OBJECTUI_DEPS_BUILD_CMD='pnpm exec turbo run build --concurrency=2 --filter=@object-ui/console^...' pnpm objectui:build`
  (the override the script's header documents); vitest one package at a time with
  `--maxWorkers=1`. ⛔ An exit 137 is the container's memory limit, not a failing test or a
  broken build — re-run narrower before reading anything into it.

- **`OS_TEST_TIERS` narrows `packages/cli`'s vitest population, and only that package's —
  a cli pin named under the wrong setting runs no test at all.** `scripts/nightly-tiers.mjs`
  is the one reader of the switch: unset (or `queue`) collects every test file EXCEPT the
  nightly tiers, `*.e2e.test.*` and `*.live.test.*`; `nightly` collects exactly those
  (`testFilesOnDisk()` in `packages/cli/vitest-tiers.ts`). `packages/cli` owns every tier
  file in the tree (`node scripts/nightly-tiers.mjs --packages`: 1 package, 83 files, at
  `bfc1539fe0`), so the switch moves nothing anywhere else. The 18.0 sweep met both
  directions: a `*.e2e.test.ts` pin (`serve-organization-record-page.e2e.test.ts`) collects
  nothing without `OS_TEST_TIERS=nightly` (QA runs #24556 / #24558), and with it set, 28 of
  the 29 cli files the Tier 1 rerun named ran 0 tests (QA run #24598, #24579 round 2).
  **Fix:** run a cli `*.e2e.test.*` pin in an invocation of its own with
  `OS_TEST_TIERS=nightly`, and every other cli pin without it. ⛔ A named file that collects
  no test is not a pass, and here it is not a stale ref either — re-run it under the other
  setting before fixing the item.

- **`scripts/qa/qa-rollup.mjs` has two blind spots a runner meets at close-out.** (1) Only a
  BARE area name classifies as an area: `classifySelector('platform-core')` answers `area`,
  while `area:platform-core` — the selector spelling `checklist-select.mjs` takes — answers
  `other`, so a record titled with it rolls up outside its area (16 records of 2026-10-16,
  #23926 among them, do). Title an area run with the bare name, `QA run · platform-core (…)`,
  as this sweep's records do. (2) Behind this container's egress proxy the roll-up dies on
  its second page: it follows GitHub's `Link: rel="next"`, which names
  `https://api.github.com/repositories/<id>/issues?…`, the proxy refuses numeric-id paths
  **403** ("Numeric-ID repository paths … are not supported through this proxy"), and
  `fetchRunRecords` throws on any non-OK page — measured at `bfc1539fe0` with 130 `qa-run`
  records, so page 1 (100) is all it reads. The same page asked for by number on the named
  path, `repos/objectstack-ai/objectstack/issues?labels=qa-run&state=all&per_page=100&page=2`,
  answers 200 (#24579 §6). ⛔ That 403 says nothing about access to the repository: run the
  roll-up where the proxy is not in the path, or read the pages by number.

- **A map view draws its markers under a "Map failed to load" banner here, because the
  default base style is unreachable — an environment fact, not a product defect.** The
  console's map uses `https://demotiles.maplibre.org/style.json` unless the view declares a
  style (objectui `packages/plugin-map/src/ObjectMap.tsx`, `DEFAULT_MAP_STYLE`, the same at
  the pin `4016370a` QA run #24616 ran and at the pin `12dc7b47c340` #24660 moved it to), and
  this container's egress proxy refuses that host
  (`curl https://demotiles.maplibre.org/style.json` → `CONNECT tunnel failed, response 403`,
  at `bfc1539fe0`). The map's `error` event then renders an amber `role="alert"` banner,
  "Map failed to load (…). Markers below are still listed in the search box", over a canvas
  that still carries the markers (QA run #24616, `records-forms.view-type-gallery`).
  **So:** score the markers and the record list. ⛔ Do not file the missing tiles, and do
  not read the banner as the map failing.

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
| `absence-inference` | a missing flag/key/script read as a missing capability | follow the forwarding chain to where the default is actually decided, before writing the finding down. A scaffold's bare `objectstack dev` still serves the console: `dev` forwards `--ui` only when set and never forwards a negation, and the default is decided one hop downstream by `serve`'s own `ui` flag (`default: true, allowNo: true`) — so absence means ON. ⛔ The off switch `--no-ui` is `serve`'s and `start`'s; `dev` has no such flag and rejects it (environment facts above) |
| `auth-state-leak` | a per-persona matrix scored against ONE identity — the previous persona's credentials survived the switch, so a gate reads as holding (or as fallen open) for a caller that never made the request | prove the identity server-side before each cell (the session row, or `GET /auth/get-session`), never from the gesture that was supposed to switch it; give each persona its own session. ⚠️ Both halves have to go: the console's `localStorage` bearer token survives a `clearCookies()` gesture and a form sign-in ALSO sets `better-auth.session_token` (environment facts above), so an "anonymous" or "non-admin" cell can silently still be the admin's |
| `cache-staleness` | a read answered from a cache instead of re-resolved: the row this run just planted or edited reads back unchanged, or one persona's body is replayed for the next | before scoring, confirm the response carries something this run set (the planted spelling, the new `audience`); re-fetch with a client of its own per persona rather than reusing a response. ⚠️ Two independent read doors disagreeing may be one door's cache rather than the drift the item is hunting |
| `eventual-consistency` | a deferred write read before it settles — an effect that has not landed yet reads as a refusal, and a state the reconciler is about to fill reads as durable | prove the state from its own record (the session row / session payload), never from the symptom you are about to test; prefer the durable producer over the racy one and record which the verdict rests on; re-read after a settle window before writing an absence down |
| `clock-skew` | a relative window resolved against a different instant than the expectation was computed from — a run that spans a rollover, or a server clock that is not the runner's | record the wall clock BEFORE the first request and derive every expectation from that one instant; reconcile each preset against a literal-window query computed from the same clock, and re-run any window whose boundary the run crossed |
| `timezone-boundary` | rows near midnight or a period edge landing on the other side of a calendar window, because the window is anchored in a different zone than the runner assumed | record the zone alongside the clock and compute the expected window in the zone the door resolves in; score against the literal-window query, never against an intuition about "today" |
| `silent-coercion` | a 200 that reads as the contract holding while the input was converted across types — or the predicate dropped entirely, so the request succeeds meaning something other than what was authored | never score on status alone: compare what came back against what was sent, and the returned row count against the UNFILTERED count — a dropped predicate answers over the full table, which is the dangerous direction |
| `destructive-in-place` | a clean re-run — the first run already rewrote the input it is judged against, so the second observation describes a different tree | run against a scratch copy / a database you own; checksum (or snapshot) the input before and after and cite the pair; check which arm actually writes before replaying — a preview arm is read-only only until `--apply` |
| `first-boot-cold-start` | a 404 / empty body / white screen from a first boot still doing its one-time work, read as the first-run-only defect the item exists to hunt | read the boot log and wait for the server's own serving line before the first probe: a never-built tree compiles on the way up (`dev` spawns `os compile` when no `dist/objectstack.json` exists) and seeds admin on a zero-user DB, neither of which a warm re-boot repeats. ⛔ Do not write a first-run defect down before re-probing a warm boot |

## Run records — the GitHub issue is the report

Every completed sweep run (a release candidate, an area or `all` run, or a maintainer-named
target) — **pass or fail alike** — files **one GitHub issue** as its durable record, labeled
`qa-run` and nothing else (extraction obligation below). **A verification re-run files
none** — a run whose trigger is the same PR's ledger edit of that item. Its per-item verdict
table goes in the PR body and the item's `history` row carries the PR as its `ref`; a
`partial` or `blocked` gap goes in the PR body and the item's `fixtures.knownGaps`; a
product-defect `fail` is still extracted as its own card, pointing at the PR; a stale clause
is fixed in the same diff (`.claude/skills/checklist-test/SKILL.md` §5, 「验证重测」).
**Nothing lands in the repo** — not the JSON, not screenshots; `runs/` is git-ignored except
its README.

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
carve-out excepted) · derived item verdicts + fixture gaps · the off-clause probe line
(rule 8: how long, which doors and boundary classes, what it found). The durable,
version-controlled truth is still the checklist under `areas/`; a run is a dated assertion
about one build, and it lives in its issue, not the tree.

### The record title — one canonical shape

Maintainer ruling 2026-08-20: the title is a **contract**, not prose, and it has exactly
one shape. `scripts/qa/qa-rollup.mjs` parses it **strictly** — a title that deviates is
printed in the roll-up's "Not parsed" section instead of being absorbed, so a mistake is
visible the first time rather than degrading the view silently.

```text
QA run · <selector> (<judged>/<total>) · <framework-sha8> · <YYYY-MM-DD> · <counts>
```

| field | rule |
|---|---|
| separator | `·` (MIDDLE DOT), **exactly five fields**, never more or fewer. A selector that would contain the separator cannot be spelled — rename it. |
| `QA run` | the literal prefix, unchanged |
| `<selector>` | what this run selected; carries no parentheses of its own |
| `(<judged>/<total>)` | **mandatory**, bare digits only, `judged` not greater than `total`. Not decoration — it is the coverage claim the record is read on. |
| `<framework-sha8>` | exactly 8 lowercase hex characters |
| `<YYYY-MM-DD>` | a real calendar date |
| `<counts>` | ` / `-separated `<n> <VERDICT>` segments; verdicts **uppercase**, in the order `PASS / PARTIAL / FAIL / BLOCKED / NOT-RUN`, each bucket at most once |

**An omitted bucket means "not declared", never zero** — the roll-up renders the two
differently, so write `0 FAIL` when you mean zero.

**⛔ `planned` items appear nowhere in this title** — not inside `<total>`, and not as a
sixth bucket. The counts vocabulary is closed at the five verdicts above, and a planned
item was never a judgeable unit of this run: putting one in `<total>` deflates the
coverage claim the record is read on, and inventing a `PLANNED` segment is a deviation
the roll-up refuses to parse. They are named in the body, under the scope section that
already records the selector.

**Retired phrasings — ⛔ none of these may be written again:** `(FULL area)`, `(N items)`,
`(N of M items)`, `(N/M items consulted)`, omitting the parenthetical entirely, and the
trailing `(11 not-run)` spelling of NOT-RUN. `(FULL area)` is why the ruling exists: it
declares no total, and a record wearing it judged 13 of its area's 33 items while reading
as complete coverage. A run that reached 1 of 12 items writes
`(1/12) · … · 0 PASS / 1 PARTIAL / 11 NOT-RUN` — `not-run` is an honest verdict and the
title has to show it.

Existing records are **not migrated**; the ruling is new-records-only. Records written
before the contract keep their shapes, and the roll-up lists them separately, labelled as
predating it rather than as defects. Run `node scripts/qa/qa-rollup.mjs` after filing —
that is this step's self-check.

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
