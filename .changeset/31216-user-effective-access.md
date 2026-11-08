---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/types': patch
'@object-ui/cli': patch
'@objectstack/platform-objects': patch
---

feat(console): the user page's Permission Sets tab shows the person's effective permission sets and where each comes from

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/app-shell`**: new SDUI widget `security:effective-access` for a `sys_user` record page. It reads the person from the bound record (no props) and lists every permission set in force for them in the caller's organization through `security.describeEffectiveAccess(userId)` of `@objectstack/client`. Each set appears once, by its catalog label with its name beside it, with every origin the server reports: a direct grant, a position by name, the default binding, or a derived standing (the configured platform administrator, AI access). A `403` (a person the viewer may not manage) and a `501` (a server that does not report effective access) each show one quiet line and no list; any other failure is named. The widget reads again when a grant or a position is written on the page. Off a `sys_user` record it renders nothing.
- **`@objectstack/platform-objects`**: the `sys_user` record page's Permission Sets tab opens with the `security:effective-access` widget, above the list of stored grants. A person who holds access only through the default binding or a position no longer reads as having no permission sets; direct grants keep their remove action in the list below.
- **`@object-ui/i18n`**: `effectiveAccess.*` (the widget's title, body, refused, unserved, failed and empty lines, and one label per origin kind) added in all eleven packs.
- **`@object-ui/types`**: `SecurityEffectiveAccessSchema` (zod arm) and its TypeScript twin, so a page placing `{ type: 'security:effective-access' }` validates. The widget reads only `className`: `properties` may only be `{}`, and `body` / `children` are refused by name.
- **`@object-ui/cli`**: `objectui check` knows the `security:effective-access` type (the generated known-types list).
