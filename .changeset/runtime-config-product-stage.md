---
"@objectstack/cloud-connection": minor
---

fix(runtime-config): `OS_PRODUCT_STAGE` / `branding.stage` actually reaches `/api/v1/runtime/config`, so the documented preview-badge switch stops being a no-op (#9252)

<!-- adr-0087: not-required (no-migration-prescription) One constructor option
and one optional response key are ADDED; nothing authorable is renamed, retired
or tombstoned, and no stored `sys_metadata` shape changes. There is no
conversion to register. -->

Running `examples/app-showcase` with `OS_PRODUCT_STAGE=ga objectstack dev` left
the Console's "Preview" chip on screen. `RuntimeConfigPlugin` never emitted
`branding.stage`, so objectui's `PreviewBadge` — which reads exactly that key —
never saw the value, and the switch objectui's app-shell README presents as the
operational way to hide the badge did nothing at all.

**Nobody implemented it, in either distribution.** The card guessed the knob was
"honored only by the cloud distribution"; measured with a control first, so the
zeros are a reading rather than a broken search:

| probe | result |
|---|---|
| `OS_PRODUCT_STAGE`, framework repo-wide | 0 hits |
| `OS_PRODUCT_STAGE` / `branding.stage` / `PlatformStage`, cloud repo-wide | 0 hits |
| control: `OS_PRODUCT_NAME`, cloud repo | 9 hits |
| control: files mentioning `branding`, cloud repo | 18 files |

So this is the declared-but-unenforced trap in its purest form: a documented
operator knob with no producer anywhere. Emitting the key restores an
already-declared contract rather than widening a surface — no request that is
accepted today becomes rejected, or vice versa.

**Resolved in the plugin, not threaded through the CLI.** Both halves of the
documented interface name this plugin (`OS_PRODUCT_STAGE` **or**
`new RuntimeConfigPlugin({ stage })`), every sibling branding key already
resolves `config.X ?? OS_X` in the same constructor, and — decisively — the
card's own repro constructs its **own** `RuntimeConfigPlugin` in
`examples/app-showcase/objectstack.config.ts`, which wins over the CLI's by
plugin name. A value threaded through `Serve.RUNTIME_CONFIG_OPTIONS` would have
left the reported repro still broken. The cloud distribution inherits the fix
for free: its `RuntimeConfigPlugin` extends this one and spreads its config into
`super()`, so there is one mechanism answering this question, not two.

**The value space is closed** — `'preview' | 'beta' | 'ga'`, mirroring the
`PlatformStage` union the Console branches on (exported as `PlatformStage`). An
unrecognised value is refused and named in a mount-time `warn` listing the
accepted spellings, never forwarded: the SPA discards off-contract values
anyway, so a passthrough would recreate this bug's exact shape — an operator
sets the knob, nothing happens, nothing is said.

**Unset stays absent.** No `stage` key at all, rather than an empty string or a
default invented server-side, so the Console keeps applying its own documented
`'preview'` default and nothing that works today changes. The regression proof
asserts that direction on **key presence** (`hasOwnProperty`), not
`toBeUndefined()` — `{ stage: undefined }` satisfies the latter while being a
present property that survives `structuredClone` and shows up in `Object.keys`.
