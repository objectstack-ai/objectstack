---
"@objectstack/spec": patch
---

`GetMetaItemsRequestSchema.organizationId` no longer documents itself as always consulted.

The published `describe()` opened with "Selects the org partition in the ADR-0005 overlay read order" and closed with "Absent = environment-wide read: only env-level overlays apply and no org partition is consulted." Stating only the absent case invites the converse, and an integrator reading it completes it as *present ⇒ consulted* — so a caller who supplies an organization believes it has scoped a read that can in fact be environment-wide. A supplied organization is not consulted on every `getMetaItems` read.

The corrected text qualifies the promise instead of implying its converse: the parameter selects the org partition **when an org partition applies**, and supplying a value "does not by itself guarantee an org partition is consulted; where none applies, and whenever it is absent, the read is environment-wide and only env-level overlays apply."

Prose only. No key is added, removed or renamed, no export moves, no accept set changes and no runtime behaviour changes — the schema's shape and validation are byte-for-byte what they were. What ships is the JSON-Schema `description` for the existing `organizationId` key and the matching row in the generated API reference, which is why this is user-visible enough to owe an entry and narrow enough to be a patch.

The three sibling `organizationId` describes on `GetMetaItemRequestSchema`, `GetMetaItemLayeredRequestSchema` and `GetMetaItemCachedRequestSchema` are deliberately left alone.
