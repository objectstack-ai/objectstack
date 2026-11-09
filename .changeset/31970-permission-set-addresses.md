---
'@objectstack/spec': minor
---

feat(spec): `ExecutionContext.permissionSetAddresses` carries each granted permission set as its `(packageId, name)` address

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — no skill teaches the execution context's permission fields; `skills/` names `execution-context.zod.ts` only in three generated `references/_index.md` export lists

- **`@objectstack/spec`: `PermissionSetAddressSchema`** (with the `PermissionSetAddress` input and `PermissionSetAddressParsed` output types) is the address of one granted permission set, as ADR-0150 D3 identifies behavioural metadata: `{ packageId: string | null, name: string }`. `packageId` is `null` for a set no package holds (one the environment authored, or one the platform registers) and is always present; `name` must be non-empty.
- **`@objectstack/spec`: `ExecutionContextSchema.permissionSetAddresses`**, an optional array of those addresses declared beside `permissions`. It has no default: a context without it parses without it, and every consumer behaves as before. It is filled only from a resolved `(package, name)`, never from a guessed holder, and a name the resolution rule refuses never appears in it. `permissions` is unchanged: it stays the display and compatibility field, with the same order and contents. No reader consumes the new field yet; the server's permission-set resolution fills it in a later change.
