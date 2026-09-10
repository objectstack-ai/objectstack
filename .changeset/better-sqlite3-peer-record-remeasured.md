---
"@objectstack/cli": patch
"create-objectstack": patch
---

fix(cli): re-measure the `better-auth` > `better-sqlite3` peer record, correct what it credits, and pin the declaration it justifies (#16813)

A tree containing `@objectstack/cli` reports an unmet peer on every fresh
resolve — `better-auth` peers `better-sqlite3@^12.0.0`, the CLI declares
`^13.0.3` — and the reading that decides what to do about it lived only inside
the scaffold generator's prose. No range moves here and no resolution moves:
what changes is the recorded reason, which had two measured errors in it, plus
a gate that now holds the declaration to that reason.

**The declaration is correct and stays at `^13`.** Three readings, taken rather
than inherited:

- The peer is `optional`, and it governs exactly one configuration — a raw
  better-sqlite3 `Database` passed to better-auth's `database` option.
  `AuthManager.createDatabaseConfig()` returns an ObjectQL adapter factory, or
  `undefined` for better-auth's in-memory adapter. Never a `Database`.
- better-auth cannot be incompatible with better-sqlite3 13, because it never
  touches it: of the 464 files in the published `better-auth@1.7.2` tarball,
  exactly one names better-sqlite3 — `package.json`, the peer declaration
  itself — and no code file references it (positive control: `kysely` names 9).
  It accepts a `Database` the caller constructs; its own sqlite test path uses
  node's built-in `node:sqlite`.
- Pinning back to `^12` is not a neutral alternative. Measured on a bare
  project depending on `@objectstack/cli@17.3.0`, it clears the report only by
  resolving a **second** native better-sqlite3 (12.11.1 beside 13.0.3) that
  nothing loads. The scaffold's existing `allowedVersions` entry clears the
  same report with the lockfile byte-identical.

**Two corrections to the record.** It credited `@objectstack/driver-sql` for
the 13.x copy; on the chain that actually reports
(`cli` → `runtime` → `plugin-auth` → `better-auth`) the binding copy is the
CLI's own `optionalDependencies` entry, which pnpm names in the warning itself.
And it was measured on better-auth 1.7.1 while the family has been pinned at
1.7.2 since — re-measured, with the empirical reading replaced by a structural
one.

The scaffold's rendered `pnpm-workspace.yaml` comment changes wording in both
producers (`objectstack init` and the `create-objectstack` blank template); the
declarations, the widening entry and the resolution are untouched.
