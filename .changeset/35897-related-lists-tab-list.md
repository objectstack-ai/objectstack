---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@object-ui/plugin-detail': minor
'@object-ui/app-shell': minor
---

feat(spec): an object's `relatedLists` is its record page's tab list — only the listed related lists show, in order, the attachments, approvals and activity-stream tabs are placed by object name, and an entry can carry its list's title and columns

Clause-②: yes (widening)
Metadata-protocol: semantic

A record page's tabs are now declared on the parent object, in one place:

```ts
relatedLists: [
  { list: 'quote_line', label: 'Line items', columns: ['product', 'quantity', 'unit_price', 'amount'] },
  'task',
  'sys_attachment',
  'sys_approval_request',
  'sys_activity',
],
```

- **No `relatedLists` (or an empty one): nothing changes.** Every related list shows, in the derived order, then attachments, approvals and the activity stream.
- **A declared `relatedLists` now decides which tabs show**, not only their order. A related list no entry names shows no tab; before, it still followed the listed ones. Removing an entry removes its tab. Body tables a field group places in the overview (`fieldGroups[].relatedList`) are not hidden by it, and `relatedList: false` on the child's FK still hides a list.
- **The three built-in tabs by object name**: `'sys_attachment'` (attachments; shown only when listed, and still only when the object enables files), `'sys_approval_request'` (approvals; still only on a record with requests, and when unlisted it follows the listed tabs), `'sys_activity'` (the one activity stream; when unlisted it closes the strip). A built-in is written only as its bare name: `{ list: 'sys_attachment', … }` is refused at parse. `'sys_comment'` and `'sys_audit_log'` are parts of the stream, not tabs: `os validate` warns (`related-list-stream-part`) and prescribes `'sys_activity'`. `'sys_attachment'` on an object without files warns (`related-list-attachments-off`).
- **An entry's own title and columns**: `{ list, label?, columns? }` wins over the child FK's `relatedListTitle` / `relatedListColumns`, which keep working unchanged. The columns are child field names, used wherever the list is drawn (its tab, and the body table a field group places); a name that is no field of the child is refused (`related-list-column-unknown`) by `os validate`, `os build` and the metadata write door.

What to check in an app: an object that already declares `relatedLists` and leaves some related lists out now shows only the listed ones, and shows no attachments tab unless `'sys_attachment'` is listed. List every tab the page should keep, or remove `relatedLists` to show them all. ADR-0087 semantic entry `related-lists-declared-is-tab-list`.
