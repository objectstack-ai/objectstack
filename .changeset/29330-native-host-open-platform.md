---
'@object-ui/mobile': patch
---

fix(mobile): the native bridge's `platform` is an open set, and a bridge speaking a newer protocol reads as no bridge

Clause-②: yes (widening)
Metadata-protocol: none

The ObjectStack desktop shell hosts the Console through the same `window.ObjectStackNative` bridge as the mobile app, and reports a platform other than `ios` or `android`.

- **`ObjectStackNative.platform` widens** from `'ios' | 'android'` to `'ios' | 'android' | (string & {})`. The two known values still autocomplete. Code that switches exhaustively over the old two values now has to handle another string; branch on a capability (`has()`) or the viewport instead of the platform. The Console's root attribute `data-os-native-shell` carries the value verbatim.
- **Bridge protocol version gate.** The bridge's `version` bumps only on a breaking change, and this package speaks version `1`. `getNativeHost()` and `useNativeHost()` now answer `null` for a bridge whose `version` is greater than `1` or not a number, so a page keeps its browser behaviour (no shell mode, no `ready`, the PWA manifest kept) instead of calling a protocol it cannot read.
- **What `ready()` means, written down.** `ready` is posted when the Console has painted its own UI, which may be a loading fallback such as the auth guard's spinner while the session is read on a cold start. The shell lifts its loading cover on it, so the cover hands over to the Console's spinner rather than staying up through the session round-trip. Nothing about when it is posted changes.
