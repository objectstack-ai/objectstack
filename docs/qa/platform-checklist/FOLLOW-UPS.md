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
| E1 | **The scaffold's own `dev` script cannot serve the console the quick-start sends newcomers to.** `content/docs/getting-started/quick-start.mdx` ("How you verify") instructs `npx os dev --ui` then open `http://localhost:3000/_console/`. The blank template ships `"dev": "objectstack dev"` — no `--ui` — and `--ui` is documented in the CLI as the flag that "Enable[s] the bundled Console portal at /_console/". A newcomer who runs `npm run dev` (the script the scaffold gives them) therefore lands on a server with no console, with nothing explaining why. Either the template script should carry `--ui` or the docs should tell them to use the flag explicitly — a maintainer call, not an agent's. | `packages/create-objectstack/src/templates/blank/package.json` · `packages/cli/src/commands/dev.ts:69` · `content/docs/getting-started/quick-start.mdx` | `cli.scaffold-console-first-paint` (clause 3, an expected-divergence probe — the run confirms it at runtime rather than ticking) |
| E2 | **Stale defect note in `packages/spec/liveness/doc.json`.** Its `_note` records "DocSchema declares no `tags`, yet the book-side `include: { tag }` rule and the REST corpus both expect one — the tag rule can currently never match". That defect is **fixed**: `DocSchema` now declares `tags` (`packages/spec/src/data/../system/doc.zod.ts:126`, with the history spelled out in the surrounding comment). The ledger note now describes a bug that no longer exists, which is the same failure class this sweep is correcting in `SWEEP.md`. Outside this card's file surface (`docs/qa/platform-checklist/**`), so it is reported, not edited. | `packages/spec/liveness/doc.json` `_note` vs `packages/spec/src/system/doc.zod.ts:111-127` | — (liveness ledger prose, not a checklist item) |

### 5b. Checked and CLEAN (recorded so the next sweep does not re-derive it)

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
