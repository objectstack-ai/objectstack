---
'@objectstack/spec': patch
---

fix(spec): a served object keeps a field label and option labels that diverged from the packaged field, instead of overwriting them with the catalog

Clause-②: no
Metadata-protocol: none

`translateObject` (and so `translateMetadataDocument('object', …)`, which the REST `/meta` reads call) wrote the catalog's field `label` and option labels over every served field. A published object extension's `fieldPatches` label (ADR-0146 D10) was therefore served only by `GET /meta/object/:name/layers`; the read naming no package, the read naming the base and the list read all served the shipped label.

The two slots now follow the rule the field's `description`, `inlineHelpText` and `inlineTitle` and the object's own `label`, `pluralLabel` and `description` already follow (ADR-0029 D9.2a): the catalog applies only while the served value still equals the same field's, or the same option's, in the packaged base. With no packaged base the catalog applies as before. A picklist-bound field's options are the list's and keep the list's translations. A field the packaged base does not declare keeps its own label, as its other slots already did.

Side effect: a tenant overlay's rename of a field label, or of an option label, is now served over the catalog as well, the same way an object rename has been.
