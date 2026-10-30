---
'@object-ui/app-shell': patch
---

fix(console): a click on a declared same-origin `type: 'api'` action goes through the platform action door

Clause-②: no
Metadata-protocol: none

The console's two api handlers (list, toolbar and page actions; the record page's header and related lists) fetched an api action's `target` directly, so the click met none of the platform's gates: switching a packaged api action off in Setup did not stop its button, and a human click took a different road from an agent's `run_action`. A click whose object and `name` resolve to a declared `type: 'api'` action whose `target` is a path on this origin now goes to `POST /api/v1/actions/:object/:action` with the subject row's id and the params bag (`{{page.<var>}}` tokens resolved in the browser). The server runs the sign-in floor, `requiredPermissions`, the activation switch, the param contract and the subject-row load, then forwards to the declared target with the body it assembles from the declaration. A switched-off action answers `409 ACTION_DISABLED`, shown as its sentence, and its target is never called.

An api action whose `target` is on another origin, and an inline page button that names no declared action, keep the direct fetch. The entitlement dialog, the flow-backed refusal message, the `{ success, data }` unwrap, the `newTabUrl` fast path and `refreshAfter` read the door's answer as they read the target's.
