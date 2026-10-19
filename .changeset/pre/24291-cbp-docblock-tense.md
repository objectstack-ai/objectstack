---
'@objectstack/spec': patch
---

Clause-②: no

The `forceCbpMasterDetailRequired` docblock in `src/data/object.zod.ts` no longer says that today only
the security gate (`assertControlledByParentWrite`) closes the null-master-FK shape of a
`controlled_by_parent` object. That was true before the builder's force landed, and the sentence is now
in the past tense. It also names what has refused the declaration at parse since protocol 18:
`refuseControlledByParentWithoutOneMaster` refuses a `controlled_by_parent` object none of whose
`master_detail` fields declares `required: true`. No key, schema, export, accepted value or message text
changes.
