---
'@objectstack/skills': patch
---

docs(skills): the platform Driver Selection Guide says Memory and MongoDB may refuse a query capability SQL serves

Clause-②: no
Metadata-protocol: none

`objectstack-platform`'s Driver Selection Guide now opens with one sentence: Memory and MongoDB may loudly refuse a query capability the SQL drivers serve. Query capabilities are built for the SQL drivers first, at their fastest shape, and no slower path is built only to keep the other drivers in step. To pay for the sentence, the same section drops the replaced lead "Drivers are the storage layer:", the SQL row's "Knex.js under the hood" aside, and the "no example app does" aside on keeping drivers out of `plugins:`. No schema or runtime change.
