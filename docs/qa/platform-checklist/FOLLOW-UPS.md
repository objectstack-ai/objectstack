# Follow-ups — open items from the capability-coverage sweeps

Standing decision register, one section per sweep (append, never rewrite — a resolved
row stays with its resolution so the next sweep can see what was already decided).
Sections §1–§4 are the **2026-08-08** sweep; §5 is the **2026-08-17** re-audit (R4).

Decision register from the capability-coverage sweep. The gap items found by the
five-angle sweep have all been authored into `areas/*.json` (checklist grew 84 → 170
items; the `api`/`datasource`/`mapping` coverage waivers were corrected). What remains
here is what the sweep surfaced that is **not** a checklist item: product defects to
decide on, and docs that promise retired capabilities.

## 1. Product defects found during the sweep (decide handling)

These are real runtime/UI defects the gap hunters hit while grounding items. Each is
captured inside the relevant checklist item as an **expected-fail probe** (so a run
records the actual behavior instead of ticking green), but they are defects, not test
gaps. The one security-sensitive finding (D1) has since been fixed in #6683.

| # | defect | evidence | captured in | sensitivity |
|---|---|---|---|---|
| D1 | **Saved-report schedule routes now owner-gated** — the schedule delete/list routes were brought under the same parent-report owner check as the other report routes (deny-as-404). | packages/plugins/plugin-reports/src/report-service.ts | dashboards.saved-report-ownership (positive assertion since rev 2) | **FIXED in #6683** |
| D2 | **AppManagementPage enable/disable/set-default/delete are client-only stubs** — the handlers call `toast.success()` with a `TODO: Replace with real API call` and issue no request; an admin sees "success" while nothing changes. | objectui apps/console/src/pages/system/AppManagementPage.tsx | platform-core.app-management-toggle (expected-fail probe) | UX-integrity — safe to file |
| D3 | **`useGlobalUndo.executeOp` issues a bare `ds.update` with no `ifMatch`** — record undo can silently clobber a concurrent edit (no OCC guard on the undo path). | objectui react/src/hooks/useGlobalUndo.ts | records-forms.record-edit-undo (observe-and-flag clause) | correctness — safe to file |
| D4 | **`SharedViewLink` builds dead `/share/<object>/<view>?token=` URLs** — client-generated token, no matching console route (only `/s/:token`), no server persistence. Registered but unused. | objectui plugin-view/src/SharedViewLink.tsx | — (not an item; demo-grade) | low — file a cleanup issue |
| D5 | **List "Share" button is a no-op** — renders when `schema.sharing` is set but has no onClick. | objectui plugin-list/src/ListView.tsx | — | low — file a cleanup issue |
| D6 | **`/api/v1/datasources` admin CRUD has no route ledger** — mounted by serve.ts, absent from rest-route-ledger.ts (tranche-3 discipline gap). | packages/services/service-datasource/src/admin-routes.ts | integration-system.datasource-admin-lifecycle (source note) | low — internal discipline |
| D7 | **Parent-only PATCH does not revalidate a stale dependent child** — `evaluateOptionVisibility` skips fields absent from the payload, so changing only the parent leaves a now-invalid child value in place server-side; integrity rests entirely on the client clear. | packages/objectql/src/validation/rule-validator.ts (`!(name in data) continue`) | records-forms.cascading-multilevel-and-clear (knownGap) | integrity — safe to file |
| D8 | **Lookup cascade scope is existence-only server-side** — `assertReferencesResolve` accepts any EXISTING id regardless of `lookupFilters` scope (a cross-account contact that exists is accepted on direct POST). May be by-design (filters = UI courtesy) — needs a maintainer ruling: declared ≠ enforced, or documented courtesy. | packages/objectql/src/engine.ts (assertReferencesResolve) | records-forms.cascading-multilevel-and-clear (knownGap) | integrity/design — needs ruling |

## 2. Docs promise capabilities the runtime doesn't deliver (PD#10, docs side — file docs issues)

The capability docs advertise features that were retired or never shipped. Under Prime
Directive #10 ("never advertise a capability the runtime doesn't deliver") these are
docs bugs, not checklist items.

- **Recycle bin / soft delete** — promised in `content/docs/capabilities/{data,integrations}.mdx`,
  but `enable.trash` was RETIRED ("every delete has always been a hard delete; soft delete
  parked at #3146", object.zod.ts retired-key guidance). → fix docs or ship the feature.
- **Recently-visited lists** — `enable.mru` retired/never implemented. The console DOES ship a
  recents rail (UnifiedSidebar) — reconcile whether the doc claim maps to that surface or a dead one.
- **TV display pages / discussion threads** — promised (analytics.mdx, build-without-code.mdx).
  Discussion = the real chatter surface (now covered by records-forms.record-discussion-mentions);
  display pages have no spec surface found → confirm removal or file.
- **Five data-depth scopes** (permissions.mdx) — `own_and_reports`/`unit`/`unit_and_below` are
  ENTERPRISE (hierarchy-security). The open checklist correctly drives own/org only. Optional both-sides
  probe: authoring an intermediate depth in the open edition must degrade LOUDLY (ADR-0049), not
  silently to `own` — could become a checklist item if you want it.

## 3. Fixtures worth adding (would un-block currently-blocked items)

The 8 `blocked` items are blocked on missing stock fixtures, not on the platform. Adding
these to the showcase would make them runnable:

- a `publicSharing.enabled` object → unblocks `access-security.share-link-capability-tokens`.
- one configured OIDC/social IdP → unblocks `identity-auth.oauth-app-consent-loop`,
  `linked-accounts-social`, and the existing `sso-enforced-first-paint`.
- a gantt view with `dependenciesField` + `lockField` + `parentField` → unblocks the
  fixture-gated variants of `records-forms.gantt-interactions`.
- a not-auto-bound audience suggestion → unblocks the confirm/dismiss half of
  `access-security.suggested-binding-loop`.
- the `IMPORT_CONSOLE_LIVE` import-harness backend → unblocks `records-forms.import-job-undo-cancel`.
- an approval-escalation clock-control/`runEscalations()` harness → unblocks `approvals.sla-escalation`.
- a second signed-up (non-admin) user in seeds, or a documented sign-up step in the runner →
  removes the recurring "needs a 2nd user" knownGap on several persona-gated items.

## 4. Notes

- `PENDING-GAPS.md` (the full deduped gap register that drove the authoring) can be deleted
  once you've reviewed §1–§2 above — it was scaffolding; this file is the durable residue.
- The checklist itself (`areas/*.json`, `coverage.json`, `README.md`, `RUNNER.md`,
  `scripts/check-platform-checklist.mjs`) ships in this branch; this file carries the
  decisions that remain with the maintainer.

## 5. Sweep 2026-08-17 (R4) — re-audit against the window since the 2026-08-08 ledger

Ledger 182 → 190 items; `coverage.json` 28 mapped / 2 waived → **30 mapped / 0 waived**.

### 5a. Docs drift (PD#10 class)

| # | drift | evidence | captured in |
|---|---|---|---|
| E1 | **Stale defect note in `packages/spec/liveness/doc.json`.** Its `_note` records "DocSchema declares no `tags`, yet the book-side `include: { tag }` rule and the REST corpus both expect one — the tag rule can currently never match". That defect is **fixed**: `DocSchema` now declares `tags` (`packages/spec/src/system/doc.zod.ts`, with the history spelled out in the surrounding comment). The ledger note now describes a bug that no longer exists, which is the same failure class this sweep is correcting in `SWEEP.md`. Outside this card's file surface (`docs/qa/platform-checklist/**`), so it is reported, not edited. | `packages/spec/liveness/doc.json` `_note` vs `packages/spec/src/system/doc.zod.ts` | — (liveness ledger prose, not a checklist item) |

### 5b. Checked and CLEAN (recorded so the next sweep does not re-derive it)

- **The blank template's `dev` script omits `--ui`, and that is CORRECT — the console is
  served anyway.** This sweep first read `"dev": "objectstack dev"` against the
  quick-start's `npx os dev --ui` and inferred that a newcomer running `npm run dev`
  would land on a server with no console. **Source-checking the chain refuted it**, and
  the refutation is recorded here because the inference is an easy one to make twice:
  - `packages/cli/src/commands/serve.ts` — `ui: Flags.boolean({ …, default: true,
    allowNo: true })`. The console is **default-ON** at `serve`; `--no-ui` is the off
    switch.
  - `packages/cli/src/commands/dev.ts` — `...(flags.ui ? ['--ui'] : [])`. `dev` only
    ever **adds** `--ui`; it never forwards `--no-ui`. With `dev.ts` declaring `ui`
    with no `default`, an unflagged `dev` spawns `serve` with no ui flag at all, so
    serve's own default takes over — on.
  - `content/docs/deployment/cli.mdx` says it outright: "`--ui` | Force Console UI on
    (**already on by default in dev**)", and `` documents `--ui / --no-ui … (default
    on)`.

  So `--ui` on `dev` is a **no-op forwarder**, there is no divergence between the
  template script and quick-start, and the newcomer is not stranded. What made the wrong
  reading tempting is `dev.ts`'s own flag description ("Enable the bundled Console
  portal at /_console/"), which reads like the mechanism when it is only a forwarder —
  not worth a change on its own, but worth knowing before inferring from it.
  `cli.scaffold-console-first-paint` clause 3 now asserts the two invocations **agree**,
  with a difference between them as the failure.
- **No published doc prescribes a retired scaffolder template.** Grepped all of
  `content/docs/` for `todo` / `compliance` / `content` / `contracts` / `procurement` as
  `-t` / `--template` operands: zero hits. Every documented invocation is a bare
  `npx create-objectstack my-app`, which resolves to `blank`, the only entry in
  `TEMPLATES`. The delisting is cleanly reflected on the docs side.
- **`npm run validate` and `npx os validate` are the same binary** (the blank template's
  `validate` script is `objectstack validate`), so the spelling difference between
  `cli.scaffold-first-run` and the quick-start is not a divergence.
- **The first-run *commands* are covered** by `cli.scaffold-first-run` (P1, CI-automated)
  and `studio-authoring.first-run-loop` (P0). Only the seam between them was open, and
  that is now `cli.scaffold-console-first-paint`. No duplicates were authored.

### 5c. For the maintainer

- **Both surviving coverage waivers were stale** (`book`, `doc`) and are retired in this
  PR — see `SWEEP.md` "Discipline". Running total: 6 of 6 waivers ever written turned out
  stale. Worth considering whether a waiver should carry a mandatory re-audit date.
- **Cost figures in the corrected `SWEEP.md` sentence are this run's own measurements**,
  which came out higher than the ones supplied with the card (validator ~0.12–0.18 s vs
  ~80 ms; `pnpm check:platform-checklist` ~2.9 s wall vs 0.165 s). The container was under
  load from a parallel cold monorepo install, and the `pnpm` wrapper's startup dominates
  the wall figure. The corrected text therefore records the *direct-node* cost (~0.25 s
  for self-test + validator) and explicitly warns that timing through `pnpm` measures the
  wrapper — a durable statement rather than a number that goes stale.
- **No security-sensitive finding to withhold from this PR.** The two highest-severity
  items authored (`access-security.no-active-org-session-semantics`,
  `integration-system.datasource-credential-refusal-matrix`) assert guards that are
  already shipped and already public in their ADRs/issues; nothing here discloses an
  unfixed hole.

## 6. Resolution 2026-08-18 — §3's fixture list, three of seven paid (#9308)

§3 above is left exactly as written; this section is its resolution row, per this file's
own append-never-rewrite rule. Three of the seven fixtures §3 asked for landed in
`examples/app-showcase/**`, and the checklist items they unblock were revised in the same
change (gap text kept and marked closed-by-fixture, `revision` bumped, `history`
appended — the #7670 pattern).

| §3 line | landed as | items unblocked |
|---|---|---|
| "a `publicSharing.enabled` object" | `showcase_client_brief` — `redactFields`, `maxExpiryDays`, and an `eligibility` predicate, with a `published` AND a `draft` brief seeded so the predicate is falsifiable | `access-security.share-link-capability-tokens` (was `blocked(fixture)`, now runnable) |
| "a second signed-up (non-admin) user in seeds" | both demo personas get a better-auth credential account at boot (`seed-approval-demo.ts` → `ensureCredentialAccount`), issuer derived from the dev admin's own row | `approvals.per-group-signoff`, `approvals.viewer-gating-submitter-side` (was `blocked(fixture)`), `approvals.ooo-delegation-reroute` |
| — (not in §3; found by #9308) | `showcase_client_liaison` — the app's first `readable: false` FLS grant | `access-security.fls-mask-and-strip` clause 5, whose UI half had no reachable fixture |

**Still open from §3, unchanged and still correctly listed there:** the OIDC/social IdP,
the gantt fixture variants, the not-auto-bound audience suggestion, the
`IMPORT_CONSOLE_LIVE` import harness, and the escalation clock-control harness.

**One fixture #9308 scoped but did NOT land: the writable-package summary field** for
`automation.rollup-summary-filter`'s editor half. It is not seed data and could not be
made into seed data. A writable package is a DB-backed `sys_packages` row plus authored
`sys_metadata` items (`isWritablePackage`: a booted CODE package is read-only by
definition, and the showcase is one), and a roll-up needs a parent AND a child object, so
the fixture is a boot-time metadata-authoring bootstrap that mints two tables on every
fresh boot of the reference app. Whether the showcase should ship a permanent writable
base is a showcase design call with consequences beyond this item — it is also the
contrast side `access-security.readonly-package-locks-studio` needs — so it is filed
separately rather than guessed at. The item keeps its `blocked(fixture)` and its
`knownGap` untouched.

## 7. Scoped sweep 2026-08-20 — 扫描功能 (scan functionality)

Scoped question from the maintainer: does the platform's scan functionality have test
coverage? Three read-only hunters (kernel security scanner · TOTP QR enrollment · every
other scan-shaped surface) diffed against the ledger. The testable gaps were authored in
the same change (identity-auth two-factor lifecycle ×4; cli doctor/doctor-scan/migrate-
duplicates/datasource-introspect/hook-body-gates/lint ×6; integration-system
introspection + drift gate ×2; attachments-storage server-side accept/maxSize;
platform-core interrupted-migration boot report — plus 3 stale-item revisions). What
follows is what is NOT a checklist item: inert surfaces, docs drift, defects, and one
governance hole.

### 7a. Declared-but-inert scan surfaces (ADR-0049 enforce-or-remove candidates — none are testable, none got items)

| surface | evidence | the deadness, precisely |
|---|---|---|
| `PluginSecurityScanner` (`packages/core/src/security/security-scanner.ts`) | zero constructors outside `packages/core/examples/`; not in plugin-loader, service-package, rest, or any CLI path | Exported dead code on the PUBLIC barrel (`packages/core/src/index.ts` re-exports `./security/index.js`). 3 of 5 scan methods are empty stubs; `scanDependencies` has a real loop whose only data source (`addVulnerability`, ``) has zero callers; `updateVulnerabilityDatabase` (``) is a log-only no-op. |
| `KernelSecurityScanResult` / `KernelSecurityVulnerability` / `PluginSecurityManifest.scanResults` (`packages/spec/src/kernel/plugin-security-advanced.zod.ts,476,625`) | no `.parse`/`.safeParse` site anywhere; only consumer is the dead scanner (type-only import) | 22 rows published to `packages/spec/authorable-surface/kernel.json` with zero authors and zero parsers. The whole `plugin-security-advanced` module has no runtime consumer. |
| `PluginQualityMetrics.securityScan` (`packages/spec/src/kernel/plugin-registry.zod.ts`) | spec self-test only | Nothing reads or writes it at runtime. |
| Marketplace/incident scan vocab (`marketplace.zod.ts` 'scanning' status, `marketplace-admin.zod.ts,193`, `incident-response.zod.ts` 'malware') | declared-only enum members, no producer in this repo | Cloud/EE surface. Same shape as the `'failed'`/`'expired'` upload statuses #7667 had to close: declared, published, no writer. |
| MetadataPlugin FS scan + `metadata-fs` boot scan (`packages/metadata/src/plugin.ts,270` — `watch ?? false`; `packages/runtime/src/standalone-stack.ts` hard-off; `metadata-fs` unwired from any `os dev`/`os serve` lane) | unit-pinned in-package only | No reachable fixture from any shipped boot; if a future lane wires `metadata-fs`, the boot-scan/watcher dot-entry divergence is the risk to test first. |

Compounding the first row: `packages/core/PHASE2_IMPLEMENTATION.md` advertises
the scanner as a working feature, tells readers to import from `@objectstack/core/security`
(a subpath `packages/core/package.json` does not export), and its sample fields
(`scanResult.passed`/`.score`/`.summary.critical`) do not exist on the actual schema —
the example (`examples/phase2-integration.ts`) sits outside every tsconfig and is never
typechecked. Enforce or remove; if removed, the spec-property-retirement playbook applies
to the authorable-surface rows.

### 7b. Docs drift (PD#10 class — file as docs fixes, not checklist items)

- **Phantom `contentProcessing` virus scanning** — `content/docs/protocol/objectql/types.mdx`
  and `` promise "thumbnail generation, virus scanning … under `contentProcessing`";
  `content/docs/data-modeling/validation-rules.mdx` redirects file-storage virus
  scanning to a connector setting. `contentProcessing` exists in exactly those doc lines —
  no schema key, no code, and no content inspection of any kind exists on the upload path
  (mimeType is trusted verbatim from the client body, `storage-routes.ts`). Both
  docs should say plainly the platform performs no upload-time content inspection; the new
  `attachments-storage.field-accept-maxsize-server-enforced` item records the same boundary
  on the QA side.
- **Dead remediation prescription in a live command — FIXED in #10882 (closing #10680),
  2026-08-21.** `doctor.ts` used to print "Run `objectstack codemod v2-to-v3` to auto-fix";
  no `codemod` command has ever been registered. At head the print site
  (`doctor.ts`) prescribes **no** command — it says no automated codemod ships
  with the CLI and routes the operator to the `→ replacement` already computed per finding,
  and `packages/cli/src/commands/doctor-deprecation-hint-commands.test.ts` pins the class so
  a future phantom prescription fails there rather than shipping. **A repoint at
  `os migrate meta` was considered and REFUSED**: its subject is an authored stack config,
  its header declines the AST rewrite as "unsafe and lossy", both its writes are `--out`
  JSON snapshots, and three of the eight `DEPRECATED_PATTERNS` are not metadata at all —
  reasoning at `doctor.ts`, refusal pinned at that test's ``. An earlier
  wording of this row prescribed that repoint; it is retracted, and it is what seeded the
  same suggestion in #10680 for #10882 to argue down — do not re-derive it.
  `content/docs/protocol/backward-compatibility.mdx` still records the codemod as "not
  yet available", but at head that is **consistent** with the tool rather than the
  contradiction this row cited it for: correct as written, deliberately not edited (#11420,
  and again here). The interim probe this row pointed at
  (`cli.doctor-deprecation-scan`'s expected-fail clause) is refreshed to a positive
  assertion in #11638.
- **`metadata-service.mdx`** presents `eager` bootstrap as "Scans filesystem … at
  boot (default)"; no shipped boot path scans (`watch` defaults false, `os dev` disables it
  explicitly). Stop advertising the scan as default behavior.
- **`admin-routes.ts` comment** claims a Studio "sync objects" consumer for
  `/remote-tables`; no such consumer exists in objectui/app-shell — the live callers are
  the two `os datasource` commands. Cleanup comment fix.

### 7c. Defects found while grounding (auth-integrity rows: maintainer decision before any public issue)

| # | defect | evidence | captured in | sensitivity |
|---|---|---|---|---|
| D9 | `sys_two_factor.verified` declares `defaultValue: true` while better-auth enrols `verified: false` and `AUTH_TWO_FACTOR_SCHEMA` does not map `verified` — if better-auth omits the column on insert, the ObjectQL default marks an unverified enrolment active | `sys-two-factor.object.ts`; `auth-schema-config.ts` | identity-auth.two-factor-verify-to-activate (observe-and-flag probe) | **auth-integrity — do not file publicly without maintainer** |
| D10 | `sys_user.generate_backup_codes` has no `resultDialog` — on the only navigable surface the user regenerates codes they are never shown; permanent-lockout path | `sys-user.object.ts` | identity-auth.two-factor-backup-codes (observe-and-flag) | UX-integrity/auth — maintainer call |
| D11 | `POST /api/v1/auth/two-factor/get-totp-uri` live re-reveal vs the reveal dialog's "shown only once" promise; endpoint absent from SDK ledger rows and targeted by no action | `auth-route-ledger.ts` vs `sys-two-factor.object.ts` | identity-auth.two-factor-enrollment-reveal (probe) | auth — maintainer call |
| D12 | `os doctor` false-PASS: `findMissingTests`/`findDeprecatedUsages` scan only `<cwd>/packages/spec/src`, so in any user app doctor prints "✓ Test coverage"/"✓ Deprecations" about a tree it never examined | `doctor.ts,1159-1161` → `✓` at `` | cli.doctor-health-report (expected-fail probe) | correctness — safe to file |
| D13 | `FileConstraintError` declares `code: 'ERR_FILE_CONSTRAINT'` but no `status`, and rest's `classifyDataError` has no branch for it — the server-side accept/maxSize refusal exits `/api/v1/data` as a sanitized **500 INTERNAL_ERROR** with the field-naming prose withheld from the body (the sibling `FileFieldBulkWriteError` docblock names `status: 400` as exactly what prevents this; same class as #7525) | `file-reference-lifecycle.ts,181-191`; `packages/rest` error-response classification | attachments-storage.field-accept-maxsize-server-enforced (wire-status recorded per run; a measured 500 is extracted as a finding, not scored as an enforcement fail) | correctness/wire-contract — safe to file |
| D14 | `MigrationRecoveryPlugin` is composed by NO boot path — `serve.ts` auto-registers `PlatformObjectsPlugin` but never the recovery plugin; standalone-stack, default-host, the showcase config, and the migrate CLI boot all omit it; only its unit test instantiates it. Interrupted-migration detection therefore never runs on any shipped boot, while `sys-migration-journal.object.ts` argues recovery must need "zero host wiring" | `packages/runtime/src/index.ts` (exported); `serve.ts` (what IS auto-registered) | platform-core.interrupted-migration-boot-report (fixtures an explicit registration; knownGap names the composition hole) | correctness/composition — safe to file |
| D15 | `extract-hook-body.ts`'s header promises "the build fails… no silent fallback" on a forbidden pattern, but the DEFAULT `os build` catches every extraction error and silently falls back to the.mjs bundle (`lower-callables.ts`), printing the warnings nowhere; only `--strict-body` (`compile.ts`) produces the worded refusals with exit 1. `hook-bodies.mdx` documents the warn-and-bundle default, so code comment and docs disagree with each other | `extract-hook-body.ts` vs `lower-callables.ts`, `compile.ts` | cli.hook-body-extraction-gates (default-path silent-fallback encoded as expected-fail contradiction clause) | correctness — safe to file |

Two design notes captured inside items rather than as defect rows: `sys_user.mfa_required_at`
is stamped lazily and never cleared anywhere in source, so post-disable re-gating branches on
a pre-existing stamp (identity-auth.two-factor-disable-lifecycle, design-note clause); and
`datasource.checkOnBoot` (spec `datasource.zod.ts`, default true, liveness-ledgered live)
is read by NO runtime code — the drift scan always runs — a declared≠enforced ADR-0049 shape
encoded as a finding clause in integration-system.external-schema-drift-gate and a liveness
ledger correction candidate.

### 7d. Governance hole the ratchet cannot see

`coverage.json`'s kind universe derives from `packages/spec/liveness/*.json` — which has
no `kernel`, `plugin`, `marketplace`, or `incident` kind. The entire
`packages/spec/src/kernel/**` and `packages/spec/src/cloud/**` surface can grow, publish
to `content/docs/references/` (e.g. `references/kernel/plugin-security-advanced.mdx`
ships "Security scanning and verification" as a documented capability, auto-generated and
banner-marked but backed by nothing), and never register as an unmapped kind. Decide:
either those spec families join the liveness-governed set, or the ratchet's blind spot is
recorded as accepted scope. Until then, only a sweep like this one can catch it.

### 7e. Checked and CLEAN (so the next sweep does not re-derive)

- qrcode field type: scanning keys (`barcodeFormat`/`qrErrorCorrection`/`displayValue`/`allowScanning`)
  pruned 2026-06, correctly dead (`field.zod.ts`); rendering covered by
  `records-forms.field-type-matrix`; residue `suggestions.zod.ts` is a live
  author-time typo alias (`barcode`→`qrcode`), not behavior.
- No content sniffing on upload: not a capability — boundary recorded in the new
  attachments item, not a gap.
- `knowledge.mdx` PDF/scan extraction: an explicit protocol non-goal, no promise.
- `packages/verify` conformance `scan`: internal proof-attribution bookkeeping.
- 2FA challenge gate + lockout: covered (`identity-auth.auth-method-matrix` +
  `two-factor-lockout.dogfood.test.ts`); endpoint existence pinned by
  `auth-route-ledger.conformance.test.ts`.

## 8. Scoped sweep 2026-08-26 — ADR-0126 验收卡 #12438 (packaged flow/action disable + clone)

Scoped sweep triggered by acceptance card #12438 (Epic #12150, nine PRs merged at
af56546). Three read-only hunters (routes/runtime · Setup/Studio UI · docs claims)
diffed the shipped ADR-0126 surface against the ledger; **the whole surface was
uncovered** (zero hits for `ADR-0126|sys_metadata_activation|ACTION_DISABLED` across
the checklist before this sweep). 14 items were authored + 1 revision in the same
change (automation ×4; api-backend ×2; access-security ×3; platform-core ×3;
studio-authoring ×2; `automation.flow-toggle-kill-switch` re-sourced rev 2 — its old
source cited the `flowEnabled` map §7.2 retired). Ledger 207 → 221 items. What follows
is what is NOT a checklist item.

### 8a. Product defects found while grounding (decide handling)

Each is captured inside a checklist item as an expected-fail probe or knownGap, so a
run records actual behavior instead of ticking green.

| # | defect | evidence | captured in | sensitivity |
|---|---|---|---|---|
| D16 | **Setup packaged-automation page is unreachable — no nav entry.** The page + registry ref `automation:packaged` shipped in objectui (`app-shell/src/views/setup/PackagedAutomationPage.tsx`, `services/builtinComponents.tsx`), but `packages/platform-objects/src/apps/setup-nav.contributions.ts` names no such item (only `developer:packages`); reachable only by typed URL `/apps/setup/component/automation/packaged`. Epic L5 (#6301) and L6-UI (#6412) are CLOSED, so this is a dropped half, not pending work. Card **A1 is expected to fail**; `build-without-code.mdx` ships the promise publicly (docs ahead of surface — the sequencing ADR §8.5 asked to avoid). | objectstack `setup-nav.contributions.ts` vs objectui `PackagedAutomationPage.navContribution.test.tsx` (pins only the objectui half) | automation.setup-packaged-automation-board (expected-fail nav clause — a typed-URL pass must not tick it) | UX/release — **FILED as #12457** (2026-08-26); testers warned on #12438 |
| D17 | **`PUT`/`DELETE /api/v1/automation/:name` bypass the packaged lock** — `manage_metadata` alone re-registers/unregisters a packaged flow's live definition; `registerFlow` has zero `_lock`/provenance check, while `/meta/flow` refuses the same write. ADR-0126 §2 "refused loudly at the write door" is unimplemented at this door. | `packages/runtime/src/domains/automation.ts`; `packages/services/service-automation/src/engine.ts` | access-security.packaged-flow-write-door-parity (expected-fail parity clauses) | integrity — admin-gated, not an escalation; safe to file |
| D18 | **The flow clone is engine-registry-only** — no `sys_metadata` write on the clone path, `_packageId`/`_provenance` stripped, no post-clone navigation; Studio's Automations rail lists package-scoped metadata, so a package-less engine-only clone matches no package. "The clone is an ordinary flow, yours to edit in Studio" (ADR §1.3/§7.1, `build-without-code.mdx`) is unproven; restart survival unknown. | `domains/automation.ts` (registerFlow only); `flow-clone.ts`; objectui `StudioDesignSurface.tsx`; `PackagedAutomationPage.tsx` | automation.packaged-flow-clone-contract (honest restart+Studio clause, expected-fail) | correctness — safe to file |
| D19 | **The subflow refusal's own remedy is dead** — "Disable the calling flow(s) first" is what the 409 prescribes, but `packagedSubflowCallers` scans the registered flow map with **no activation check**, so an already-DISABLED caller still guards its callee; the prescribed sequence can never complete. No test covers the sequence. | `engine.ts` (no activation consult) vs `` (the prescription); ADR §7.3 | automation.packaged-flow-subflow-disable-refusal (expected-fail remedy-sequence clause) | correctness — safe to file |
| D20 | **Extension-field collision silently OVERRIDES the shipped base field** — `mergeObjectDefinitions` spreads `extension.fields` over `base.fields`, and the authoring schema documents "Fields to add/override" with priority "wins on conflict". No generic collision gate exists (`managed-extension-fields` covers better-auth sys objects only; ADR §3 adopts it as *prior art*, not a live gate). May be by-design — but then integrations.mdx's "never by reshaping what shipped" overstates. | `packages/objectql/src/registry.ts`; `packages/spec/src/data/object.zod.ts,2996-2997` | platform-core.packaged-object-extend-only (knownGap, do-not-file-as-FAIL rule) | integrity/design — needs a ruling |
| D21 | **Non-durable toggle disclosure is a server log line only** — with no activation ledger attached, `toggleFlow` warns "IN PROCESS ONLY … will NOT survive a restart", but the response body (`{name, enabled}`) and every UI surface carry nothing; card 已知边界 3's asymmetry has no user-facing channel and no docs sentence anywhere. | `engine.ts`; `domains/automation.ts` | — (not an item; needs a maintainer call on the channel: response field vs UI copy vs docs) | UX-integrity — maintainer call |
| D22 | **`POST /automation/:name/clone` is unledgered** — live route absent from `route-ledger.ts` and from the JS client; `api-backend.route-ledger-live-parity` runs ledger→live only, so an unledgered mount is invisible to it. Suggest a ledger row now; consider a reverse-parity (live→ledger) item as a standing gate. | `domains/automation.ts` vs `route-ledger.ts` | — (not an item) | low — internal discipline |

Two objectui-side polish rows captured inside `automation.setup-packaged-automation-board`
rather than as defect rows: `actionErrorDetail` drops `details[]`, so field-level
prescriptions on validation refusals never reach the operator (`packages/core/src/actions/actionErrorDetail.ts`
— a narrowing, not a rewrite); and the page renders live switches for a plain member
with the refusal discovered only after the click (`ComponentNavView` has no gate; ledger
reads are deliberately open per `sys-metadata-activation.object.ts` — record the
posture, then decide which shape is wanted).

### 8b. Docs drift (PD#10 class — file as docs fixes, not checklist items)

- **`content/docs/kernel/contracts/metadata-service.mdx`** teaches the superseded
  three-layer overlay protocol as the customization architecture — which ADR-0126 §6.4
  forbids citing — and its worked example overlays an **`object`** (tier B,
  `allowOrgOverride:false`): the exact `NOT_OVERRIDABLE` phantom write the §6.1 wall refuses.
- **`content/docs/protocol/objectui/concept.mdx`** (+ `index.mdx`) promises
  per-tenant field-level object customization ("Make phone required", "Add custom field
  vip_status") — contradicts Regime E and the sentence now shipped at
  `capabilities/integrations.mdx` ("not by editing what shipped").
- **`build-without-code.mdx`** routes no-code admins to a code-only mechanism without
  saying so — extension packages ship in code with the package
  (`data-modeling/object-extensions.mdx,28`); one clause ("via an extension package
  your developer ships") closes it.
- **The shipped Regime-C doors are undocumented**: no docs page for
  `/automation/:name/clone`, `/actions/_activation/:object/:action`, the subflow 409, or
  the §5 operator gate; `ACTION_DISABLED` appears only in the generated ledgers;
  `references/api/automation-api.mdx`'s toggle row predates the durable/gated semantics.
- **ADR-0126's header still reads `Status: Proposed`** while all nine epic PRs are merged
  at af56546 — flip it (the acceptance act evidently happened).

### 8c. Card-accuracy notes for the tester (#12438)

- **A1 will fail** (D16); the typed URL works and the rest of A/B/C is testable through it.
- **已知边界 3 is inaccurate as worded**: with the ledger attached, `toggleFlow` writes a
  row for ANY flow it holds (`packageId: ''` for non-packaged — `actions.ts`
  states the design); the non-persistent case is the ledger-less boot (D21), not
  "non-packaged flows" per se.
- **D1's refusal on a stock (single-posture) boot is the `manage_metadata` tier** — the §5
  posture gate is deliberately inert under `single`; and the two doors speak different
  sentences (flow: `FLOW_ENABLEMENT_DENY_MESSAGE`; action: the shared activation-gate
  wording). **D2 needs a `group`/`isolated` boot** (enterprise `@objectstack/organizations`)
  — no stock fixture; unit-pinned only.
- **B1: clone requires a new machine name AND a new label**, both mandatory server-side.
- **C1's code is `ACTION_DISABLED`; the packaged-flow disable reuses `FLOW_DISABLED`** —
  distinguish the ledger disable from a Studio `status` disable by the message's
  `sys_metadata_activation` phrase, never by code alone.

### 8d. Fixtures worth adding (would un-block clauses recorded as knownGaps)

- two stock objects sharing an action machine name → unblocks the 409 `RESOURCE_CONFLICT`
  ambiguity arm (`api-backend.action-activation-door-contract`).
- a `group`/`isolated` posture boot recipe → unblocks the §5 operator-gate legs
  (`access-security.activation-write-operator-gate`) and card row D2.
- a documented no-automation lean-composition boot for manual runners → the dogfood
  harness (`bootStack(showcaseStack)` minus automation) is currently the only path for
  `platform-core.activation-ledger-registration-home`'s 503-turnaround leg.

### 8e. Checked and CLEAN (so the next sweep does not re-derive)

- **E1's three-tier language landed verbatim** at `capabilities/integrations.mdx` and
  `build-without-code.mdx`; repo-wide, no unconditional "install then customize in
  Studio" claim remains in `content/docs`.
- **The dashboard overlay door exists** (`dashboard allowOrgOverride: true`,
  `packages/spec/src/kernel/metadata-plugin.zod.ts`) — the display-class item asserts
  the tier-1 promise on both view and dashboard.
- **`TenancyPostureSchema` is enumSource-pinnable** (direct inline `z.enum`, 3 members) —
  pinned on the operator-gate item. **`sys_metadata_activation.metadata_type` is NOT
  pinnable** (untyped `Field.text`, string-literal writers `'flow'`/`'action'`) —
  hand-enumerated on the row-contract item and flagged un-pinned.
- **No security-sensitive finding to withhold**: D16–D22 are admin-gated behaviors or
  disclosure-shape issues; nothing here discloses an unfixed privilege escalation.

## 9. Full sweep 2026-08-30 — five-angle re-audit at a286411 (framework) / 1e14d70 (objectui)

Ledger **221 → 260 items** (39 new, 13 revisions); `coverage.json` 31 kinds mapped, **0
waived** (the first sweep to start from a zero-waiver state — nothing to re-audit there,
so the stale-claims audit ran against `blocked` refs and item texts instead, and found
five: §9d/§9e). Five parallel read-only hunters (console UI · spec enums · routes/runtime
· built-in apps · docs claims), nine per-area writers. Cross-angle hits drove priority:
`fieldGroups[].visibleWhen` was found by three angles independently, the marketplace
install-local surface by four. What follows is what is NOT a checklist item.

### 9a. Product defects found while grounding (decide handling)

Each is captured inside a checklist item as an expected-fail probe or knownGap, so a run
records actual behavior instead of ticking green.

| # | defect | evidence | captured in | sensitivity |
|---|---|---|---|---|
| K1 | **KeyboardShortcutsDialog advertises dead accelerators.** Five listed keys have no handler anywhere (⌘/ focus-search, ⌘D dark-mode, N create, R refresh, ⌘E edit — repo-grep; only near-misses are page-scoped `r` in ApprovalsInbox and Ctrl+Shift+D debug); the sidebar row shows bare "B" while the binding requires ⌘/Ctrl+B; ⌘⇧O/⌘⇧S are advertised globally but their handlers are page-scoped to AiChatPage. A help surface teaching no-op keys. | objectui `app-shell/src/chrome/KeyboardShortcutsDialog.tsx` (only `?` handled); `components/src/ui/sidebar.tsx` | platform-core.keyboard-shortcut-surface (expected-fail probes) | UX-integrity — safe to file |
| K2 | **System-hub "AI Approvals" card is not gated on the AI surface, and its inbox is error-blind.** The card renders unconditionally while every sibling AI entry point gates on `useAiSurface`; the page polls `/api/v1/ai/pending-actions` every 5 s forever, and renders a "No actions waiting" empty queue beside the error alert on the open edition's 501 (the remedy message itself does surface — that half is fine). | objectui `SystemHubPage.tsx`; `AiPendingActionsPage.tsx`; `AiPendingActionsInbox.tsx`; `useAiSurface.ts` | ai.console-ai-surface-gating (expected-fail clauses) | UX-integrity — safe to file |
| K3 | **`fieldGroups[].visibleWhen` is inert in the console one day after landing.** #13030 (2026-08-29) shipped the key with "declared = enforced on day one", but BOTH objectui fieldGroups adapters drop it, so the object-level section predicate never reaches the renderer; a separate fail-direction drift exists between the spec (fail-closed) and the view-section renderer (fail-open). | spec commit 53dc739 vs objectui `plugin-form/src/fieldGroups.ts`, `plugin-detail/src/synth/buildDefaultPageSchema.ts`; `object.zod.ts` vs `TabbedForm.tsx` | records-forms.field-group-visible-when (console clause expected-fail at the exact adapter sites) | correctness — safe to file |
| K4 | **objectui external-datasource error UX drifted from the server.** The Setup federation UI's 503-detector matches the retired pre-#3843 string body while the server answers the sendError envelope (its own test pins the stale shape); and ValidationPanel's `DIFF_LABEL` covers 9 of 10 `SchemaDiffEntryKind`s — `'unreachable'` (emitted at `external-datasource-service.ts`) has no label. The #4115 class recurring until the next objectui spec-pin bump. | objectui `metadata-admin/external/api.ts` + `api.test.ts`; framework `external-datasource-routes.ts` | integration-system.external-schema-browser-ui (expected-fail + knownGaps) | correctness — safe to file |
| K5 | **Three raw-`getRawApp` route registrars remain unledgered** (D6/D22 class, and structurally invisible to the #7526 reverse-parity gate): the `/auth/me/permissions` + `/auth/me/localization` + `/me/apps` trio, `/api/v1/approvals/act`, and `/api/v1/webhooks/redeliver`. The trigger-api/metadata precedent (#11863/#11882) gives each such registrar a per-package ledger + conformance guard; these three never got one. (D22's `/automation/:name/clone` re-verified still unledgered at head.) | `plugin-hono-server/src/current-user-endpoints.ts,877,902`; `plugin-approvals/src/approvals-plugin.ts`; `plugin-webhooks/src/webhook-outbox-plugin.ts` | items now cover the routes' semantics (access-security.me-permissions-aggregation-parity, approvals.email-action-token-door, webhook-lifecycle rev 5); the ledger gap itself is this row | low — internal discipline |
| K6 | **Seed mode `replace` is declared≠implemented.** The spec sells it as "Delete ALL records, then insert" but the write arm is a bare insert whose comment says "caller should have cleared the table" — and no clearing caller exists anywhere. An ADR-0049 shape on the most dangerous member of the enum. | `packages/spec/src/data/seed.zod.ts` vs `packages/metadata-protocol/src/seed-loader.ts,2106` | platform-core.seed-mode-matrix (expected-posture clause — a run must not tick "deletion correctly scoped") | correctness — safe to file |

Two design postures recorded inside items rather than as defect rows: scheduled-report
dispatch is wired **fail-closed** at head (`reports-plugin.ts` passes
`resolveOwnerContext: undefined` pending ADR-0073 M2, so every live scheduled dispatch
takes the refusal arm — dashboards.report-schedule-dispatch-delivery asserts exactly
that, with a flip-to-live tripwire); and the theme provider resolves `system` once per
evaluation with no matchMedia listener (platform-core.theme-mode-persistence asserts
resolve-at-load only).

### 9b. Docs drift (PD#10 class — file as docs fixes, not checklist items)

- **`content/docs/references/api/export.mdx,168,185`** advertises `jsonl`/`parquet`
  formats and an async export-job vocabulary with **zero consumers** (see §9c); the live
  door serves exactly csv/json/xlsx and silently coerces any other `?format=` to csv
  (`rest-server.ts`) — a caller asking for the documented `parquet` gets a CSV
  with a 200.
- **`capabilities/approvals.mdx`** counts the dead `queue` style among "eight
  resolution styles" (#3508: resolves to **nobody**, designers must not offer it); same
  section says department expansion "optionally" includes sub-departments — the spec
  always includes all descendants.
- **`capabilities/integrations.mdx`** — "one-click record cloning": the server door is
  real, but **no objectui surface calls `data.clone`** (confirmed independently by the
  docs hunter and the records-forms writer). Say API/SDK, or ship the affordance.
- **`capabilities/views.mdx`** — "a default can be set per team": no per-team
  default-view mechanism exists anywhere in the UI spec.
- **`capabilities/automation.mdx`** — notifications "(in-app, email, chat)": registered
  channels are inbox/email/sms only (`messaging-service-plugin.ts,249,267`); a "chat"
  notify dead-letters honestly, but the doc sells it as a delivery channel.
- **`capabilities/index.mdx,33`** — HotCRM "one-click install from the Marketplace":
  the install door exists, but whether the public catalog lists HotCRM is unverifiable
  in-repo — **maintainer check**, not asserted drift.

### 9c. Declared-but-inert surfaces (ADR-0049 enforce-or-remove candidates — none got items)

- **The whole async export-job surface** — `packages/spec/src/api/export.zod.ts`
  (`ExportFormat` incl. jsonl/parquet, `ExportJobStatus`, job request/response): no
  `.parse` site, no route, no producer; published by the export.mdx page above.
- **`ConcurrencyPolicySchema`** and its neighbor **`ScheduleStateSchema.status`**
  (`automation/execution.zod.ts,411`): exported, referenced by nothing.
- **`driver-nosql.zod.ts` enum family** (consistency/read-write concerns/index/sharding):
  `driver-mongodb` exists but no stock boot or fixture uses it — non-testable open-side.
- **`sys_notification_subscription` Setup grid** — declared-inert by its own docstring
  (#9807: no `'subscribers'` audience member, nothing reads the rows).
- **objectui collaboration presence is unwired** (`PresenceAvatars` mounts but
  `useRecordPresence` resolves `[]` — no `PresenceProvider` host anywhere; `LiveCursors`
  and `CommentThread` have zero consumers); `OnboardingWalkthrough` is a deliberate null
  stub.

### 9d. Resolutions of earlier sections (append-never-rewrite rule)

- **§7c's `datasource.checkOnBoot` design note is RESOLVED** — #13149 (2026-08-29) made
  the flag enforced (`external-validation-plugin.ts` drops opted-out rows before
  any verdict, with a named skip line); integration-system.external-schema-drift-gate
  rev 2 now asserts the positive instead of the finding.
- **§7b's `admin-routes.ts` row is half-resolved**: the "no such consumer exists in
  objectui" clause is now stale — objectui ships a live Setup → Datasources consumer of
  the federation routes (`metadata-admin/external/api.ts`). The comment-accuracy question
  it raised should be re-checked against that consumer before any cleanup edit.
- **§8a D16 is FIXED** (#12457): `setup-nav.contributions.ts` ships
  `nav_packaged_automation`, pinned by `setup-packaged-automation-nav.test.ts`;
  automation.setup-packaged-automation-board rev 2 inverted its expected-fail nav clause
  to a positive assertion.
- **Two checklist items were filing-false-findings stale and are fixed in this PR**:
  api-backend.route-ledger-live-parity (claimed /api/settings and /api/v1/datasources
  are unledgered — both have ledgers + conformance tests now; rewritten to the real
  **11-ledger** universe) and integration-system.datasource-admin-lifecycle (same
  "unledgered" claim, plus its "always-available static catalog" wording predating the
  #9391/#9593 uniform auth floor).

### 9e. Blocked-item re-audit

- **UNBLOCKED: identity-auth.oauth-app-consent-loop** — its "no stock oidcProvider flow"
  claim conflated the platform-as-provider (what it tests, and which mounts by default:
  `resolveOidcProviderEnabled` follows the MCP default TRUE) with an external IdP (what
  `linked-accounts-social` genuinely needs — that one stays blocked). Every citation
  verified before flipping; rev 2.
- **RE-PRICED: approvals.quorum-m-of-n** — the showcase now ships a real quorum flow
  (`showcase_committee_quorum`, 2-of-3), so the remaining unblock is **one seed line**
  (give Ada `finance` or `legal` → a live 2-of-2; a third distinct holder completes
  2-of-3), not the "showcase design call pending" the old ref claimed; rev 3.
- **Still blocked, re-verified at head**: approvals.sla-escalation (clock-control harness
  — `timeoutHours` min 1, `runEscalations()` reads `this.clock`, no HTTP door injects);
  access-security.no-active-org-session-semantics (unchanged; #13180/#13181 are new
  adjacent instances of its fail-closed doctrine, noted on the item);
  records-forms.import-job-undo-cancel (`import-console-undo.spec.ts` still self-skips
  without `IMPORT_CONSOLE_LIVE=1`); identity-auth.linked-accounts-social (external
  social/OIDC IdP genuinely required).

### 9f. Checked and CLEAN (so the next sweep does not re-derive)

- `data.mdx`'s "days until close date" formula claim is deliverable via
  `daysBetween(today(), x)` — the build gate refuses only raw date arithmetic; NOT drift.
- MCP "on by default at /api/v1/mcp" matches `serve.ts`.
- Flow wait `eventType` members deliberately collapse to one suspend-with-correlation
  branch (`wait-node.ts`) — no variants matrix owed; flow boundary events stay
  waived-with-reasons in the node matrix.
- objectui's `FeedFilterMode` imports from spec (`RecordActivityTimeline.tsx`,
  objectui#5969 two-directional pin) — an earlier hand-local-type drift concern is moot.
- The two previously item-unreferenced live objectui e2e specs
  (`console-boot-indicator.spec.ts` #2628, `console-rendering.spec.ts`) are now cited on
  platform-core.boot-health rev 5 — no orphan e2e specs remain.
- `service-knowledge` is composed by no shipped boot path — ai.mdx's "Knowledge answers"
  rides the commercial assistant per that page's own closing note; nothing open-side to
  test.
- cloud-connection's bind family and the marketplace browse proxy are control-plane
  coupled; the offline arms are now covered
  (platform-core.marketplace-install-local-lifecycle / marketplace-console-honesty),
  browse legs blocked(environment/network) honestly.
- Stage machines (`state_machine` rule + meta legal-next-states), dashboards `compareTo`,
  and backup-restore.mdx were each re-checked: covered / no runtime surface promised.

### 9g. Fixtures worth adding (would un-block clauses recorded as knownGaps)

Showcase one-liners: a `unique: true` field; a `fieldGroups[].visibleWhen` specimen; an
authored `deleteBehavior: 'restrict'` spelling; an `approvalStatusField` declaration on
one approval flow; the Ada `finance`/`legal` position line (§9e). Boot recipes: a
zero-user boot (`--no-seed-admin`, fresh DB) for the owner-bootstrap item; a
verification-enabled boot; an `OS_TENANCY_POSTURE=group` boot (also unblocks §8d's
operator-gate legs); a configured-`AuditPlugin` boot (the read-audit doc's own snippet).
Harnesses: an echoing upstream stub for connector auth kinds; a drifted scratch-DB recipe
for autoMigrate; a second verified non-grant user for the owner-email anchor's entitled
leg; scratch active approver flows + `sys_team` seeds for the resolution matrix. The
compiled install-local artifact already exists in-repo (`examples/app-crm` build).

### 9h. Security note

Nothing withheld from this PR. The three new auth-adjacent items
(access-security.platform-owner-email-anchor, approvals.email-action-token-door,
access-security.me-permissions-aggregation-parity) assert **shipped guards** already
public in their issues/ADRs; K1–K6 are UX/correctness/discipline findings; no unfixed
privilege escalation is disclosed anywhere in this sweep.
