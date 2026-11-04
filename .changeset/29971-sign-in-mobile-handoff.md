---
'@object-ui/console': patch
---

fix(console): the sign-in page finishes the mobile sign-in hand-off instead of landing on a missing Console page

Clause-②: no
Metadata-protocol: none

The mobile app opens the Console's sign-in page in the system browser with `?redirect=` naming the hand-off route (`/api/v1/auth/one-time-token/handoff?...`), so that a user whose identity provider refuses embedded WebViews can still sign in. After sign-in the page sent every safe redirect through the Console mount, so the browser landed on `/_console/apps/.../api/v1/auth/one-time-token/handoff?...` and the page said it does not exist. Now:

- A `redirect` whose path is exactly the hand-off route under the auth base the Console talks to is navigated to unprefixed, by script from the sign-in page. Every other redirect, `/api/v1/data/x` included, stays a Console route as before; a lookalike path, another base path or an absolute URL is never followed out of the mount.
- The hand-off comes before the organization steps: a user with several organizations is no longer sent to the picker first, and one with no active organization does not wait for it to be chosen.
- A session created more than five minutes ago, which the hand-off refuses, keeps the sign-in form on screen instead of forwarding to a JSON refusal. Signing in on that form makes a new session and forwards.
- The sign-up page does the same after a sign-up.
