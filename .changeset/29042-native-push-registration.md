---
'@object-ui/console': patch
'@object-ui/mobile': patch
'@object-ui/auth': patch
---

feat(console,mobile,auth): the Console registers the mobile shell's push token under its own session and unregisters it on sign-out and when the shell removes the connection

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/console`:** in the ObjectStack mobile shell, a signed-in person who has reached Home or an app is asked for push permission once per page load, after a short delay (never on a sign-in screen): the Console calls `getPushToken()` and registers the token with `POST /api/v1/notifications/devices`. A `null` answer (simulator, permission denied, no token) sends nothing. A token the shell rotates is registered again; an unchanged token for the same person is not sent twice. Another person signing in on the page registers the device for them, and the registry moves the token away from the previous person. An impersonation never registers, so the impersonated person's pushes never reach the administrator's device. The registration sends `deviceId` as the shell's `installId` when it has one, and `origin` only when the page was loaded over `http:` or `https:`. The device is unregistered (`DELETE /api/v1/notifications/devices/:deviceId`) before sign-out ends the session, and when the shell removes this connection; a shell that is neither iOS nor Android registers nothing. A browser is unchanged.
- **`@object-ui/mobile`:** `ObjectStackNative` gains the optional `installId` (`string | null`), and the package exports `NATIVE_PUSH_TOKEN_CHANGED_EVENT` (`objectstack-native:pushTokenChanged`, announced as `has('pushTokenChanged')`) with its event type `NativePushTokenChangedEvent`. Both are feature-detected: a shell that predates them carries neither.
- **`@object-ui/auth`:** `registerBeforeSignOut(step)` registers a step that `signOut()` awaits while the session still exists, and returns the function that removes it. The steps run together and can never hold sign-out back: a rejection is reported and dropped, and sign-out goes ahead after `BEFORE_SIGN_OUT_TIMEOUT_MS` (3 s) whether or not they have settled.
