---
'@object-ui/app-shell': patch
---

feat(studio): the object designer opens full-screen on the object's metadata address

Clause-②: no
Metadata-protocol: none

Studio redesign (epic #36890), the object designer's card (#36904); it also delivers #36513's tab order.

- **One object, one address.** An object opens its designer full-screen at `/studio/<package>/metadata/object/<name>`, under the item header every Studio item page uses: × back to the object list (its filter and sort kept), ‹ › through the list, Esc to close. The designer has no object list of its own and no 「新建」: the object list is the area's, and its 「新建」 creates an object (organization-wide default, the app-menu join, a read-only base's `.custom` pair).
- **Tabs in #36513's order.** Records, Field layout, Validations, Actions, Settings, Hooks, API; on a narrower column Hooks and API fold into "Advanced" first, then the other three. The item tools are tabs after them (References, History with the audit log, Source with the layered comparison), in place of the header's five icons. The open tab is in the address (`?tab=`), so a refresh, a shared link and ‹ › keep it.
- **The old addresses redirect.** `/studio/<package>/data?surface=object:<name>` opens that object's designer (`?action=` kept, `?view=` and `?nav=` dropped); `/studio/<package>/data` with no object, Studio's old home, opens the package's object list, `?changes=review` kept. The app's 「对象设置」, the record page's 「配置页面」, ⌘K, the AI artifact link and the switched-off action link open the new address; a switched-off action is `?action=<name>` on it.
- **Fixed on the way:** an AI-drafts discard that the server partly refused now keeps its message on the page; the object re-read the discard triggers used to clear it at once.
