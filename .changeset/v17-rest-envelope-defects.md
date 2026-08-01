---
"@objectstack/spec": minor
"@objectstack/runtime": minor
"@objectstack/metadata-protocol": minor
"@objectstack/driver-sql": minor
"@objectstack/driver-memory": minor
---

fix(data,runtime,drivers): four ADR-0112 envelope defects found in the v17 verification sweep (#4431, #4435, #4436, #4483)

Four independent surfaces where the answer a caller received contradicted the
contract the surface declares. All four were found driving a real showcase boot
against `17.0.0-rc.1` and are catalogued in the #4482 rollup.

- **#4431 — a sandbox capability denial answered 400.** A denial is the sandbox
  refusing to run untrusted code that asked for a capability it does not hold,
  which is the crash contract's case (#3951), not a deliberate rejection of a
  malformed request. It now answers 500, and the `SandboxError:` debug prefix
  no longer reaches the client.

- **#4435 — PATCH/DELETE of a nonexistent record answered 200 success.** The
  write path returned `record: null` / `success: true` for an id that resolves
  to nothing, while GET on the same id correctly 404s; `deleteMany` reported
  every typo'd id as deleted. Both now answer `RECORD_NOT_FOUND`, so a caller
  can no longer read a successful envelope as proof the write landed.

- **#4436 — the unsupported-filter-operator refusal shipped without
  `error.code`.** A refusal with no code is unmatchable by a client, and the
  message leaked the internal `[sql-driver]` prefix. It now speaks
  `INVALID_FILTER` without the driver prefix.

- **#4483 — the `$search` auto field set admitted its lead field
  unconditionally.** `nameField`/`name`/`title` were prepended without passing
  `SEARCH_AUTO_EXCLUDED_FIELDS`, so a search could be aimed at the primary key.
  The lead field now only ORDERS the set it is already a member of; it can no
  longer admit one.

These change responses that were observably wrong, so callers coded against the
buggy shapes — a 200 on a missing record, a 400 on a capability denial — will
see different status codes. Graded `minor` on that basis rather than `patch`.
