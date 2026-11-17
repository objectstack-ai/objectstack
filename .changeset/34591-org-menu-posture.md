---
'@object-ui/app-shell': patch
---

feat(app-shell): the avatar menu's organization entries follow the deployment posture, and the organization switcher moves into the avatar menu

Clause-②: no
Metadata-protocol: none

The avatar menu reads the deployment signals the server already serves on `GET /api/v1/auth/config` (`features.multiOrgEnabled`, `features.cloudManaged`, `features.tenancyPosture`) and offers organization entries by them:

- **Single-tenant** (`multiOrgEnabled` false, the `single` posture): no organization entry at all, and no organization switcher. Member management for the one organization stays at Setup → Organization.
- **Multi-organization**: "My Organizations" and "Create organization"; "Switch organization" joins them only when the member belongs to two or more organizations.
- **Cloud-managed** (`cloudManaged` true): no "Create organization"; organizations are created on the cloud there.

A server that serves none of these flags reads the spec's defaults (multi-organization on, not managed), which is the menu as it was.

The organization switcher no longer sits at the left of the top bar, which now holds only the product mark and the app switcher. It is the avatar menu's "Switch organization" submenu. Under the `group` posture it still names the working organization (the write target) and says that views show data from every organization the member belongs to (ADR-0105). On a walled posture (`group` or `isolated`) the top bar still names the active organization, read-only, now at any membership count (before, only at exactly one), so a member of two or more organizations still sees which organization lists are scoped to; the name is also shown under "My Organizations". The switcher's own "Manage members" and "Create organization" items are gone: "My Organizations" and the menu's own create entry lead to the same pages. Inside the ObjectStack mobile shell, the top-bar button that opens the shell's native connection switcher is unchanged.

There is no Setup setting for this menu.
