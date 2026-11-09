---
'@object-ui/app-shell': patch
---

fix(app-shell): the console AI dock tells the agent which app the user has selected and which page or record is in view, instead of the constant `activeApp: 'AI'` and no page at all (#30043)

Clause-②: no
Metadata-protocol: none

Every chat request the console sends to `POST /api/v1/ai/agents/:agent/chat` used to carry `context.activeApp: 'AI'`, whatever app the user was in, and the floating dock sent no `context.surface`. So the assistant asked "which app?" and "which record?" while the screen showed both.

Now:

- `context.activeApp` is the package of the app the user has selected: the console app the dock sits in (whether the dock runs `ask` or `build`), the app picked for editing on the full-page `/ai/build?package=…`, the package the Studio copilot designs. With no app selected the key is left out; nothing sends a placeholder.
- The dock, on the desktop rail and the phone sheet alike, sends `context.surface` in cloud#1610's existing shape for the page in view: an object list (`artifact: { type: 'object', name }`, with `selection: { kind: 'view', id }` on a saved list view), a record page (the object plus `selection: { kind: 'record', id }`), a dashboard, report or page (`artifact: { type, name }`, `mode: 'design'` in the dashboard designer). A page that shows no one artifact (the app landing, search, a component page) sends no `surface`.
- Both are read on every send, so navigating with the dock open moves the next turn's context.

The dock's "discussing" chip now names the object by its label on object pages, as the Studio copilot's chip already did for its artifacts.
