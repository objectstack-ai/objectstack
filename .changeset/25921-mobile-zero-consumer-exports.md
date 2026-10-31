---
'@object-ui/mobile': patch
---

refactor(mobile)!: retire the zero-consumer `useOfflineSync`, `requestBackgroundSync` and `resolveResponsiveValue` exports

Clause-②: no
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/mobile#useOfflineSync, @object-ui/mobile#OfflineSyncState, @object-ui/mobile#requestBackgroundSync, @object-ui/mobile#resolveResponsiveValue) the retired operands are a React hook, its state type and two plain helpers in a published ui package's entry that nothing in the workspace imported; no packages/spec schema, no registered node type, no ADR-0087 conversion surface and no stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these four names from `@object-ui/mobile`. None had an importer anywhere in the workspace, so the Console and every `@object-ui/*` package are unaffected. `useOfflineSync` is deleted with its module; `requestBackgroundSync` and `resolveResponsiveValue` leave the package entry only (`useResponsive` still resolves through the latter internally). The offline data source (`createOfflineDataSource`, `createOfflineQueue` and its queue classes), `getServiceWorkerSource`, `useResponsive` and `BREAKPOINTS` stay exported unchanged.

What leaves, and what to write instead:

- FROM `useOfflineSync(source)` TO your own effect on the `OfflineDataSource` that `createOfflineDataSource` returns: read `source.pending()` into state, call `source.replay()` on the window `online` event, and use `source.drop(opId)` / `source.clear()` for the queue controls.
- FROM `OfflineSyncState` TO the state shape that effect keeps (`isOnline`, `pending: OfflineOperation[]`, `isReplaying`).
- FROM `requestBackgroundSync(tag)` TO `(await navigator.serviceWorker.ready).sync?.register(tag)`, guarded for browsers without Background Sync.
- FROM `resolveResponsiveValue(value, breakpoint)` TO `useResponsive(value)` inside a component, which reads the current breakpoint itself.
