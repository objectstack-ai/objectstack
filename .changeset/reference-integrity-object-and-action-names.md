---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/cli': minor
---

Reference-integrity validation for object and action names (issue #3583)

A HotCRM audit found ~20 shipped instances of one bug class — metadata naming
something that does not exist — all passing `objectstack validate` / `lint`
cleanly and failing silently at runtime. This closes the object-name and
action-name half of that class.

**New — `@objectstack/spec`:** `PLATFORM_PROVIDED_OBJECT_NAMES`, a curated
registry of every object name contributed by a platform package, official
plugin, or the cloud runtime, plus `isPlatformProvidedObjectName()` and
`hasPlatformObjectPrefix()`. This replaces the `startsWith('sys_')` prefix guess
that could not tell `sys_user` (real) from `sys_approval_process` (fictional —
removed by ADR-0019, registered by nothing), which is why every fictional
platform-prefixed reference shipped. A conformance test scans each package's
`*.object.ts` declarations and fails if the registry drifts.

**New lint rules** (wired into both `os validate` and `os lint`):

- `validate-object-references` — action-param `reference` / `objectOverride`,
  dashboard `globalFilters[].optionsFrom.object`, and navigation
  `requiresObject` gates. Severity follows resolvability: an unresolved
  *unprefixed* name is a typo (**error** — `object: 'user'` where the platform
  object is `sys_user`); an unresolved *platform-prefixed* name is **advisory**,
  since a third-party package may still provide it.
- `validate-action-name-refs` — the surfaces that bind an action BY NAME:
  list-view `bulkActions` / `rowActions`, page `record:quick_actions`
  `actionNames`, and nav action items. A name matching no defined action is an
  **error** (the button renders and does nothing), matching the existing
  dashboard-action-target rule.

**Fixes:**

- `defineStack` cross-reference validation now walks `app.areas[].navigation` —
  an areas-based app previously got no navigation checking at all — and recurses
  into `children` on `object` nav items, not only `group` ones.
- `os lint` i18n coverage now reads field `options` in the canonical
  `{value,label}[]` array shape; it only handled the record map, so option-label
  coverage silently never fired for canonically-shaped select fields.
- Hook `condition` expressions are now field-checked when `object` is an ARRAY
  of targets (previously only a single string target was checked, so a
  multi-target hook filtering on a nonexistent field passed clean). Per-target
  diagnostics are de-duplicated.
- A dashboard widget binding no `dataset` at all is now reported instead of
  silently bypassing every binding and chart check on the raw-config
  (`lint`/`doctor`) paths. `dataset` is schema-required, so this matches what
  the parsed paths already enforce.
