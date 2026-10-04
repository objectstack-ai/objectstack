---
'@objectstack/metadata-core': minor
---

The object-schema field mask (ADR-0106 D1) now removes a denied field's references from the rest of the served object document, not only its `fields` entry.

Clause-②: no

A caller who cannot read a field was served a document without that field's definition, but other parts of the document could still name the field. Those parts are now projected too, on every exit that serves an object schema to a restricted caller: the by-name read, the list read and the layered view. What happens to each kind of position:

- **Object-level rule entries** (`validations`, `indexes`, `activityMilestones`). An entry that names or reads a denied field is dropped whole. The platform still evaluates the stored rule on every write.
- **Role pointers** (`nameField`, `displayNameField`, `imageField`, `stageField`, `tenancy.tenantField`, `lifecycle.ttl.field`). A pointer to a denied field is deleted, so the role falls back to its default.
- **Name lists** (`highlightFields`, `searchableFields`, `publicSharing.redactFields`, list-view column lists, `external.columnMap` entries, and a readable field's `relatedListColumns` / `dependsOn`). The denied entries are filtered out. A list-view column in object form is dropped when any of its facets names a denied field: its own `field`, its `prefix.field` or its `summary.field`. A `dependsOn` entry's `param` is the lookup target's key and is not read as a field here. A list left empty is deleted.
- **The inline master-detail grid** (`inlineColumns`, `inlineAmountField`). These are declared on the child object's own `master_detail` field and name the child's own fields. A column that is a denied field, or is computed from one (`expr`), is dropped. A denied `inlineAmountField` is deleted.
- **Expressions** (`titleFormat`, field-group `visibleWhen`, row-CRUD `visibleWhen` / `disabledWhen`, `publicSharing.eligibility`, lifecycle `onlyWhen`, and a readable field's formula `expression`, `visibleWhen` / `readonlyWhen` / `requiredWhen`, `relatedListFilter`, `defaultValue`, `autonumberFormat` and per-option `visibleWhen`). An expression that reads a denied field is deleted. The readable field itself stays.
- **List views and actions.** An entry whose filter, sort, predicate, params or `patch` read a denied field is dropped. So is a list view whose key is a denied field's name.

In these positions an object key counts as a field reference only where keys are field names: a `FilterCondition`, a lifecycle `onlyWhen` map, an action's `patch`. A denied field named like a schema word (`type`, `source`, `name`) no longer removes every rule, view, action or CEL envelope. A dotted path whose root segment is a denied field counts as a reference to it, whether it is a field-keyed key, a name-list entry or a pointer. The mask also terminates on a cyclic document.

Names of another object's fields (`lookupColumns`, `displayField`, `summaryOperations`, …) are left alone, because that object's own projection governs them. A key that is not classified is deleted when it mentions a denied field in any string or key, so a new key over-masks until it is classified. A test holds the classification equal to the live `ObjectSchema`, `FieldSchema`, `InlineGridColumnSchema`, `ListColumnSchema`, `ColumnPrefixSchema` and `ColumnSummaryConfigSchema` key sets. A caller who is denied nothing still gets the same document reference, so nothing changes for unrestricted callers.

The shared contract fixture in `@objectstack/metadata-core/testing` (`FLS_CONTRACT_OBJECT`) now names its fields in each of these positions, including list views (one with object-form columns), actions and the inline grid, and its formula field uses the real `expression` key. The contract's residue check matches a denied name as an identifier token anywhere in the served document, so a name inside an expression fails it. Projection cases also check what must survive (`retained`), so a mask that deletes too much fails as well.
