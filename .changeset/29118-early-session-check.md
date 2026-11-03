---
'@object-ui/console': patch
---

fix(console): the boot's `get-session` starts from `index.html`'s inline script beside `runtime/config`, and the preflight reuses the answer

Clause-②: no
Metadata-protocol: none

The Console's pre-React auth preflight validates the stored Bearer with `GET /api/v1/auth/get-session`, and its answer is the session `AuthProvider` starts from. It was sent from the main bundle, so it waited for that bundle to download and evaluate, a whole round trip behind the parse-time `runtime/config` prefetch, at the head of the startup chain.

`index.html` now carries a second parse-time script, `startEarlySessionCheck`, that sends the preflight's exact request (same URL, same `Authorization: Bearer` from `localStorage['auth-session-token']`, `credentials: 'include'`, same `Accept`) right after `runtime/config`, and leaves the pending answer under `Symbol.for('objectui.earlySessionCheck')` with the auth URL and token it sent. `preflightAuth()` takes it once when both match and reads it instead of asking again, so a page load sends one `get-session`, started during parse.

Every existing safety holds: no stored token or blocked storage sends nothing; a failed or non-OK early answer is not reused and the preflight fetches as before; a stale token answered early is purged as before; a token that changed since parse time is asked about again.
