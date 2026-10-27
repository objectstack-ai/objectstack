---
'@objectstack/metadata-core': patch
---

fix(metadata-core): a package built for a NEWER protocol major than the runtime is told to upgrade the runtime, not to run `migrate meta`

Clause-②: no
Metadata-protocol: none

The `OS_PROTOCOL_INCOMPATIBLE` refusal (422) used to prescribe `objectstack migrate meta --from N` for every refused range, taking N from the range's floor major. For a package declaring `engines.protocol: '^19'` on a protocol-18 runtime that sent the operator to `migrate meta --from 19`, a command that cannot apply: migration only moves metadata forward from an older major.

Now the handshake compares the declared floor major with the runtime's protocol major:

- **Floor major above the runtime's** (the package is ahead): the message names the two remedies that can apply, upgrading the runtime to the package's protocol or installing a build of the package for this runtime's protocol. The diagnostic carries no `migrateCommand`, so `error.details` on `POST /api/v1/packages` and `POST /api/v1/marketplace/install-local` holds `requiredRange`, `rangeSource`, `protocolVersion` and `targetMajor` only.
- **Floor major at or below the runtime's**: unchanged. The message ends `Run: objectstack migrate meta --from N` and `details.migrateCommand` carries that command.

The refusal's code and status do not change. `ProtocolIncompatibleDiagnostic.migrateCommand` is now optional (`string | undefined`): read it only when it is present.
