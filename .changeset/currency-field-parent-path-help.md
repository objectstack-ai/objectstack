---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

docs(spec): the `currencyField` help text names the parent path and the parent-code lock

Clause-②: no
Metadata-protocol: none

The Studio help text for `currencyConfig.currencyField` now says that on a master-detail child it may name the parent's code field as `<master_detail field>.<parent code field>`, that the record then follows its parent's currency, and that a change of the parent's code is refused while such a child exists (ADR-0144 D2 as amended). The metadata-form translation packs carry the same sentence. Help text only; no schema change.
