---
'@objectstack/spec': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
---

feat(spec): Studio list columns for 27 metadata types, served in the reader's language on both doors

Clause-②: yes (widening: `/meta/types` serves `list` on 26 more entries, and the runtime dispatcher's listing is now translated)
Metadata-protocol: none

`METADATA_LIST_REGISTRY` now declares the Studio list columns of 27 metadata types: the first batch (`hook`, `flow`, `job`, `api`, `action`, `report`, `dataset`, `email_template`, `assignment_rule`, `sharing_rule`, `queue`, `agent`, `tool`, `skill`, `doc`, `seed`, `mapping`, `picklist`, `translation`) and the eight types the console used to declare itself (`object`, `field`, `view`, `page`, `dashboard`, `permission`, `position`, `book`). Every column names a key the type's schema declares, checked by the reconciliation test. Nothing an author writes changes: the registry is the spec's own constant.

- **Headers in every shipped language.** The 52 headers no form field already labels get their own `metadataForms.<type>.fields.<path>.label` leaf in the 11 platform bundles (`@objectstack/platform-objects`), translated in all ten non-English locales. A column the form labels reads the form's words.
- **Both doors translate the listing.** The runtime dispatcher's `GET /meta` and `GET /meta/types` now answer the types listing in the request's language, as `RestServer`'s `GET /meta` does: type labels, form labels, list headers and schema titles. Both run one function, `translateMetaTypesListing` (`@objectstack/rest`). Before this, a host served through the dispatcher answered all of it in English.
- **The console's own declarations move into the spec.** Studio's lists of objects, fields, views, pages, dashboards, permission sets, positions and books read the served columns. The console keeps only what the schema cannot say: a field row's server-stamped `object`, a position's holder count and granted permission sets, a view's derived display type, a book's audience and a sharing rule's `sharedWith` rendering. The console declared `object`'s columns twice, in two registrations that disagreed (the later one won); both declarations are gone, so one remains, in the spec. A page's former `route` column named no `PageSchema` key and is dropped. What an admin sees in Studio (`@object-ui/app-shell`): the metadata lists of all 27 types show the spec's columns, in the declared order, with headers in the reader's language; a type with no declared list keeps the name, label and description columns.
