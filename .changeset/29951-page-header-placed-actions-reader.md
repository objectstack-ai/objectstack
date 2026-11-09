---
'@object-ui/components': patch
'@object-ui/types': patch
'@object-ui/app-shell': patch
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@objectstack/plugin-approvals': patch
---

fix(console): an action another package places on `sys_user` at `record_header` / `record_more` draws again on the user's record page, in the drawer and on the full page (#29951)

Clause-②: no
Metadata-protocol: none

- **The header reads `placedActions: true`.** `page:header`'s `placedActions` (#30018) is now drawn by the console's header renderer (`PageHeaderActions` in `@object-ui/components`): `true` draws every action of the page's object whose `locations` include `record_header` or `record_more`, in declaration order, read from the object's metadata at render time, so an action an installed package adds to the object is drawn without editing the page. Omitted or `false`, an authored `actions` list is still the whole set (#11592). A `true` beside an authored list, which the spec refuses, draws none of the object's actions and is reported once in the console.
- **One placed-header reader.** `placedHeaderActions` (`@object-ui/types`) is the rule both headers read: the synthesized default record page's header in `RecordDetailView` and a `placedActions: true` header. The `page:header` registration publishes the `placedActions` input.
- **The platform record pages opt in.** `sys_user_detail` and `sys_organization_detail` (`@objectstack/platform-objects`) and `sys_approval_request_detail` (`@objectstack/plugin-approvals`) set `placedActions: true` in place of the id lists #27219 froze, which dropped every header action another package places on those objects. The tab strips are unchanged, and every action the lists named is placed at `record_header` / `record_more`, so each still draws.
- `@objectstack/spec`: the `placedActions` describe no longer opens with `[PLANNED — not yet rendered]`, and the `page` liveness record names the reader.
