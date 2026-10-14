---
'@objectstack/skills': patch
---

fix(skills): the automation skill's two reference files write a CRUD `filter` operand as a CEL value envelope or the `{today}` query placeholder; the single-brace `{…}` filter spelling leaves them

Clause-②: no

`skills/objectstack-automation/references/examples-flows.md` and `references/state-machines-and-approvals.md` no longer teach `'{TODAY()}'`, `'{TODAY() + N}'` or `'{record.id}'` at an `update_record` filter operand — spellings the platform refuses (`expression-invalid`) at `objectstack validate`, `registerFlow` and the executor, so an author who copied the example got a refused node. The examples now write what the platform accepts: the query placeholder `'{today}'` for today's date, a CEL value envelope `{ dialect: 'cel', source: 'isoDate(daysFromNow(N))' }` for a one-day window at a date offset, and `{ dialect: 'cel', source: 'record.id' }` for the triggering record's id. The prose names the CEL value envelope where it named a template token (and no longer says a CEL envelope is compared as a literal at a filter operand), and the time-word cheat sheet names the CEL envelope and the `{{ }}` text hole where it named the retired `{…}` template.
