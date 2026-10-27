---
'@objectstack/metadata-core': patch
---

fix(metadata-core)!: a package built for a NEWER protocol major than the runtime is told to upgrade the runtime, not to run `migrate meta`

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only packages/metadata-core/src/protocol-handshake.ts#ProtocolIncompatibleDiagnostic) The one narrowing is an output member of a published runtime TypeScript interface: `migrateCommand` on `ProtocolIncompatibleDiagnostic` becomes optional. No Zod schema, no spec declaration and no stored representation carries it, so there is nothing for the metadata migration to rewrite and no tombstone; a TypeScript reader that dereferences the member is told by its compiler. -->

**BREAKING** public-surface narrowing of `@objectstack/metadata-core`: `ProtocolIncompatibleDiagnostic.migrateCommand` changes from `string` to optional, and the `OS_PROTOCOL_INCOMPATIBLE` answer's `error.details` omits `migrateCommand` for a package ahead of the runtime. Shipped as `patch`: it is not a metadata-protocol change.

The `OS_PROTOCOL_INCOMPATIBLE` refusal (422) used to prescribe `objectstack migrate meta --from N` for every refused range, taking N from the range's floor major. For a package declaring `engines.protocol: '^19'` on a protocol-18 runtime that sent the operator to `migrate meta --from 19`, a command that cannot apply: migration only moves metadata forward from an older major.

Now the handshake compares the declared floor major with the runtime's protocol major:

- **Floor major above the runtime's** (the package is ahead): the message names the two remedies that can apply, upgrading the runtime to the package's protocol or installing a build of the package for this runtime's protocol. The diagnostic carries no `migrateCommand`, so `error.details` on `POST /api/v1/packages` and `POST /api/v1/marketplace/install-local` holds `requiredRange`, `rangeSource`, `protocolVersion` and `targetMajor` only.
- **Floor major at or below the runtime's**: unchanged, and `details.migrateCommand` is present as before.

The refusal's code and status do not change. A reader of `migrateCommand` (TypeScript, or JSON over the wire) treats an absent member as "no command applies; read `message`". No in-repo code outside tests reads it.
