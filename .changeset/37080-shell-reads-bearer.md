---
'@object-ui/app-shell': patch
---

fix(app-shell): the package list, Studio, AI chat and draft screens send the stored sign-in token, so a session held by its token alone keeps its packages, Studio and design entries

Clause-②: no
Metadata-protocol: none

These screens asked this server for their data with the session cookie only, while the other same-server console requests also send the stored sign-in (bearer) token. A session held by its token alone (a second local runtime on the same host replaced the cookie, the browser blocked it as a third-party cookie, or the cookie jar was cleared) was refused there. The most visible case was the package list behind the sidebar, the app header, the command palette and the Studio entries: every package went missing, and the Studio and design entries with it, with no error shown.

They now send the token as well:

- packages: the package list and the package switcher, creating a package's customization package, duplicating a package, a package's customizations, and the package form;
- Studio: the automation status, cloning a flow, cloning a permission set, the flow picker and connector inputs, a flow's run history and node palette, the page preview, the sharing-rule catalog and catalog activation, and the packaged action and flow ledgers in Setup;
- drafts: the pending drafts, the unpublished-app bar, the draft changes panel and its flow checks, and the commit history with its revert;
- AI: the conversation list and conversations, the build-debug report, AI usage, and suggested bindings;
- the inbox bell, the approval feeds and a record's approvals, and changing a record's owner;
- the shell: the no-access state, the deployment notice, the connect-agent widget, the context selectors (only for requests to this server's own origin), the design-mode language list, and the marketplace's install steps on this server.

The session cookie is still sent, so a cookie session behaves exactly as before, and a refused request now reaches the console's session-ended check. A few requests stay cookie-only for now, among them sign-in, the OAuth hand-off, public forms and calls to the cloud control plane; they are unchanged. Nothing changes in what the server accepts.
