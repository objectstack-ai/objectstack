---
"@objectstack/cli": patch
---

`os migrate account-issuer`, `os migrate audit-metadata-bodies`, `os migrate meta --stored`, `os secret orphans`, `os secret rewrap` and `os storage orphans` answer a project whose database does not exist yet with empty work and exit 0, instead of exiting 1 on a refused read (#21552)

Clause-②: no

Each of these commands boots read-only by default: the schema sync is held back, and a missing SQLite file is opened as an empty in-memory stand-in. That boot already measures which tables the database lacks, because the held-back sync lists each one as a table to create. Each command then read the very tables it had just found missing, and the database refused the read. On a never-booted database (or a `--database-url` that points at one) every default run exited 1:

- `os migrate account-issuer` refused, naming `sys_account`;
- `os migrate audit-metadata-bodies` counted `failures: 3` for `sys_audit_log`, `sys_activity` and `sys_metadata_audit`;
- `os migrate meta --stored` refused, naming `sys_metadata`;
- `os secret orphans` and `os secret rewrap` answered `"error": "scan_failed"`, naming `sys_secret`;
- `os storage orphans` refused, naming `sys_file`.

Each command now reads only the tables its boot found present. A table that does not exist holds nothing, so:

- `os migrate account-issuer` reports no account and no collision (`ok: true`), exit 0;
- `os migrate audit-metadata-bodies` reports nothing to rewrite, with `failures: 0`, exit 0;
- `os migrate meta --stored` reports no stored metadata to examine (`scanned: 0`, `clean: true`), exit 0;
- `os secret orphans` and `os secret rewrap` report no secret to act on, with every holder family enumerated rather than a gap, exit 0;
- `os storage orphans` reports no stranded file, exit 0.

Each names the tables it did not read: on stdout in human mode, on stderr under `--json`, where stdout stays one document. `os migrate account-issuer` is the one that recognises the refusal instead of asking the boot: its boot composes no auth plugin, so `sys_account` is never listed as a table to create. It recognises only the missing-table refusal for `sys_account`, with the shared `isMissingTableError` predicate.

A table that exists but lacks a column, and any other read that is refused, is still read and still refuses with exit 1. The write modes (`--apply`, `--delete`) are unchanged: they boot with the schema sync, so their tables exist before they read.

There is nothing to migrate.
