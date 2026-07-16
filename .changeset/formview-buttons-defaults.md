---
'@objectstack/spec': minor
---

feat(spec): structured `buttons` + `defaults` config on `FormViewSchema` (#2998)

`FormViewSchema` gains two optional top-level keys — the spec home for the flat
renderer-invented form config ObjectUI's `ObjectForm` reads today
(`showSubmit`/`submitText`/`showCancel`/`cancelText`/`showReset`/`initialValues`,
objectui#2545), which the strip-mode container silently discards:

- **`buttons`** — structured action-button config: per-button `{ show, label }`
  for `submit` / `cancel` / `reset` (new exported leaf `FormButtonConfigSchema`,
  `.strict()` per ADR-0089 D3a so typo'd keys error loudly).
- **`defaults`** — initial field values for create-mode forms, keyed by field
  machine name (absorbs ObjectUI's `initialValues`).

Both are marked `[EXPERIMENTAL — NOT ENFORCED]` per ADR-0078's escape hatch
until the ObjectUI renderer reads them (tracked in objectui#2545); authoring
them today is declared, not yet honored. Purely additive — no existing key
changes shape, no tombstone needed.
