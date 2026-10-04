---
'@objectstack/metadata-core': patch
---

The object-schema field mask (ADR-0106 D1) now removes a denied field's references from the rest of the served object document, not only its `fields` entry.

Clause-②: no

A caller who cannot read a field was served a document without that field's definition, but other parts of the document could still name the field. Those parts are now projected too, on every exit that serves an object schema to a restricted caller: the by-name read, the list read and the layered view. What happens to each kind of position:

- **Object-level rule entries** (`validations`, `indexes`, `activityMilestones`). An entry that names or reads a denied field is dropped whole. The platform still evaluates the stored rule on every write.
- **Role pointers** (`nameField`, `displayNameField`, `imageField`, `stageField`, `tenancy.tenantField`, `lifecycle.ttl.field`). A pointer to a denied field is deleted, so the role falls back to its default.
- **Name lists** (`highlightFields`, `searchableFields`, `publicSharing.redactFields`, list-view column lists, `external.columnMap` entries, and a readable field's `relatedListColumns` / `dependsOn`). The denied entries are filtered out. A list left empty is deleted.
- **Expressions** (`titleFormat`, field-group `visibleWhen`, row-CRUD `visibleWhen` / `disabledWhen`, `publicSharing.eligibility`, lifecycle `onlyWhen`, and a readable field's formula `expression`, `visibleWhen` / `readonlyWhen` / `requiredWhen`, `relatedListFilter`, `defaultValue`, `autonumberFormat` and per-option `visibleWhen`). An expression that reads a denied field is deleted. The readable field itself stays.
- **List views and actions.** An entry whose filter, sort, predicate or params read a denied field is dropped.

Names of another object's fields (`lookupColumns`, `displayField`, `summaryOperations`, …) are left alone, because that object's own projection governs them. A key that is not classified is deleted when it mentions a denied field, so a new key over-masks until it is classified. A test holds the classification equal to the live `ObjectSchema` and `FieldSchema` key sets. A caller who is denied nothing still gets the same document reference, so nothing changes for unrestricted callers.

The shared contract fixture in `@objectstack/metadata-core/testing` (`FLS_CONTRACT_OBJECT`) now names its fields in each of these positions. The contract's residue check matches a denied name as an identifier token anywhere in the served document, so a name inside an expression fails it. Projection cases also check what must survive (`retained`), so a mask that deletes too much fails as well.
