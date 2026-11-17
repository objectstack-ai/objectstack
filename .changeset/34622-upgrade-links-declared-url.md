---
'@object-ui/app-shell': patch
---

fix(app-shell): the upgrade links open the runtime's declared `upgradeUrl`

Clause-②: no
Metadata-protocol: none

`GET /api/v1/runtime/config` already serves a top-level `upgradeUrl` when the host declares one: the absolute address of the control plane's upgrade or billing page. The Console never read it, so three upgrade links opened the Cloud origin instead. On Cloud, the origin redirects to the console root, and a manager whose only organization has a running environment lands back in that environment, so the link never reaches billing.

The Console now reads `upgradeUrl` as served (an absent, empty or non-string value stays absent; nothing is composed in its place) and exposes it as `getUpgradeUrl()`. These links open it when it is declared:

- the storage-full banner's "Upgrade to continue";
- the AI usage indicator's call to action;
- the AI chat's quota upgrade button.

When the runtime declares no `upgradeUrl`, each link behaves as before: it opens `cloudConsoleUrl()`, and it is not drawn on a runtime that names no upstream cloud.
