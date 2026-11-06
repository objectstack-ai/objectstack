---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console): the Allowed IP ranges setting shows the address the server judges before you save

Clause-②: no
Metadata-protocol: none

A save of `auth.allowed_ip_ranges` whose list leaves out the saving request's own address is refused, and until now the Authentication settings page only told the admin that address in the refusal. The page now reads `GET /api/v1/auth/admin/client-address` (the save check's own reading of the address, `server.trustProxy` included) and draws one line under the field: the address, and whether it came from a trusted proxy's forwarded headers or, with `trustProxy` off, from the connection itself (behind a proxy, the proxy's address). When the server cannot establish an address the line says a non-empty list cannot be saved from here. The line stays beside a refusal. A caller the route refuses (not a platform admin), or a server without the route, sees no line and the page is otherwise unchanged. `@object-ui/i18n` adds `console.settingsView.clientAddressDirect`, `clientAddressViaProxy` and `clientAddressUnknown` in all ten shipped locales.
