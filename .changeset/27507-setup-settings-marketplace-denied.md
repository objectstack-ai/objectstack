---
'@object-ui/app-shell': patch
---

fix(app-shell): a member the Setup app refuses gets the app's no-access page on Setup's settings and marketplace routes, not the default app's chrome around a misleading empty state or a raw capability error

Clause-②: no
Metadata-protocol: none

Opening `/apps/setup/system/settings`, `/apps/setup/system/settings/NAMESPACE`, `/apps/setup/system/marketplace` or `/apps/setup/system/marketplace/PACKAGE` without access to Setup used to fall back to the default app: the settings hub read the server's filtered, empty manifest list as "No settings registered", a settings page printed the server's capability error verbatim, and the marketplace drew its own admin-only notice. These routes now wait on Setup's access verdict, as Setup's root and the metadata routes already do, and draw the same "You don't have access to this app" page with its way back home. The server's refusals are unchanged; an administrator, and a caller under any app they may open, see the pages as before. The approvals inbox and the record pages it links to stay reachable under the Setup segment.

What to do: nothing.
