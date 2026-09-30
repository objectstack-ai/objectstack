---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a dotted relation filter path names the nested-relation form as the route

A filter key such as `account.industry` — a dotted path through a relation field — is still refused with `INVALID_FIELD` / 400 at the query parameter door. Its words no longer say a filter reaches only the object's own columns, which stopped being true when the engine began serving the nested-relation form in `where`: they now name that form, `{ "account": { "industry": VALUE } }`, beside the denormalise remedy, in the same words as the engine's own refusal.
