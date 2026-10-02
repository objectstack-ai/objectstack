---
"@objectstack/plugin-security": minor
---

fix(plugin-security)!: a row-level policy that compares a numeric column with a comparand that is not a number is refused at the RLS compile seam, read and write alike, as the engine's `where` refuses the same comparison

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a compiled policy comparand at the RLS compile seam, the same comparand the engine's where door already refuses: no authorable key, spelling, export or stored shape moves. RowLevelSecurityPolicySchema and every permission set parse and save as before, the predicate's text is untouched, @objectstack/plugin-security exports the same names, and no stored row is read or rewritten. Which number the author meant is not something a ledger entry can decide, so there is nothing for objectstack migrate meta to rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a filter comparand's type and this diff adds none (not registered / already-registered); and the change is runtime behaviour plus one ADDITIVE optional member (number) on the published RlsFieldGuard type, with no published interface or type narrowed or removed (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows which row-level policies the RLS compile seam hands to its two consumers, the read and the write check. It ships as `minor` under the launch-window convention for accept-set narrowings. No export is added or removed. One published type gains a member: `RlsFieldGuard`, the type of the optional `fieldGuard` argument of the root-exported `RLSCompiler.compileFilter`, gains the optional `number` member (each declared column's `type`, and a formula's `returnType`). It is an additive optional member, not a change of what is accepted.

**What was accepted before.** A policy such as `record.amount <= '9999-12-31'` on a `number` column compiled, and its `using` and `check` both reached their consumers unjudged. Measured through `ObjectQL.insert` and `SecurityPlugin` on `SqlDriver` (better-sqlite3), as a member: the write of `amount: 5` was admitted (`@objectstack/formula`'s deleted whole-day copy read the number as an instant), and the read showed the stored row, because SQLite orders an integer before any text. That read was measured on SQLite only; PostgreSQL was not run for this change. The same comparison in a caller's `where` is refused `INVALID_FILTER` / 400 by the engine's number-comparand door.

**What is refused now.** The seam runs the spec's number-comparand verdict (`numberComparandDoorVerdict`, `@objectstack/spec/data`), the one the engine's `where` door consults, on every compiled policy filter, after the shape door and before the comparand-type door. On a column the object declares numeric, a comparand that is not a number (a string the platform's numeric grammar does not read, such as `'9999-12-31'` or `'abc'`, a boolean, a `Date` or a list) drops the policy through the existing fail-closed route: the read is filtered by the deny sentinel and returns no rows, the write is refused `PERMISSION_DENIED` / 403, and a WARN line names the policy, the clause and the comparand. The line's detail is written for the clause it refused: for `check`, which the write check evaluates in-process, it names no driver bind. A granting sibling policy still grants.

**Narrowed, as in `where`.** A numeric string (`'10'`, `'1e3'`) is replaced by the number it names before either consumer runs. So `record.amount == '10'` now matches a stored `10` on the write check, which compared the text with the number and refused it, while the read showed the row.

**The remedy.** Compare a numeric column with a number: `record.amount <= 9999`, not `record.amount <= '9999-12-31'`.

**Unchanged.** A numeric literal, a column that is not numeric, a `{ $field }` reference, and an object whose declaration cannot be read (nothing is judged without one).
