---
'@objectstack/spec': minor
'@objectstack/runtime': minor
---

feat(runtime): `GET /packages/:id/customizations` names the package behind each field and flow another package contributes to the base

Clause-②: yes (widening)
Metadata-protocol: added

Studio draws the items another installed package brings to a base greyed, naming their source (ADR-0029 D7 as amended by ADR-0146 D3). Until now no served read said which package contributed what. The per-base customization read now answers a fourth list, `contributions`, with its count:

- **What is listed.** Every field another package's object extension (`objectExtensions`) adds to an object the base owns, and every flow such a package ships whose trigger object (the `start` node's `config.objectName`) the base owns. One entry per item: `{ kind: 'field' | 'flow', object, name, packageId }`.
- **What is not.** The base's own items, and its `<base>.custom` pair's (the pair's members stay in `extensions`). A flow authored in this environment is the environment's, not a package's. A flow of a disabled package is not served, so it is not listed.
- **The stamp is on the item.** Two packages adding a field of the same name are two entries, each naming its package; a client joins nothing by name.
- `GetPackageCustomizationsResponseSchema` declares the member and `counts.contributions`, strict as the rest of the answer. A client parsing the answer through the schema needs this version of `@objectstack/spec`.

Navigation entries contributed to the base's app are not in this list yet.
