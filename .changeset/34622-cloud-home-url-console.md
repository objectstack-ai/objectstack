---
'@object-ui/app-shell': patch
---

feat(app-shell): the marketplace "Open on Cloud" link opens the runtime's declared `cloudHomeUrl`

Clause-②: yes (widening)
Metadata-protocol: none

The Console reads the top-level `cloudHomeUrl` from `GET /api/v1/runtime/config` as served (an absent, empty or non-string value stays absent; nothing is composed in its place) and exposes it as `getCloudHomeUrl()`. The install dialog's "Open on Cloud" link, shown when the caller's cloud environments cannot be listed, opens it when it is declared.

When the runtime declares no `cloudHomeUrl`, the link behaves as before: it opens `cloudConsoleUrl()`, and it is not drawn on a runtime that names no upstream cloud.
