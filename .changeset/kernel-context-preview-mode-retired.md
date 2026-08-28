---
"@objectstack/spec": minor
---

feat(spec): retire preview mode — the `'preview'` RuntimeMode value and the whole `KernelContext.previewMode` / `PreviewModeConfig` block (#11846, ADR-0049)

<!-- adr-0087: registered kernel-context-preview-mode-retired -->

**BREAKING** accept-set narrowing and export removal, landing after the
v17.0.0 cut (the lockstep launch-window convention ships it as `minor`; the
prescription is registered under protocol major 18 —
`RETIRED_KEYS_BY_MAJOR[18]` for both walked-shape keys,
`RETIRED_DEFS_BY_MAJOR[18]` for the def, plus the D3 semantic entry
`kernel-context-preview-mode-retired` — where `os migrate meta` users will
look).

The declaration was the sharpest declared-≠-enforced shape on a SECURITY
surface: the schema promised "bypass auth, simulate admin identity" and named
a production guard "the runtime must enforce", and NO code path implemented
either half. Measured zero consumers in objectstack, objectui and cloud
(cloud#1651, closed 2026-08-26 with positive controls: `RuntimeMode` has zero
hits repo-wide there, and `ArtifactKernelFactory` — where preview auto-login
would live if anywhere — has 20+ hits and never touches `previewMode`;
re-verified in objectstack at dispatch, 2026-08-27). An author — very often
an AI — could write the six-key block per the reference docs, parse cleanly,
and get no behaviour and no diagnostic.

FROM → TO:

- `mode: 'preview'` → *(removed value)* — `mode` defaults to `'production'`;
  use `'development'` for local demo work. The rejection carries the
  prescription via the enum's own error map (the `HookBodyCapability`
  precedent); every other mode keeps zod's own message.
- `previewMode: { … }` on `KernelContext` / `TenantRuntimeContext` →
  *(removed key)* — tombstoned with `retiredKey()` (the schemas are not
  `.strict()`, so a bare deletion would be a silent strip): authoring it is
  now a `tsc` error and a parse error carrying the prescription.
- `PreviewModeConfigSchema` / `PreviewModeConfig` / `PreviewModeConfigParsed`
  → *(removed — no replacement)*. The def described behaviour no layer
  implemented; an exported value schema with no consumer reads as a
  capability (#3950).

One-line fix: delete the key and the value — neither ever changed runtime
behaviour, so removing them changes nothing observable. Preview deployment
ROUTING is untouched: `OS_PREVIEW_MODE` / `OS_PREVIEW_BASE_DOMAINS` keep
working exactly as documented (deployment routing, never identity). If a
preview experience becomes a product capability it re-declares fresh, with
the production-posture hard-refusal as the first-landed half (#11846 ruling
record, maintainer 2026-08-27).

The retirement kit:

- tombstones at both declarations (`kernel/KernelContext:previewMode` and the
  `.extend()` copy `kernel/TenantRuntimeContext:previewMode`, both in
  `RETIRED_KEYS_BY_MAJOR[18]`); the enum value's prescription on
  `RuntimeMode`'s error map (enum-VALUE retirements register nothing in
  RETIRED_KEYS_BY_MAJOR and leave the surface ratchets byte-identical)
- whole-def deletion `kernel/PreviewModeConfig` in `RETIRED_DEFS_BY_MAJOR[18]`
  (manifest key deliberately removed; the #4725 gate adjudicated it)
- deliberately NO D2 conversion: a kernel context is constructed by host code
  at boot — not a stack collection member, never a `sys_metadata` row — so
  the conversion chain has no seam that would ever see one (the
  `kernel/Manifest:loading` disposition); the D3 semantic entry carries the
  prescription
- pin tests (`kernel/preview-mode-retirement.test.ts`): both rejection sites
  flip from silent parse to the prescription; zero holders for all 3 retired
  export names on every public entry; the carrier schemas survive
