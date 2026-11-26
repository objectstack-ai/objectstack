---
'@object-ui/app-shell': patch
---

feat(studio): Save and Cancel sit in the page's item header, and the AI assistant ends every title row

Clause-②: no
Metadata-protocol: none

The Studio top bar's page controls move to the open page's own title row, as the first step of removing the bar. They work exactly as before; only their place changes.

- **Cancel and Save** end the item header's actions (an object, a flow, a permission set, any item page), after the page's own buttons. A page that saves with no item header ends its own title row with them. They are drawn only while the page holds unsaved edits, as before.
- **The AI assistant** (or, with no assistant served, the right panel's show / hide button) ends every page's title row, the list page's and the item header's, behind a hairline, as the app's page header ends with its button group. `⌘.` still switches the right panel.
- Only the page's own title row draws them, so a page never shows two Saves. Outside Studio (Setup's metadata pages) nothing changes.
