---
"@objectstack/plugin-audit": minor
"@objectstack/spec": minor
---

refactor(plugin-audit)!: retire `restore` from the `sys_audit_log` action enum — the last declared action with no writer anywhere (#8315, #7675, ADR-0049/ADR-0087)

<!-- adr-0087: registered audit-log-action-restore-retired -->

**BREAKING** (shipped as `minor` under the launch-window lockstep convention).

`sys_audit_log.action` declared `restore`. Nothing has ever written it, and the
record-level audit writer **structurally cannot**: `actionFor()` in
`plugin-audit/src/audit-writers.ts` is typed
`'create' | 'update' | 'delete' | null` and its caller early-returns on `null`.
A tree-wide search finds no other producer. There is no undelete capability
behind the value either — soft delete/restore is unbuilt and parked (#1883,
#3146).

This is the third and last value retired from this enum under the maintainer
ruling of 2026-08-12 on #7675 (原则记录:空 widget + 永远查不到东西的过滤器是可见
产品缺陷;审计面宁窄勿谎), after `export` and `permission_change` in #8147.

### What made it a card and not a tidy-up

Two shipped declarations asserted the opposite, so a declaration-reading audit
scored the action as covered:

- the `writes_only` list view offered `restore` as a filter value — a choice an
  operator can pick that returns nothing, on every deployment that has ever run;
- the module docblock of `plugin-audit/src/auth-event-audit.ts` named `restore`
  among the actions the writer emits — the ADR-0049 declared-≠-enforced shape in
  its purest form: a sentence sitting next to a mechanism, contradicted by that
  mechanism's own type signature, with nothing in CI able to tell.

Both are corrected. The invariant the comment was really claiming — *every
declared action has a writer* — is now a pin test with the writer inventory
written as literals, instead of prose.

### Migration: FROM → TO

| Wrote | Write instead |
|:--|:--|
| a filter, saved query or dashboard on `action = 'restore'` | delete it — no restore event has ever been recorded, so it returned nothing on every deployment |
| a `switch` / badge map / filter-dropdown option for `restore` | delete that arm; an exhaustive `switch` over the action type now fails to compile if it stays |

Every such query returned an empty result set before this change and returns the
same empty result set after it. What changed is that the contract stops promising
otherwise.

⚠️ **Existing rows are untouched and must stay untouched.** The enum is not
enforced on this object — `validateRecord` skips `readonly` fields and every
`sys_audit_log` field is `readonly: true` — so stored history parses and reads
back exactly as written. Audit history is append-only; do not migrate or delete
rows to satisfy a schema narrowing.

⚠️ **Not a product stance against undelete.** If the restore capability lands
(#1883 / #3146 restart), this value returns **with its writer** — the emission
point, its tests, and the view that surfaces it — never as a bare enum row again.

### Also in this change

- `writes_only` list view: filter narrowed to `['create', 'update', 'delete']`,
  which is now exactly what `actionFor()` can emit.
- `plugin-audit`'s generated translation bundles regenerated for all four locales
  (via `check-i18n-bundles --write` — not hand-edited).
- ADR-0087 registration as the semantic migration
  `audit-log-action-restore-retired` (D3 step 17), a separate entry from #8147's
  `audit-log-action-enum-retired` per `entries/README.md`. An enum-VALUE
  retirement, so nothing lands in `RETIRED_KEYS_BY_MAJOR` and the four surface
  ratchets are byte-identical by construction — no authorable key and no def
  changed.
