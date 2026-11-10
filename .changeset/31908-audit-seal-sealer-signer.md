---
'@objectstack/spec': minor
'@objectstack/plugin-audit': minor
'@objectstack/platform-objects': patch
---

feat(plugin-audit): seal audit-class objects that declare `lifecycle.seal` into signed, chained checkpoints

Clause-②: yes (widening) (a new optional key; its refusals bind only an object that declares it, and none does)
Metadata-protocol: added (`lifecycle.seal` joins the ADR-0057 lifecycle block)

The third slice of ADR-0154. No object opts in by default: `sys_audit_log`'s own `lifecycle.seal` comes with expiry amendments, in a later release, so nothing is sealed until an object declares the key.

- **`@objectstack/spec`.** `lifecycle.seal = { valueFields: string[] }` opts an `audit`-class object into tamper evidence. Refused at parse time, each with its reason: `seal` on another class, a `valueFields` name that is not a declared field, and beside `seal` a `retention.onlyWhen`, a `ttl` on a field other than `created_at`, or rotation `storage`. `ICryptoProvider.rotateKey`'s `audit_seal` reason now says which handle sits in a signed body (the seed's) and which does not (the signing key's private half), and `AuditCheckpointSinkEntry` lists every member a sink receives.
- **`@objectstack/plugin-audit`.** The sealer starts at `kernel:ready`. Each hour of `created_at` is sealed ten minutes after it ends, under the cluster lock `audit.sealer` (an in-process lock when no cluster service is registered): one checkpoint per organization and one for rows about no organization, each with a Merkle root, the previous checkpoint's digest, the sealed-through watermark and the lock's fencing token, signed with the deployment's Ed25519 key. Late rows of the last seven days are sealed as `late` checkpoints first; rows that existed before sealing started are sealed oldest first, archived rows included. The key is created on first use, its private half sealed under the crypto provider, and its creation recorded as one `audit_signing_key_change` ledger row. Every column type has one canonical spelling or none: an object with a column of no rule (`password`, `secret`, `formula`, `summary`, or a file type) is not sealed. Compose a crypto provider with the new `AuditPluginOptions.cryptoProvider`; without one, a sealed object is reported once at `error` and nothing is sealed.
- **`@objectstack/platform-objects`.** `sys_secret`'s source comments name the audit sealer as its fourth producer.
