---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): the Users import wizard maps a manager column, sent to import-users as `manager_id`

Clause-②: no
Metadata-protocol: none

`POST /api/v1/auth/admin/import-users` already reads a `manager_id` column (the manager's email, or phone number where phone sign-in is on, linked after every row lands), but the Users import wizard offered no such target column, so a file's manager column could not be mapped and never reached the request. The wizard now offers `manager_id`, labelled by the `sys_user` field (`Manager`), and its options panel explains the column (`console.identityImport.managerHint`, in every `@object-ui/i18n` pack). What the endpoint accepts is unchanged.
