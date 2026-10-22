---
'@objectstack/spec': minor
'@objectstack/driver-turso': minor
'@objectstack/service-datasource': minor
---

feat(spec,driver-turso)!: turso `config.encryptionKey` is removed — it never encrypted anything, in any mode, and is now refused everywhere it is written instead of accepted on a remote datasource

Clause-②: no (narrowing)

Metadata-protocol: narrowed

<!-- adr-0087: registered turso-config-encryption-key-removed, turso-config-encryption-key-retired -->

`encryptionKey` was declared as an AES-256 key for the database file. Nothing ever applied it. A local or embedded-replica file is read and written through better-sqlite3, which has no encryption codec, so #25020 already refused the key there. A remote database was never handed the key either: its storage encryption is configured on the server. That left a key that parsed on a remote datasource and did nothing. It was also the one credential-shaped key a datasource could still write in plain text (`STILL_WRITABLE_CREDENTIAL_KEYS`). Under ADR-0049 (enforce-or-remove) it is removed.

**BREAKING** accept-set narrowing on a published schema, a published constructor and an exported type. It ships as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`).

- **`@objectstack/spec`**: `TursoConfigSchema.encryptionKey` is a `retiredKey()` tombstone. Authoring it is a `tsc` error and a parse error at `config.encryptionKey`, in every mode and with any value, the empty string included. The error carries the removal prescription. It is the only issue reported on that config, whatever else is wrong. The misspellings `encryption_key` and `encryptionkey` get the same prescription. The #25020 local and replica refusal arms are gone, since the tombstone subsumes them.
- **`@objectstack/driver-turso`**: the published mirror `TursoConfigSchema` refuses the key the same way, as `z.never()`. `TursoDriverConfig.encryptionKey` is typed `never`. `new TursoDriver()` and `createTursoDriver()` refuse a defined `encryptionKey` with `VALIDATION_ERROR` / 400 in every mode, before anything else is checked, in the schema's words.
- **`@objectstack/service-datasource`**: the exported `TursoDriverConfigInput.encryptionKey` is typed `never`. The shared loader still forwards a declared value, so a legacy stored row reaches the constructor's refusal instead of being dropped in silence.

### Migration: FROM → TO

| You wrote | Write instead |
| --- | --- |
| `url: 'libsql://my-db.turso.io', encryptionKey: '…'` (also `https://`, `ws(s)://`) | delete `encryptionKey`. Storage encryption for a remote database is configured on the Turso server |
| `encryptionKey: ''` (or any unset value) | delete `encryptionKey` |
| `url: 'file:./data/app.db', encryptionKey: '…'` (also `:memory:`, or a replica beside `syncUrl`) | delete `encryptionKey` (already refused since #25020). Put the file on an encrypted disk or volume if it must be encrypted at rest |

The fix in one line: delete `encryptionKey` from every turso datasource.

### The ADR-0087 disposition

- **D2 `turso-config-encryption-key-removed`** deletes the key from a turso datasource's `config` when its value is unset (any non-string, or `''`) or when it sits beside a remote url (`libsql://`, `https://`, `http://`, `ws://`, `wss://`, in any case). It emits one notice per key. Nothing is lost: the driver never read the value.
- A non-empty key beside a local url is **not** deleted. Removing it would let a datasource whose operator believed the file was encrypted boot in silence. It keeps the #25020 posture instead: the row fails at driver construction with the prescription, and the author deletes the key by hand.
- The conversion is retired from the load path. A live author is refused at parse and taught. Stored rows (the datasource loaders), built artifacts inside their declared-floor window and `os migrate meta --from 17` replay it.
- `RETIRED_KEYS_BY_MAJOR[18]` gains `data/TursoConfig:encryptionKey`. The D3 entry is `turso-config-encryption-key-retired`.

### Stored rows stay redacted

A tombstone is excluded from the schema-derived credential list, by its `[REMOVED]` prefix. Measured: after the retirement, no existing path would have withheld a stored `encryptionKey` on read. The derived turso list (`authToken`) is non-empty, so the canonical fallback never applies. `STILL_WRITABLE_CREDENTIAL_KEYS` is therefore renamed `RETIRED_CREDENTIAL_KEYS` and keeps `turso: ['encryptionKey']`. A legacy row's value is still withheld and still named in `redactedConfigKeys`, on the admin door and the metadata door alike.

### Blast radius

Measured on this tree: no example, template, CLI scaffold, published skill, host default or environment variable authors the key. A tree-scoped absence pin now holds that. Whether any out-of-repo deployment declares it is not measured, and is not claimed to be zero.
