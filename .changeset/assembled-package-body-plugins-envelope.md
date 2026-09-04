---
"@objectstack/spec": minor
---

feat(spec)!: `plugins` / `devPlugins` are artifact envelope keys — excluded from the assembled package body and refused inside `packages[]` (#15219)

<!-- adr-0087: registered assembled-package-body-plugins-envelope -->

**BREAKING** accept-set narrowing on `AssembledPackageBodySchema` — the body
under `packages[i].manifest` of a release artifact (ADR-0130 D4): a body that
carries `plugins` or `devPlugins` is now **refused** at the manifest's strict
close (`unrecognized_keys`, naming the key), where it used to parse. Shipped as
`minor` under the repo's launch-window convention for breaking changes; the
hand-migration prescription is registered under protocol major 18. Maintainer
ruling 2026-09-04 on #15219 (director decision batch #32, verbatim 「同意」):
option A for both keys.

`plugins` and `devPlugins` were members of the assembled-body key set by the
same derivation every other collection uses (`COMPOSE_KEY_DISPOSITIONS` gives
both `concat`). They are the only members whose values are **runtime assembly
instructions** rather than serialisable metadata: `plugins` holds what a host
hands to `kernel.use()` — live plugin instances, manifests or package names —
and `devPlugins` is the `os dev` load list. Inside an artifact a package body
is inert JSON, so a plugin under `packages[i].manifest` could never be
constructed by a loader; every reader reads the top level. The classification
is corrected rather than special-cased: an artifact carries metadata, a host
assembles plugins.

**What changes** (`packages/spec/src/stack.zod.ts`):

- `plugins` / `devPlugins` are **envelope keys** — top level only, never inside
  `packages[]`. `ASSEMBLED_PACKAGE_BODY_ENVELOPE_KEYS` (`packages`, `plugins`,
  `devPlugins`) is declared once and feeds both the `AssembledPackageBodyKey`
  derivation and `assembledPackageBodyShape()`.
- Both keys stay `concat`: a live stack still concatenates its plugins to the
  top level under `composeStacks`, and `manifest: 'preserve'` no longer folds
  them into any package body.
- The two declarations on the stack schema are unchanged.

**What does NOT change:** `os serve` / `os migrate` / `os dev` keep reading the
top level (now correct by construction); no CLI, core or runtime code moves.

## FROM → TO

```ts
// before — a package body inside an artifact could carry plugins nobody could load
{ packages: [{ manifest: { id: 'com.example.crm', /* … */ plugins: [{ name: 'plugin.x' }] } }] }

// after — plugins live on the artifact envelope only; the body above is refused:
//   packages.0.manifest: unrecognized_keys ['plugins']
{ plugins: [new CrmPlugin()], packages: [{ manifest: { id: 'com.example.crm', /* … */ } }] }
```

**Migration.** Declare `plugins` / `devPlugins` at the stack top level and
delete them from every `packages[i].manifest`. An existing multi-package
artifact that carries `packages[i].manifest.plugins` (if `os build` ever wrote
one — not directly measured) is refused on load after this change and must be
rebuilt from source; a hand-written `packages[]` entry drops the keys. Stacks
that only ever declared the two keys at the top level parse byte-identically.
