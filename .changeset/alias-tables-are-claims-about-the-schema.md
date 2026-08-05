---
"@objectstack/spec": patch
---

fix(spec): unknown-key suggestions no longer point authors at keys the schema rejects (#5013)

An `aliases` table on an authoring schema is a **claim about that schema**, in
two halves: that the key it is filed under is one the shape *rejects* (an alias
is consulted only from the `unrecognized_keys` path, so a key the shape declares
can never reach it), and that the key it prescribes is one the shape *accepts*.
Nothing checked either half, and both were false on `main`.

Writing `filter` on a report produced:

```
Unrecognized key(s) on this report: `filter`. … Did you mean `filter` -> `filters`?
```

and taking that advice produced a **second** rejection — `ReportSchema` declares
neither `filter` nor `filters`, only `runtimeFilter` — this time with no
suggestion at all. That is the exact failure the unknown-key strictness work
exists to remove, shipped by its own fix, and it is worst for AI authors whose
only signal is whether the parse complained.

**What changed** — no authorable key was added or removed, so nothing that
parsed before stops parsing; only the guidance an author gets when a key is
rejected:

- `ReportSchema` — `filter`, `filters`, `where` and `criteria` now all name
  `runtimeFilter`, matching `JoinedReportBlockSchema`'s table verbatim so a
  report and its sub-reports correct the author identically.
- `EmailTemplateDefinitionSchema` — `html`/`content` name `bodyHtml`, `text`
  names `bodyText`, and `from`/`sender` name `fromOverride`. All five previously
  named `body` / `fromAddress`, neither of which the schema declares.
- `SkillSchema` — `trigger` no longer renames onto `triggers` (never a key).
  It now carries a prescription instead, because the correct answer is a split:
  routing intent belongs in `triggerConditions`, natural-language intent in
  `description` / `instructions`. A rename would have landed a phrase in an
  array-of-conditions slot and been rejected on the value instead of the key.
- Six entries filed under keys their own schema already declares — and which
  therefore could never run — are gone: `columns` and `chart` on `ReportSchema`,
  `measures` and `filter` on `DatasetSchema`, `body` on `ActionSchema`.

**What keeps it true** — `strictObject` now records each shape it builds, and
`alias-integrity.test.ts` judges every one of the 235 authoring surfaces in the
package against the runtime `.shape` it makes claims about. Reading the runtime
shape rather than the source is what makes it work: shapes spread
(`...MetadataProtectionFields`), ten alias tables are assembled rather than
written as literals, and two different schemas share the surface string
`'this field group'` — a source-literal reader is wrong or blind on all three.
An alias pointing at a **tombstone** is caught too, which the suggester's own
`knownKeys` filter cannot do, since the alias table is consulted before that
fallback runs.
