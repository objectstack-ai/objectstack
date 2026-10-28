---
'@objectstack/spec': minor
'@objectstack/platform-objects': minor
'@objectstack/plugin-approvals': minor
'@object-ui/types': minor
'@object-ui/plugin-detail': minor
'@object-ui/app-shell': minor
'@objectstack/skills': minor
---

feat(spec,ui)!: the record page's `slots.tabs` is retired — a slotted page fills six slots, and a page that needs its own tab strip is `kind: 'full'`

Clause-②: no (narrowing)

Metadata-protocol: narrowed (`page.slots.tabs` is a tombstone that refuses every value; `slots.related` / `slots.relatedLists` are refused by name instead of being read as `tabs`)

<!-- adr-0087: registered page-slots-tabs-removed, page-slots-tabs-retired -->

**BREAKING** accept-set narrowing on the record page (`@objectstack/spec`), with the console following it in the same release.

The record page composes its tabs and columns from the object's roles and relationship flags. An authored `tabs` slot replaced that whole strip, so a page that used it lost every synthesized related list and its wide-screen columns. The slot is gone; the six live slots (`header`, `actions`, `alerts`, `highlights`, `details`, `discussion`) are unchanged.

- **FROM → TO.** `slots: { tabs: … }` on a `kind: 'slotted'` page → delete the key. To change which related lists appear or their order, set `relatedList` / `relatedList: 'primary'` on the child's reference field; to replace the Details body, author `slots.details`; a page that needs its own strip is `kind: 'full'` and authors its header, highlights, `page:tabs` strip and `record:discussion` in `regions`, drawn as authored.
- **The one-line fix.** `os migrate meta --from 17` lists the edit for existing sources, and `--write` applies it. A stored `sys_metadata` page is converted when it is read (the `page-slots-tabs-removed` conversion): the slot is dropped, and a page whose only slot it was becomes an empty slotted page, which renders the synthesized default. Whether such a page should become `kind: 'full'` is a judgement the conversion cannot make; the upgrade guide entry `page-slots-tabs-retired` lists it.
- **What the parse says.** `slots.tabs` is refused with its prescription ("`page.slots.tabs` was removed in @objectstack/spec 18.3.0 (ADR-0085) — …") at `defineStack` as `STACK_SCHEMA_INVALID` / 422, and at the metadata save door. `slots.related` and `slots.relatedLists` are refused by name with the same remedy. TypeScript rejects `tabs` in a `definePage` slot map.
- **The pair check.** `checkPageSlotPair` (the `details` + `tabs` refusal) is removed from `@objectstack/spec/ui` with the slot it paired; the `page-slots-details-beside-tabs-refused` upgrade entry is folded into `page-slots-tabs-retired`.

The four in-repo pages that authored `slots.tabs` are rebuilt as `kind: 'full'` pages that render the same nodes in the same order: `sys_user_detail` and `sys_organization_detail` (`@objectstack/platform-objects`), `sys_approval_request_detail` (`@objectstack/plugin-approvals`) and the showcase `showcase_project_detail`.

The console (`@object-ui/*`): `buildDefaultPageSchema` composes from the six slots only, and `RecordDetailView` lays every slotted page out by width (three columns from 1280 px), since none can opt out with an authored strip any more. `@object-ui/types` drops the pair check from its page schemas and types `PageSlotMap.tabs` as `never`. The Studio slot canvas lists six slots.

`@objectstack/skills`: the UI skill says a slotted page has no `tabs` slot and how to shape the strip instead.
