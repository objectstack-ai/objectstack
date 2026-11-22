---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@object-ui/plugin-detail': minor
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
'@objectstack/platform-objects': patch
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
- **A declared `relatedLists` now decides which tabs show**, not only their order. A related list no entry names shows no tab; before, it still followed the listed ones. Removing an entry removes its tab. Body tables a field group places in the overview (`fieldGroups[].relatedList`) stay at their group, and the tab such a `master_detail` table also keeps on an undeclared page shows only when an entry names it, and `relatedList: false` on the child's FK still hides a list.
- **This narrows the #35889 note** ("Its tab stays on the tab row too, with its count"): the tab of a `master_detail` child that a field group places in the overview stays only while the parent declares no `relatedLists`; once it declares one, that tab shows only if an entry names the child.
- **The three built-in tabs by object name**: `'sys_attachment'` (attachments; shown only when listed, and still only when the object enables files), `'sys_approval_request'` (approvals; still only on a record with requests, and when unlisted it follows the listed tabs), `'sys_activity'` (the one activity stream; when unlisted it closes the strip). A built-in is written only as its bare name: `{ list: 'sys_attachment', … }` is refused at parse. `'sys_comment'` and `'sys_audit_log'` are parts of the stream, not tabs: `os validate` warns (`related-list-stream-part`) and prescribes `'sys_activity'`. `'sys_attachment'` on an object without files warns (`related-list-attachments-off`).
- **An entry's own title and columns**: `{ list, label?, columns? }` wins over the child FK's `relatedListTitle` / `relatedListColumns`, which keep working unchanged. The columns are child field names, used wherever the list is drawn (its tab, and the body table a field group places); a dotted column (`account.industry`) walks the child's relationships, as `relatedListColumns` does, and a name that resolves to no field of the child is refused (`related-list-column-unknown`) by `os validate`, `os build` and the metadata write door.

- **The generic object form** (metadata admin) edits `relatedLists` with its own chip input: a bare name and an object entry both show and both survive add and remove (the entry's title and columns beside its name; they are edited in Studio). Its help text states the tab-list meaning in every translated locale.
- **Studio** (object settings, Record page tabs): the editor lists the entries in order, the built-in tabs among them, and offers the built-ins not yet listed (attachments only when the object enables files). A relationship row's edit sets its own title and columns, and clearing both writes the bare name again. The relationships not listed are shown below as having no tab. A move, a removal or an add keeps every entry's object form and every built-in name.

What to check in an app: an object that already declares `relatedLists` and leaves some related lists out now shows only the listed ones, and shows no attachments tab unless `'sys_attachment'` is listed. List every tab the page should keep, or remove `relatedLists` to show them all. A child list another package adds is hidden too until the parent names it, which a build accepts only when that package is in the parent's stack; letting a package place its own list is a later change. ADR-0087 semantic entry `related-lists-declared-is-tab-list`.
