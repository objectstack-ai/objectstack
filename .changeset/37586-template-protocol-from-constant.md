---
'create-objectstack': patch
---

fix(create-objectstack): the blank template's `engines.protocol` follows the runtime's protocol constant, not the scaffolder's package major

Clause-②: no
Metadata-protocol: none

- The blank template now declares `engines: { protocol: '^19' }`, the protocol the runtime in the same release implements. It used to carry `'^18'`, the scaffolder's package major, so while the protocol major led the package major (Changesets pre mode) a project scaffolded from the source tree was refused at boot with `ProtocolIncompatibleError`.
- `scripts/sync-template-versions.mjs` stamps `engines.protocol` from `PROTOCOL_MAJOR` (`packages/spec/src/kernel/protocol-version.ts`), the constant `os init` already stamps from. The `@objectstack/*` dependencies still carry the scaffolder's exact version.
- No change for a published scaffold: on every published line the package major and the protocol major are equal, so the published template's range is the same as before.
