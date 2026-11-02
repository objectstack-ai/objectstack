---
'@object-ui/mobile': patch
'@object-ui/console': patch
---

feat(mobile): native shell mode — the Console detects `window.ObjectStackNative` and talks to the ObjectStack mobile shell that hosts it

Clause-②: yes (widening) — `@object-ui/mobile` is published and gains new exports; the seat writes the TIER_DEFAULT contract review.
Metadata-protocol: none

The ObjectStack mobile app hosts the web Console in a WebView and injects a bridge, `window.ObjectStackNative`, before the Console's scripts run (on older Android WebViews, possibly after them). The Console now knows when it is hosted.

- **`@object-ui/mobile` gains the bridge type and detection.** `ObjectStackNative` types exactly the members of the shell's bridge contract (`version`, `platform`, `appVersion`, `capabilities`, `safeArea`, `has`, the five calls and the two events). `useNativeHost()` returns it, or `null` outside the shell; it reads the global lazily and re-checks at `DOMContentLoaded`, `load` and a few points after `load`, so a late injection still arrives. `getNativeHost()` is the same read outside React.
- **Typed calls that never throw.** `nativeGetPushToken`, `nativeHaptic`, `nativeOpenExternal`, `nativeNavigate` and `nativeResetServer` check `has(capability)` and that the method exists, and resolve a `NativeCallResult`: `{ status: 'unavailable' }`, `{ status: 'ok', value }`, or `{ status: 'failed', code, message }`.
- **Router wiring.** `useNativeHostRouting({ route, navigate })` posts `ready()` once per page load after the first route has rendered, posts `routeChanged(route)` once per route change, and answers the shell's cancelable `objectstack-native:navigate` window event by moving the router to `detail.route` (an in-app path only) and cancelling the event, so a notification tap does not reload the Console. Outside the shell it installs nothing.
- **The Console uses it.** In the shell the Console posts those events from its router, marks the root element with `data-os-native-shell` set to the shell's platform string (an open set: `ios` and `android` from the mobile app, another value from another shell), and drops the PWA install manifest. It adds no safe-area padding: the shell already pads its WebView. Without the global the Console behaves exactly as before.
