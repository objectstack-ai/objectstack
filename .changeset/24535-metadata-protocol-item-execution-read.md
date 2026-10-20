---
'@objectstack/metadata-protocol': minor
---

feat(metadata-protocol): `getMetaItemForExecution`, the by-name metadata read without the serving decorations

Clause-②: yes (widening): `ObjectStackProtocolImplementation` gains one public method on its published declaration. Measured on the built `dist/index.d.ts` before and after: the export list is unchanged (131 names), and the class gains `getMetaItemForExecution` and a private member. Every other member signature is byte-identical, `getMetaItem` included.

- **What.** `getMetaItemForExecution(request)` takes `getMetaItem`'s request and answers its envelope. It shares the same sources, the same overlay cache entry, merge, lock and governance, the same disabled-package refusal (`404 OBJECT_PACKAGE_DISABLED`) and withholding, and the same `NO_DRAFT` refusal. The item comes back without the serving decorations: no `_diagnostics` (the full schema `safeParse` of `computeMetadataDiagnostics`, and a view's cross-document reference diagnostics), no per-type credential redaction, and no `registration`. It is the by-name twin of `getMetaItemsForExecution`.
- **Why.** It is for an in-process caller that acts on a definition and serves none of it. The REST API-exposure gate reads the object behind every `GET /api/v1/data/OBJECT` to judge `enable`. On the served face, that read paid a full diagnostic of the object's definition per request: 11.8% of a measured hosted CRM read's CPU, and more on larger objects.
- **Never served.** Do not serve what it returns from a door that answers a caller (HTTP, MCP, an export, a log line). Every such exit serves `getMetaItem`, whose redaction is why the two faces are separate.
- **Unchanged.** `getMetaItem`, `getMetaItemCached` and the authoring read answer byte-identical JSON. This was measured over 480 served answers, comparing the previous build and this one: types, drafts, the overlay cache, refusals and withholding.
