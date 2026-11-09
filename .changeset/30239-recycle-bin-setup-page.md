---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@objectstack/platform-objects': patch
---

feat(ui): a Setup page to restore deleted records from the recycle bin, or empty it

Clause-②: yes (widening)
Metadata-protocol: none

Setup → Configuration → **Recycle Bin** (ADR-0148) lists the business objects whose recycle bin you manage (`manageRecycleBin`, which `modifyAllRecords` implies). Pick one to see its deleted records, 50 at a time with **Load more**. Each row shows the record's name, how many related records were deleted with it, who deleted it, when, and how long it is kept. **Restore** brings a record back under its original ids. It is the same restore as the Undo on a delete toast, so a refusal says why in the user's language and names objects and fields by their labels. **Empty recycle bin** asks first, says the removal is permanent, and reports how many deleted records it removed. If you manage no object's recycle bin, the page says so and reads no bin.

`@objectstack/platform-objects` contributes the `nav_recycle_bin` entry (`componentRef: 'data:recycle-bin'`) to the Setup app's Configuration group, with its label in every translation bundle. `@object-ui/app-shell` registers the `data:recycle-bin` component, and `CatalogAssignmentPage` gains an optional `select` prop that narrows the catalog. `renderSection` now also receives the picked entry. `@object-ui/i18n` adds the `recycleBin.page.*` keys to every pack, including the `related` and `emptied` count families.

The Undo on the delete toast (#31795) also exported `RecordDeleteToastAction` from `@object-ui/core`: the `{ label, onClick }` action a host's `toast.success` receives.
