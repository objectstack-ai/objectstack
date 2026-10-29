---
'@objectstack/spec': patch
---

docs(spec): the Virtual ObjectQL retirement's D3 reason says which request arms admitted a caller-supplied `context`

Clause-②: no
Metadata-protocol: none

Supersedes, in the same release, one sentence of the `feat(spec)!: retire the unserved Virtual ObjectQL request protocol from data/data-engine.zod.ts` note: "every arm admitted a caller-supplied `context` (`isSystem` included)". The corrected wording is: every read and write arm (`find`, `findOne`, `insert`, `update`, `delete`, `count`, `aggregate`) admitted a caller-supplied `context` (`isSystem` included). The `execute` arm carried an untyped options record rather than a `context` key, and the `vectorFind` arm had no `context` at all. The D3 semantic entry `data-engine-rpc-protocol-retired` carries the same correction, so `os migrate meta` and the upgrade guide read it. The `strictReadonlyWrites` docblock on `WriteObservabilityOptions` no longer names the retired "Virtual Data Engine" boundary: the option cannot be serialized and is not reachable from a REST/wire body. No schema, export or runtime behaviour changes.
