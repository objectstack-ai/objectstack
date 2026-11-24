---
'@object-ui/app-shell': patch
---

fix(app-shell): the shell's package list, the AI chat lists and the studio-design reads and writes send the stored bearer token, so a session the rest of the console accepts keeps its Studio and design entries

Clause-②: no
Metadata-protocol: none

These reads and writes called this server's `/api/` routes with the session cookie only (`credentials: 'include'`), while the rest of the console sends the stored bearer token through its authenticated fetch. A session held by its bearer token alone (a second local runtime on the same host replaced the cookie, the cookie was blocked as a third-party cookie, or the cookie jar was cleared) was answered `401` there. The most visible case was the shell's held package list (`GET /api/v1/packages`, read by the sidebar, the app header, the command palette and the Studio entries): every package went missing and the Studio and design entries with it, with no error shown.

They now go through `createAuthenticatedFetch` from `@object-ui/auth`, built per call: the package list and the studio-design package writes (ensure-customization, duplicate, customizations), the package switcher, the AI chat conversation list and conversation reads and writes, the build-debug report, AI usage, the inbox bell and the approval feeds, suggested bindings, the commit timeline and revert, the pending-draft and unpublished-app reads, the metadata-admin catalog, connector, flow and sharing reads, the packaged action and flow ledgers, the deployment notice, the connect-agent widget, the context selectors (only for requests to this server's own origin), and the same-origin cloud-connection and install routes of the marketplace. The session cookie still rides along (`credentials: 'include'` is unchanged), so a cookie session behaves exactly as before, and a `401` now reaches the console's session-ended check as it does on every other page. Nothing changes in what the server accepts.
