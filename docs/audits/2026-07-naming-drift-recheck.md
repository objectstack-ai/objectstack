# Recheck: "naming drift → silent no-ops" (§3)

**Date**: 2026-07-27 · **Supersedes**: the drift list in
[`README.md` §3](./README.md) (dated 2026-06-15). · **Umbrella**: #1878.

The 2026-06 audit listed nine spec-key ≠ consumed-key drifts. Re-verified every
one against current code in **both** repos (framework + objectui, including the
`<!-- os:check -->` TypeScript blocks inside `skills/*/SKILL.md`, which compile
against the spec and are real consumers).

**Result: six of nine are already resolved** — the list, not the code, was
stale. Three real problems remain, two of them a coupled pair that produces
**visibly wrong rendering today**.

> Vocabulary used below:
> - **FORWARD-DRIFT** — spec declares `A`, the consumer reads `B`. Authoring the
>   documented key silently no-ops. The dangerous direction: the author did
>   everything right.
> - **REVERSE-DRIFT** — the consumer reads `B`, the spec has no `B`. The
>   capability works but is undiscoverable (and rejected outright by a strict
>   schema).

## Verdicts

| # | Item (as listed in §3) | Verdict | Evidence |
|---|---|---|---|
| 1 | field `maxLength` / `minLength` | **MOSTLY ALIGNED** — enforcement is fine; two cosmetic readers still snake-only | server: `objectql/src/validation/record-validator.ts:243-247` (rejects on the camelCase keys); client: `fields/src/index.tsx:2013,2022` dual-reads. Residual: `plugin-form/src/ObjectForm.tsx:607-608` and `fields/src/widgets/TextAreaField.tsx:39` read `max_length` only → no HTML `maxlength` cap, no character counter |
| 2 | field `referenceFilters` | **RESOLVED** (item stale) | key removed in #2377/ADR-0049 (tombstone `field.zod.ts:335-337`); successor `lookupFilters` (`:418`) is read by `fields/src/widgets/LookupField.tsx:244` and scopes the picker |
| 3 | field `maxRating` | **RESOLVED** (item stale) | `maxRating` was pruned; the builder emits `max` (`field.zod.ts:747-750`) and `fields/src/widgets/RatingField.tsx:13` reads `max`. Zero `maxRating` occurrences in objectui |
| 4 | **page `type` → `pageType`** | **🔴 FORWARD-DRIFT — live** | spec `type` (`ui/page.zod.ts:310`); renderer reads `schema.pageType` (`components/src/renderers/layout/page.tsx:391`), falling back to `'record'`. The boundary (`app-shell/src/views/PageView.tsx:123`) passes `type` only — **no mapping exists** |
| 5 | **page `label` → `title`** | **🔴 FORWARD-DRIFT — live** | spec `label` is required (`page.zod.ts:303`); the region/SDUI renderer reads `schema.title` with no fallback (`page.tsx:503-507`). Zero `schema.label` reads in `page.tsx` |
| 6 | page `visibility` | **ALIGNED** (item stale) | spec folds `visibility` → `visibleWhen` (`page.zod.ts:116,126`); `react/src/SchemaRenderer.tsx:285` consumes `visibleWhen`, `:294` still honors raw `visibility` |
| 7 | dashboard `title` vs `label` | **ALIGNED** (item stale) | renderer dual-reads `title \|\| label` (`plugin-dashboard/.../DashboardRenderer.tsx:782`, `DashboardGridLayout.tsx:278`). Widget-level keys additionally hard-fail via a `.strict()` schema + naming error map (`dashboard.zod.ts:273,98-123`, #1894) |
| 8 | app `accentColor` / `badgeVariant` / `separator` | **SPLIT** — `accentColor` aligned; the other two are **surface-conditional** | #1894 declared all three to match objectui's `NavigationRenderer`. `accentColor` is consumed on the live path (`app-shell/src/layout/ConsoleLayout.tsx:171`, `PageHeader.tsx:46`, `apps/console/src/hooks/useBranding.ts:25`). `badge`/`badgeVariant`/`separator` **are fully implemented** — but only in `layout/src/NavigationRenderer.tsx` (`:906` separator, `:983-985`/`:1024-1025` badge), which is a *publicly exported, SDUI-registered* component (`navigation-renderer`), **not** the console's own app sidebar. `UnifiedSidebar` — the component that actually renders `app.navigation` in the console — renders no badge and has no separator branch (`separator` is merely recognized as "no href" by `AppContent.tsx:849` and excluded by `nav-target.ts:17`) |
| 9 | action `disabled` → `enabled` | **RESOLVED 2026-07** | fixed across all six rendering surfaces (objectui#2863); showcase specimen `showcase_archive_task` (#3643) |
| — | flow `http` vs `http_request` | **ALIGNED** (item stale) | spec enum carries `http` marked canonical (`automation/flow.zod.ts:32`); the runtime registers `HTTP_TYPE = 'http'` (`service-automation/src/builtin/http-nodes.ts:48`) |
| — | skill `requiredPermissions` vs `permissions` | **NOT A DRIFT** — mis-filed | `requiredPermissions` **never existed** on `SkillSchema`; the spec key is and was `permissions` (`ai/skill.zod.ts:121`). The original audit described prose/label drift in the docs, not a spec-vs-runtime mismatch |
| — | agent `knowledge.{topics → sources}` | **RESOLVED** (item stale) | #1891 made `sources` canonical and folds the `topics` alias via `.transform()` (`ai/agent.zod.ts:35-48`); `agent.test.ts:105-123` asserts `'topics' in parsed === false` |
| — | webhook `object` → `object_name`, `isActive` → `active` | **RESOLVED** | #3489 materializes declared webhooks with an explicit mapping (`plugin-webhooks/src/bootstrap-declared-webhooks.ts:22-23`) |

## The one that matters: the page pair (#4 + #5)

These two are **coupled and must be fixed together**. The header block is gated
on `pageType !== 'record'` (`page.tsx:503`) — and because #4 pins `pageType` to
its `'record'` fallback, the gate is *always false*. Wiring `label → title`
alone would still render no title.

Observable today in the showcase: `capability-map` (`type: 'home'`),
`active-projects` (`type: 'list'`) and `command-center-jsx` (`type: 'home'`) all
render as record pages — wrong `max-width` (`page.tsx:486`), wrong
`data-page-type` attribute (`:494`), and their page titles suppressed.

Why it survived a year: the spec's `type` **defaults to `'record'`**
(`page.zod.ts:310`) and the renderer's fallback is *also* `'record'`, so the
most common page kind looks correct by coincidence.

## Gate coverage — the systemic finding

For every item above, authoring the wrong key is **silently stripped** at
runtime. `FieldSchema` and `PageSchema` are bare `z.object` (no `.strict()`),
verified empirically: parsing a page with `pageType` + `title` returns neither
key, with no error.

What does exist:
- **TypeScript authoring is a real gate** — `defineField`/`defineSkill` etc. take
  `z.input<typeof Schema>`, so excess-property checking rejects a wrong key in an
  object literal (`Field.rating(5, { maxRating: 10 })` → TS2353). Bypassed by
  `as any`, JSON/YAML, and API-posted metadata.
- **Widget-level dashboard keys hard-fail** via `.strict()` + a naming-aware
  error map (#1894) — the pattern worth copying.
- **`check:liveness` does not help here**: it ratchets *declared* spec props into
  the ledger; it says nothing about *authored unknown* keys.

The dashboard-widget approach (strict + a fixable error message that names the
right key) is the only mechanism in the codebase that turns a silent no-op into
a teaching error. Extending it to `PageSchema` / `FieldSchema` is the structural
fix for this whole class; the per-item wiring below is the tactical one.

## Disposition

**Fixed in this pass:**
1. **page `type` → `pageType`** + **page `label` → `title`** — wired at the
   boundary + a `title || label` fallback (objectui).
2. **field `maxLength`/`minLength`** — the two snake-only readers now dual-read,
   matching the `buildValidationRules` precedent already in the same repo.
3. **`os doctor`** pointed `reference_filters` at the removed `referenceFilters`
   instead of the live `lookupFilters` — corrected (framework).

**Recorded, not fixed (each needs an owner decision):**
4. **app `badge`/`badgeVariant` + nav `separator` — surface-conditional, do NOT
   prune.** The capability is fully built in `NavigationRenderer` (public export
   + SDUI `navigation-renderer`); what is missing is the same three affordances
   in `UnifiedSidebar`, the component that actually renders `app.navigation` in
   the console. So an author's `badge: '3'` works if the nav is rendered through
   the SDUI component and silently vanishes in the console shell — a
   *surface-dependent* no-op, the hardest kind to diagnose. Disposition: port the
   three branches into `UnifiedSidebar` (reference implementations already exist
   at `NavigationRenderer.tsx:906,983-985`), not prune the keys.
5. **`skill.permissions` has no gate** — mis-filed as naming drift; it is an
   aspirational-config item (§4). The ledger marks it `live` on the evidence of a
   *preview renderer* while the identically-unenforced `tool.permissions` is
   `dead` + `authorWarn`. An author writing `skill.permissions` gets silence
   where they should get a warning.
6. **`agent.knowledge` is inert at runtime** — naming is fixed, but RAG resolves
   its sources from the LLM tool call, not from the authored block. Wire or mark
   experimental.
