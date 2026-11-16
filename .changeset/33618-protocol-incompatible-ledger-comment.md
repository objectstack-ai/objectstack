---
'@objectstack/spec': patch
---

docs(spec): the error-code ledger's `OS_PROTOCOL_INCOMPATIBLE` comment says when the refusal carries a `migrateCommand` and when it does not

Clause-②: no
Metadata-protocol: none

Comment only; no schema, type, code or export changes. The comment on the `OS_PROTOCOL_INCOMPATIBLE` row in `src/api/error-code-ledger.zod.ts` said the remedy is `objectstack migrate meta --from N` and listed `migrateCommand` among the `error.details` members unconditionally. It now matches the shipped refusal. `requiredRange`, `rangeSource`, `protocolVersion` and `targetMajor` are on every refusal. `migrateCommand` is present only from the migrate-meta support floor (16, ADR-0087 D3) up to the runtime's major, and is bare when the target major cannot be determined. It is absent for a package ahead of the runtime and for one below the floor, and in both cases the message names the remedies that apply.
