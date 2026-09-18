---
'@objectstack/cloud-connection': patch
---

docs(cloud-connection): cite the cloud control-plane decisions as `cloud ADR-NNNN` instead of bare numbers that resolve to this repo's own records (#18762)

AGENTS.md Prime Directive 13 is explicit — an ADR "lives in the repository whose
code it governs", and a cloud decision is cited as `cloud ADR-NNNN`, "never as a
bare number, which `scripts/check-adr-anchors.mjs` resolves against *this*
registry (the two number independently)". The rule landed; the stock this
package already carried was never swept.

Read against this repository's registry, the bare numbers pointed at real but
unrelated records:

- `ADR-0008` → `docs/adr/0008-metadata-repository-and-change-log.md`, *Metadata
  Repository, Change Log & Subscription (M0 → M4)* — zero occurrences of
  "control plane", "cloud-connection" or "Phase 1"/"Phase 2".
- `ADR-0007` → `docs/adr/0007-settings-manifest-and-kv-store.md`, *Settings —
  Manifest + K/V Store + Resolver*. The cloud ADR-0007 these lines mean is the
  one this repo's own ADR-0003 status line already names: the decision that
  redefined `sys_package_installation` as management-plane desired state and put
  runtime truth in the `LocalManifestSource` ledger.
- `ADR-0009` → `docs/adr/0009-execution-pinned-metadata.md`, *Execution-Pinned
  Metadata* — not the marketplace Setup-navigation ownership decision the lines
  describe.

That is worse than citing a number nobody has. A dangling id stops a reader; an
id that resolves lets them believe they read the right page and walk away with
the wrong decision.

18 citations now carry the `cloud` qualifier, in the spelling this package
already used elsewhere for the very same numbers — `cloud ADR-0008` in
`connection-credential-store.ts`, `cloud ADR-0007 step ⑤` in
`local-manifest-source.ts`, `cloud ADR-0009 P2a` in `marketplace-ui.ts`'s own
header. Four files carried both spellings for one number; they no longer do.

What actually reaches a consumer of this package:

- The npm `description` field, which is the sentence shown on the package page.
- `README.md`, including the closing pointer that already said "in the cloud
  repository" while writing the number bare.
- The published `.d.ts`, which carries the module and plugin docblocks.

No behaviour moves. No type, export, route, schema or runtime path is touched —
this is citation spelling and prose only, which is why it ships as a patch rather
than silently. No ADR record is written or edited. `packages/cloud-connection/CHANGELOG.md`
is deliberately untouched: it is published history, and a released entry is
amended in a dedicated docs-only PR, never as a rider on code changes.
