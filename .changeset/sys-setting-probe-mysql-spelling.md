---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the sys_setting degradation report hands MySQL operators a duplicate-probe statement MySQL can actually run (#9434)

When `sys_setting`'s NULL-safe row-identity index cannot be built, the migration
degrades and prints a query so the operator can list the duplicate rows
themselves. The `unsupported` arm is reached specifically on MySQL/MariaDB — no
functional key parts, no `CREATE INDEX IF NOT EXISTS` — so that arm's audience is
exactly one dialect, and the statement it printed used bare identifiers. `key` is
a RESERVED word on MySQL, so the one remedy offered to a MySQL operator came back
as `ERROR 1064 (42000)`, measured on a live MySQL 8.0.46. Nothing in the platform
executes the statement, so no boot path was affected — what failed was the
operator's copy-paste, in the arm that has no other remedy to offer.

That arm now prints the MySQL spelling: every identifier quoted with backticks,
the convention `seed-tenancy-backfill.ts` adopted for the same reason in #9381.
Both spellings are generated from one body over one key-part array, so the
operator's list and the index's own key cannot drift apart, and the ANSI
statement `buildSysSettingDuplicateProbeSql()` returns is unchanged byte for byte
— the `conflict` arm still prints it, because a conflict means real rows blocked
a build the server was willing to attempt, which only SQLite and PostgreSQL ever
are.

Identifiers are quoted uniformly rather than only where a word looks reserved:
MySQL's reserved-word list grows across point releases, and #9381's `last_value`
is the recorded case of quoting the table while leaving a reserved column bare.

The `CREATE UNIQUE INDEX` statement is deliberately untouched and still bare.
MySQL refuses it for reasons quoting does not reach — unparenthesized `COALESCE`
key parts — and that verdict is now checked on a live server rather than
asserted, in both its quoted and unquoted spellings.
