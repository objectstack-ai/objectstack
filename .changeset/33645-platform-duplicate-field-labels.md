---
'@objectstack/platform-objects': patch
---

fix(platform-objects): three translated locales no longer show two visible fields of one platform object under one label

Clause-②: no
Metadata-protocol: none

- ru: `sys_import_job.created_count` now reads "Создано записей" (a count of records created), so it no longer shares "Создано" with `created_at`.
- ar: `sys_oauth_resource.identifier` now reads "معرّف URI للمورد" (the resource indicator URI), so it no longer shares "المعرّف" with `id`.
- fr: `sys_user.manager_id` now reads "Responsable hiérarchique" (the direct manager), so it no longer shares "Responsable" with `accountable_user_id`.

Only translated leaf values change; English labels and the bundle structure are unchanged.
