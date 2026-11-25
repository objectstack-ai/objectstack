---
'@object-ui/components': patch
---

fix(components): the phone navigation drawer announces its name in the session's language

Clause-②: no
Metadata-protocol: none

Below the mobile breakpoint `Sidebar` opens a drawer whose screen-reader name was the English "Sidebar", with the English description "Displays the mobile sidebar.", in every locale. The drawer is now named with `console.nav.menuLabel` (en "App navigation", zh-Hans "应用导航"), the name the app menu inside it already announces, and it has no description. Nothing visible changes. The edit to the regenerated Shadcn `sidebar.tsx` is declared as the `sidebar-drawer-label-*` patches in `ui/scripts/shadcn-local-patches.mjs`, so a shadcn sync keeps it.
