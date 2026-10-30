---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): the permission-set grid signals cut columns, keeps its Object column in view, labels expanded field rows by their own header, and tells apart two fields that share a label

Clause-②: no
Metadata-protocol: none

The permission-set grid is wider than its pane at 1440 px and on a phone, on the Setup page and on the Studio Access pillar's Objects tab alike:

- **Cut columns are signalled.** While columns are cut on the right (the Bulk column at 1440 px), the pane's right edge fades; the fade goes once the last column is in view.
- **The Object column stays in view.** The Object column, header and rows, is pinned to the pane's left edge and draws its edge once rows slide under it. On a phone the pinned column shows the object's label alone, so the boxes keep the room to scroll.
- **Expanded field rows keep their own header.** An expanded object's field header (Field / Read / Edit / When) pins under the matrix's header row while the field list is in view, so field rows are no longer read against the object columns above them.
- **Two fields with one label are told apart.** When two of an object's fields share a label (an authored `owner` beside the platform's `owner_id`, both "Owner"), each row draws its API name as the distinguishing text instead of a muted aside.
