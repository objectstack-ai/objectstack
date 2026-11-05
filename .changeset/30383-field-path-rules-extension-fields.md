---
'@objectstack/lint': patch
---

fix(lint): the field-path rules judge an object as the registry serves it, so a view, report, dataset, page, widget, mapping, related list or row policy naming a field that an `objectExtensions` entry adds is no longer refused (#30383)

Clause-②: yes (widening: field-path rules accept fields a sibling package adds through `objectExtensions`, which the runtime already serves; any rule that deliberately stays on declared fields says why in its header)
Metadata-protocol: none (lint judgements, no authorable key)

- **Before.** Twelve rules resolved a field path against the objects' declared `fields` only: dataset fields and filters, report runtime filters, dashboard widget filters, list view columns and keys, an object's own field lists, page bindings, filter preset comparands, RLS predicates, sharing-rule criteria, thank-you panels, measure aggregates and the field-consumer credit for dataset paths. On a multi-package artifact, where a module package adds fields to an app package's object through `objectExtensions`, a path naming one of those fields read as unknown (for example `dataset-field-unknown`, `list-view-field-unknown`, `rls-predicate-unknown-field`) although the runtime serves the field. Two rules folded extensions through readers of their own: `related-list-ref-unknown` read only the stack's top-level `objectExtensions`, so an inbound lookup a sibling package adds was not seen, and `mapping-target-field-unknown` kept every entry, where the registry keeps one per package per object.
- **Now.** Every one of them reads the one shared fold in `object-graph.ts`: the object's declared fields plus every field an `objectExtensions` entry of any body of the artifact adds, one entry per package per object, a later entry replacing an earlier one. A field no body declares or adds keeps the same refusal, with the same rule id, severity and message. The rules that judge a field's type (measure aggregates, preset comparands, sharing-rule criteria, thank-you panels) judge an extension-added field on its served definition, as they judge a declared one.
