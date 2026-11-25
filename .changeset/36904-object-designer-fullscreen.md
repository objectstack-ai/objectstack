---
'@object-ui/app-shell': patch
---

feat(studio): an object opens its designer full-screen, on its own address

Clause-②: no
Metadata-protocol: none

Studio redesign (epic #36890), the object designer's card (#36904); it also delivers #36513's tab order.

- **One object, one page.** Opening an object in Studio opens its designer full-screen beside the left menu, with its own address you can bookmark or share. × goes back to the object list with its filter and sort as you left them, ‹ › open the previous and next object in that list, and Esc closes. The designer no longer has its own column of objects or its own 「新建」 button: you pick another object from the list, and you create one with the object list's 「新建」, which keeps the organization-wide default sharing choice, the option to add the object to the app's menu, and, on a read-only package, the save into its customization package.
- **Tabs in a fixed order.** Records, Field layout, Validations, Actions, Settings, Hooks, API; when the page is narrow, Hooks and API fold into "Advanced" first, then Validations, Actions and Settings. References, History (with the audit log) and Source (with the layer comparison) are now tabs after them, in place of the five header icons. The tab you are on is part of the page's address, so refreshing, sharing the link or moving to the next object keeps it.
- **Old links still work.** A bookmark or link to an object in Studio's old Data screen opens that object's designer; a link to the Data screen itself opens the package's object list, and the review link for unpublished changes still opens that review. The app's 「对象设置」, the record page's 「配置页面」, the command palette, links in AI replies and the link to a switched-off action all open the new page.
- **Fixed on the way:** when discarding the AI's unpublished changes partly fails, the message saying which items could not be discarded now stays on the page instead of disappearing at once. A link to an object that does not exist (a deleted object's bookmark, a mistyped link) now says the object was not found, instead of offering it as a new object to design.
