---
'@objectstack/skills': patch
---

docs(skills): an objectstack-data eval checks that a vendor field is relabelled with `fieldPatches`, never redeclared in `fields`

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/evals/objects-fields-relationships.json` gains case 7: an author wants HotCRM's `crm_account.industry` to read "Sector" instead of "Industry". The accept set requires `fieldPatches` on a `defineObjectExtension` authored in `hotcrm.custom` (an option's label keyed by its stored value where the field declares its own options); it refuses `industry` redeclared in `fields`, which takes the field over and cuts it off from HotCRM's upgrades. No skill text changes.
