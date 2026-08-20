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
| E1 | **Stale defect note in `packages/spec/liveness/doc.json`.** Its `_note` records "DocSchema declares no `tags`, yet the book-side `include: { tag }` rule and the REST corpus both expect one — the tag rule can currently never match". That defect is **fixed**: `DocSchema` now declares `tags` (`packages/spec/src/system/doc.zod.ts:126`, with the history spelled out in the surrounding comment). The ledger note now describes a bug that no longer exists, which is the same failure class this sweep is correcting in `SWEEP.md`. Outside this card's file surface (`docs/qa/platform-checklist/**`), so it is reported, not edited. | `packages/spec/liveness/doc.json` `_note` vs `packages/spec/src/system/doc.zod.ts:111-127` | — (liveness ledger prose, not a checklist item) |

### 5b. Checked and CLEAN (recorded so the next sweep does not re-derive it)

- **The blank template's `dev` script omits `--ui`, and that is CORRECT — the console is
  served anyway.** This sweep first read `"dev": "objectstack dev"` against the
  quick-start's `npx os dev --ui` and inferred that a newcomer running `npm run dev`
  would land on a server with no console. **Source-checking the chain refuted it**, and
  the refutation is recorded here because the inference is an easy one to make twice:
  - `packages/cli/src/commands/serve.ts:221` — `ui: Flags.boolean({ …, default: true,
    allowNo: true })`. The console is **default-ON** at `serve`; `--no-ui` is the off
    switch.
  - `packages/cli/src/commands/dev.ts:370` — `...(flags.ui ? ['--ui'] : [])`. `dev` only
    ever **adds** `--ui`; it never forwards `--no-ui`. With `dev.ts:69` declaring `ui`
    with no `default`, an unflagged `dev` spawns `serve` with no ui flag at all, so
    serve's own default takes over — on.
  - `content/docs/deployment/cli.mdx:139` says it outright: "`--ui` | Force Console UI on
    (**already on by default in dev**)", and `:196` documents `--ui / --no-ui … (default
    on)`.

  So `--ui` on `dev` is a **no-op forwarder**, there is no divergence between the
  template script and quick-start, and the newcomer is not stranded. What made the wrong
  reading tempting is `dev.ts:69`'s own flag description ("Enable the bundled Console
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
| `PluginSecurityScanner` (`packages/core/src/security/security-scanner.ts:43`) | zero constructors outside `packages/core/examples/`; not in plugin-loader, service-package, rest, or any CLI path | Exported dead code on the PUBLIC barrel (`packages/core/src/index.ts:28` re-exports `./security/index.js`). 3 of 5 scan methods are empty stubs; `scanDependencies` has a real loop whose only data source (`addVulnerability`, `:309`) has zero callers; `updateVulnerabilityDatabase` (`:344`) is a log-only no-op. |
| `KernelSecurityScanResult` / `KernelSecurityVulnerability` / `PluginSecurityManifest.scanResults` (`packages/spec/src/kernel/plugin-security-advanced.zod.ts:385,476,625`) | no `.parse`/`.safeParse` site anywhere; only consumer is the dead scanner (type-only import) | 22 rows published to `packages/spec/authorable-surface/kernel.json:286-310` with zero authors and zero parsers. The whole `plugin-security-advanced` module has no runtime consumer. |
| `PluginQualityMetrics.securityScan` (`packages/spec/src/kernel/plugin-registry.zod.ts:73-83`) | spec self-test only | Nothing reads or writes it at runtime. |
| Marketplace/incident scan vocab (`marketplace.zod.ts:348` 'scanning' status, `marketplace-admin.zod.ts:42,193`, `incident-response.zod.ts:39` 'malware') | declared-only enum members, no producer in this repo | Cloud/EE surface. Same shape as the `'failed'`/`'expired'` upload statuses #7667 had to close: declared, published, no writer. |
| MetadataPlugin FS scan + `metadata-fs` boot scan (`packages/metadata/src/plugin.ts:257,270` — `watch ?? false`; `packages/runtime/src/standalone-stack.ts:698-702` hard-off; `metadata-fs` unwired from any `os dev`/`os serve` lane) | unit-pinned in-package only | No reachable fixture from any shipped boot; if a future lane wires `metadata-fs`, the boot-scan/watcher dot-entry divergence is the risk to test first. |

Compounding the first row: `packages/core/PHASE2_IMPLEMENTATION.md:266-311` advertises
the scanner as a working feature, tells readers to import from `@objectstack/core/security`
(a subpath `packages/core/package.json` does not export), and its sample fields
(`scanResult.passed`/`.score`/`.summary.critical`) do not exist on the actual schema —
the example (`examples/phase2-integration.ts`) sits outside every tsconfig and is never
typechecked. Enforce or remove; if removed, the spec-property-retirement playbook applies
to the authorable-surface rows.

### 7b. Docs drift (PD#10 class — file as docs fixes, not checklist items)

- **Phantom `contentProcessing` virus scanning** — `content/docs/protocol/objectql/types.mdx:1067-1069`
  and `:1086` promise "thumbnail generation, virus scanning … under `contentProcessing`";
  `content/docs/data-modeling/validation-rules.mdx:302` redirects file-storage virus
  scanning to a connector setting. `contentProcessing` exists in exactly those doc lines —
  no schema key, no code, and no content inspection of any kind exists on the upload path
  (mimeType is trusted verbatim from the client body, `storage-routes.ts:241-243`). Both
  docs should say plainly the platform performs no upload-time content inspection; the new
  `attachments-storage.field-accept-maxsize-server-enforced` item records the same boundary
  on the QA side.
- **Dead remediation prescription in a live command** — `doctor.ts:2149` prints "Run
  `objectstack codemod v2-to-v3` to auto-fix"; no `codemod` command exists (the real path
  is `os migrate meta`), and `content/docs/protocol/backward-compatibility.mdx:134` admits
  it. Fix the string; the new `cli.doctor-deprecation-scan` item carries the expected-fail
  probe until then.
- **`metadata-service.mdx:188`** presents `eager` bootstrap as "Scans filesystem … at
  boot (default)"; no shipped boot path scans (`watch` defaults false, `os dev` disables it
  explicitly). Stop advertising the scan as default behavior.
- **`admin-routes.ts:518` comment** claims a Studio "sync objects" consumer for
  `/remote-tables`; no such consumer exists in objectui/app-shell — the live callers are
  the two `os datasource` commands. Cleanup comment fix.

### 7c. Defects found while grounding (auth-integrity rows: maintainer decision before any public issue)

| # | defect | evidence | captured in | sensitivity |
|---|---|---|---|---|
| D9 | `sys_two_factor.verified` declares `defaultValue: true` while better-auth enrols `verified: false` and `AUTH_TWO_FACTOR_SCHEMA` does not map `verified` — if better-auth omits the column on insert, the ObjectQL default marks an unverified enrolment active | `sys-two-factor.object.ts:166-170`; `auth-schema-config.ts:366-374` | identity-auth.two-factor-verify-to-activate (observe-and-flag probe) | **auth-integrity — do not file publicly without maintainer** |
| D10 | `sys_user.generate_backup_codes` has no `resultDialog` — on the only navigable surface the user regenerates codes they are never shown; permanent-lockout path | `sys-user.object.ts:435-452` | identity-auth.two-factor-backup-codes (observe-and-flag) | UX-integrity/auth — maintainer call |
| D11 | `POST /api/v1/auth/two-factor/get-totp-uri` live re-reveal vs the reveal dialog's "shown only once" promise; endpoint absent from SDK ledger rows and targeted by no action | `auth-route-ledger.ts:374` vs `sys-two-factor.object.ts:76` | identity-auth.two-factor-enrollment-reveal (probe) | auth — maintainer call |
| D12 | `os doctor` false-PASS: `findMissingTests`/`findDeprecatedUsages` scan only `<cwd>/packages/spec/src`, so in any user app doctor prints "✓ Test coverage"/"✓ Deprecations" about a tree it never examined | `doctor.ts:1141-1143,1159-1161` → `✓` at `:1939,:1951` | cli.doctor-health-report (expected-fail probe) | correctness — safe to file |
| D13 | `FileConstraintError` declares `code: 'ERR_FILE_CONSTRAINT'` but no `status`, and rest's `classifyDataError` has no branch for it — the server-side accept/maxSize refusal exits `/api/v1/data` as a sanitized **500 INTERNAL_ERROR** with the field-naming prose withheld from the body (the sibling `FileFieldBulkWriteError` docblock names `status: 400` as exactly what prevents this; same class as #7525) | `file-reference-lifecycle.ts:168-173,181-191`; `packages/rest` error-response classification | attachments-storage.field-accept-maxsize-server-enforced (wire-status recorded per run; a measured 500 is extracted as a finding, not scored as an enforcement fail) | correctness/wire-contract — safe to file |
| D14 | `MigrationRecoveryPlugin` is composed by NO boot path — `serve.ts` auto-registers `PlatformObjectsPlugin` but never the recovery plugin; standalone-stack, default-host, the showcase config, and the migrate CLI boot all omit it; only its unit test instantiates it. Interrupted-migration detection therefore never runs on any shipped boot, while `sys-migration-journal.object.ts:56-58` argues recovery must need "zero host wiring" | `packages/runtime/src/index.ts:58` (exported); `serve.ts:2073-2098` (what IS auto-registered) | platform-core.interrupted-migration-boot-report (fixtures an explicit registration; knownGap names the composition hole) | correctness/composition — safe to file |
| D15 | `extract-hook-body.ts:14-18`'s header promises "the build fails… no silent fallback" on a forbidden pattern, but the DEFAULT `os build` catches every extraction error and silently falls back to the .mjs bundle (`lower-callables.ts:63-78`), printing the warnings nowhere; only `--strict-body` (`compile.ts:126-149`) produces the worded refusals with exit 1. `hook-bodies.mdx:256` documents the warn-and-bundle default, so code comment and docs disagree with each other | `extract-hook-body.ts:14-18` vs `lower-callables.ts:63-78`, `compile.ts:126-149` | cli.hook-body-extraction-gates (default-path silent-fallback encoded as expected-fail contradiction clause) | correctness — safe to file |

Two design notes captured inside items rather than as defect rows: `sys_user.mfa_required_at`
is stamped lazily and never cleared anywhere in source, so post-disable re-gating branches on
a pre-existing stamp (identity-auth.two-factor-disable-lifecycle, design-note clause); and
`datasource.checkOnBoot` (spec `datasource.zod.ts:313`, default true, liveness-ledgered live)
is read by NO runtime code — the drift scan always runs — a declared≠enforced ADR-0049 shape
encoded as a finding clause in integration-system.external-schema-drift-gate and a liveness
ledger correction candidate.

### 7d. Governance hole the ratchet cannot see

`coverage.json`'s kind universe derives from `packages/spec/liveness/*.json` — which has
no `kernel`, `plugin`, `marketplace`, or `incident` kind. The entire
`packages/spec/src/kernel/**` and `packages/spec/src/cloud/**` surface can grow, publish
to `content/docs/references/` (e.g. `references/kernel/plugin-security-advanced.mdx:17`
ships "Security scanning and verification" as a documented capability, auto-generated and
banner-marked but backed by nothing), and never register as an unmapped kind. Decide:
either those spec families join the liveness-governed set, or the ratchet's blind spot is
recorded as accepted scope. Until then, only a sweep like this one can catch it.

### 7e. Checked and CLEAN (so the next sweep does not re-derive)

- qrcode field type: scanning keys (`barcodeFormat`/`qrErrorCorrection`/`displayValue`/`allowScanning`)
  pruned 2026-06, correctly dead (`field.zod.ts:1113-1119`); rendering covered by
  `records-forms.field-type-matrix`; residue `suggestions.zod.ts:168` is a live
  author-time typo alias (`barcode`→`qrcode`), not behavior.
- No content sniffing on upload: not a capability — boundary recorded in the new
  attachments item, not a gap.
- `knowledge.mdx:38-39` PDF/scan extraction: an explicit protocol non-goal, no promise.
- `packages/verify` conformance `scan`: internal proof-attribution bookkeeping.
- 2FA challenge gate + lockout: covered (`identity-auth.auth-method-matrix` +
  `two-factor-lockout.dogfood.test.ts`); endpoint existence pinned by
  `auth-route-ledger.conformance.test.ts`.
