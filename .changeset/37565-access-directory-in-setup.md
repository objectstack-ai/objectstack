---
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

feat(setup): the environment directory (positions, capabilities, permission sets, sharing rules) moves from Studio's menu to Setup → Access control

Clause-②: no
Metadata-protocol: none

Studio develops one package, and Setup holds what is global (ADR-0084, amended 2026-11-26). The cross-package directory of the environment's access metadata (positions, capabilities, permission sets and sharing rules) is now a Setup page: **Setup → Access control → Positions and Permissions** (`/apps/setup/component/security/access-directory`).

- The page shows the same directory and the same per-type lists as before, with the activation switches, Clone and New. Opening an item, creating one, or opening its history still happens in Studio, on the same editor as before.
- Studio's left menu no longer has the "Positions and permissions" entry under Access. On the organization-flows scope (`~org`), the menu's access rows open their lists on the Setup page.
- Old links keep working and land in one hop: `/studio/~all/metadata`, a directory type's list (`/studio/~all/metadata/permission?scope=environment`), a bare `/studio/~all/…` address, and the old Setup metadata URLs that led there. Item links under `/studio/~all/metadata/TYPE/NAME` are unchanged.
- Visibility does not widen. The Setup entry and the page both require `studio.access`, the capability that admitted a user to the directory in Studio, in addition to Setup's own `setup.access`.
- A user who can enter Studio but cannot open Setup → Packages, and has no recent package, now lands on Studio's organization-flows scope (`/studio/~org`) instead of the old directory. This is temporary: the scope retires when the door that moves loose items into a package ships, and the landing is decided again then.
- One new Setup menu label, "Positions and Permissions", in every Setup locale, and one new message for a user without `studio.access`.
