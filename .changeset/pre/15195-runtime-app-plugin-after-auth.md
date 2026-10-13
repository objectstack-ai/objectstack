---
'@objectstack/runtime': patch
---

`AppPlugin` starts after the auth plugin when both are composed, so the Default Organization exists before the inline seed loads

`AppPlugin` now declares the auth plugin (`com.objectstack.auth`) among its order-if-present dependencies. Under the `single` posture the auth plugin creates the Default Organization in its `start()` (ADR-0131 D3), and every seed row is stamped with it; the declaration makes the kernel start the auth plugin first instead of relying on the order plugins were registered in. A composition without the auth plugin is unaffected.
