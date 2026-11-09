---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-data` record-currency backfill hint names `--org` and `--all-organizations`

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/rules/field-types.md` pointed an agent that switched a stored currency field to `'record'` at `os migrate record-currency-codes` with no flag. Since #30737 that command fills one organization's rows with `--org ID`, writes the one code into every organization only with `--all-organizations`, and refuses a run with neither on a database whose rows belong to more than one organization. The hint now says so. To stay inside the file's token ceiling, a sentence in the autonumber delimiter rule that restated the rule's own heading is removed.
