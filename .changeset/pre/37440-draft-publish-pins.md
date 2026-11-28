---
'@objectstack/client': patch
'@object-ui/app-shell': patch
---

fix(client, app-shell): every draft-then-publish Save publishes only the draft it wrote

Clause-②: yes (widening: `@objectstack/client` `meta.publishItem` accepts `draftVersion` and `parentVersion` beside `message` and `packageId`)
Metadata-protocol: none

`client.meta.publishItem(type, name, opts)` takes two optional pins. `draftVersion` (sent in the publish body beside `message`) names the pending draft the publish means to promote: pass your own draft save's receipt `version`, and a draft another writer changed after it is refused `409 METADATA_CONFLICT` with nothing published. `parentVersion` names the live row the publish means to replace (sent as `If-Match`; `null` asserts that no live row is stored, sent as `If-None-Match: *`). Omitted, the request is byte-identical to before and the publish is unpinned.

In the console, every Save that writes a draft and publishes it at once now pins that publish to the draft its own write returned: the Studio top bar's Save (objects, object extensions, flows and their on/off switch, hooks, an installed object's actions, permission sets, a new app, a new object or flow), the item page's Save, each row of the package's sharing-defaults table, 「Configure tabs」, an installed object's field arrangement, the design mode's header pins, menu and menu labels. When someone else's draft write lands on the same item between that draft write and the publish, nothing is published and the draft, which now holds their change, is kept pending instead of discarded; the Save says a draft is pending (the next Studio Save asks to reload or overwrite). The take-back of a refused Save's own draft is pinned to the same version, so it never removes a draft someone else changed. Against a server whose draft save returns no version, all of these publish unpinned, as before.
