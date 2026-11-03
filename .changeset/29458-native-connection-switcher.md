---
'@object-ui/mobile': patch
'@object-ui/app-shell': patch
---

feat(mobile, app-shell): inside the ObjectStack mobile shell, the header's organization button opens the shell's native connection switcher, and the Console answers the shell's `connectionRemoved` event

Clause-②: yes (widening)
Metadata-protocol: none

The mobile shell's bridge (`window.ObjectStackNative`) gained `showConnectionSwitcher()` and the `objectstack-native:connectionRemoved` window event. The Console now uses both:

- **Organization button.** When the shell announces `has('showConnectionSwitcher')`, `WorkspaceSwitcher`'s button calls `showConnectionSwitcher()`, which opens the shell's own sheet of saved organizations and company servers. The web organization menu does not open. In the shell the button renders whenever there is an active organization, at one membership too, since the sheet lists the shell's connections across company servers; `CurrentOrganizationIndicator` then renders nothing, so the organization is drawn once. In a plain browser, or in a shell that does not announce the capability, both render as before.
- **Removed connection.** `useNativeHostRouting` listens for `objectstack-native:connectionRemoved` while the bridge is present and calls `event.waitUntil()` with the promise its new optional `onConnectionRemoved` returns. Omitted, the promise is already resolved, so the shell is released at once. No Console path registers a device push token yet, so there is nothing to unregister today. The option is where that unregister step goes once registration exists.

`@object-ui/mobile` adds `showConnectionSwitcher` to `NativeHostMethod` and, as an optional method (an older shell does not carry it), to `ObjectStackNative`, and exports `nativeShowConnectionSwitcher()`, `nativeHostCan(host, method)` (the wrappers' own feature-detect), `NATIVE_CONNECTION_REMOVED_EVENT` and the `NativeConnectionRemovedEvent` type. `@object-ui/app-shell` now depends on `@object-ui/mobile`.
