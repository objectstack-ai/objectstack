# @objectstack/plugin-dev

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/plugin-hono-server@14.2.0
  - @objectstack/plugin-security@14.2.0
  - @objectstack/spec@14.2.0
  - @objectstack/runtime@14.2.0
  - @objectstack/account@14.2.0
  - @objectstack/setup@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/objectql@14.2.0
  - @objectstack/driver-memory@14.2.0
  - @objectstack/plugin-auth@14.2.0
  - @objectstack/rest@14.2.0
  - @objectstack/service-i18n@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/account@14.1.0
  - @objectstack/setup@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/objectql@14.1.0
  - @objectstack/driver-memory@14.1.0
  - @objectstack/plugin-auth@14.1.0
  - @objectstack/plugin-hono-server@14.1.0
  - @objectstack/plugin-security@14.1.0
  - @objectstack/rest@14.1.0
  - @objectstack/runtime@14.1.0
  - @objectstack/service-i18n@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [57b8fe0]
- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [ac08698]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [bc26360]
- Updated dependencies [afa8115]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
- Updated dependencies [bd39dc5]
- Updated dependencies [1056c5f]
  - @objectstack/runtime@14.0.0
  - @objectstack/spec@14.0.0
  - @objectstack/plugin-security@14.0.0
  - @objectstack/rest@14.0.0
  - @objectstack/objectql@14.0.0
  - @objectstack/account@14.0.0
  - @objectstack/setup@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/driver-memory@14.0.0
  - @objectstack/plugin-auth@14.0.0
  - @objectstack/plugin-hono-server@14.0.0
  - @objectstack/service-i18n@14.0.0
  - @objectstack/types@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [799b285]
- Updated dependencies [b1081b8]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [a1766fe]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/runtime@13.0.0
  - @objectstack/objectql@13.0.0
  - @objectstack/rest@13.0.0
  - @objectstack/plugin-security@13.0.0
  - @objectstack/plugin-auth@13.0.0
  - @objectstack/plugin-hono-server@13.0.0
  - @objectstack/types@13.0.0
  - @objectstack/account@13.0.0
  - @objectstack/setup@13.0.0
  - @objectstack/driver-memory@13.0.0
  - @objectstack/service-i18n@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [b5a87eb]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/runtime@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/rest@12.6.0
  - @objectstack/account@12.6.0
  - @objectstack/setup@12.6.0
  - @objectstack/objectql@12.6.0
  - @objectstack/driver-memory@12.6.0
  - @objectstack/plugin-auth@12.6.0
  - @objectstack/plugin-hono-server@12.6.0
  - @objectstack/plugin-org-scoping@12.6.0
  - @objectstack/plugin-security@12.6.0
  - @objectstack/service-i18n@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- 3b9fd94: `os dev` / `os start` / `os serve` no longer default-load the `@objectstack/studio` app package.

  The console ships a dedicated Studio surface at `/_console/studio/<package-id>/<pillar>`,
  so Studio no longer needs to exist as a navigable app tile in the home "Your apps" list.
  The `@objectstack/studio` package is unchanged and can still be registered explicitly;
  Setup and Account remain default-loaded (ADR-0048 one-app-per-package mechanism).

- f85635e: Drop the `@objectstack/studio` dependency from `cli` and `plugin-dev`. Since Studio is no longer default-loaded by `os dev` / `os start` / `os serve` (the console hosts it at `/_console/studio/...`), neither package imports it at runtime any more. The only remaining consumer was the ADR-0048 app-split test in `cli`, which now exercises the identical one-app-package code path via Setup + Account. The `@objectstack/studio` package itself is unchanged and still registerable explicitly.
- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/objectql@12.5.0
  - @objectstack/account@12.5.0
  - @objectstack/setup@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/driver-memory@12.5.0
  - @objectstack/plugin-auth@12.5.0
  - @objectstack/plugin-hono-server@12.5.0
  - @objectstack/plugin-org-scoping@12.5.0
  - @objectstack/plugin-security@12.5.0
  - @objectstack/rest@12.5.0
  - @objectstack/runtime@12.5.0
  - @objectstack/service-i18n@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/objectql@12.4.0
  - @objectstack/runtime@12.4.0
  - @objectstack/account@12.4.0
  - @objectstack/setup@12.4.0
  - @objectstack/studio@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/driver-memory@12.4.0
  - @objectstack/plugin-auth@12.4.0
  - @objectstack/plugin-hono-server@12.4.0
  - @objectstack/plugin-org-scoping@12.4.0
  - @objectstack/plugin-security@12.4.0
  - @objectstack/rest@12.4.0
  - @objectstack/service-i18n@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [5a0da03]
- Updated dependencies [e7eceec]
  - @objectstack/objectql@12.3.0
  - @objectstack/spec@12.3.0
  - @objectstack/rest@12.3.0
  - @objectstack/runtime@12.3.0
  - @objectstack/account@12.3.0
  - @objectstack/setup@12.3.0
  - @objectstack/studio@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/driver-memory@12.3.0
  - @objectstack/plugin-auth@12.3.0
  - @objectstack/plugin-hono-server@12.3.0
  - @objectstack/plugin-org-scoping@12.3.0
  - @objectstack/plugin-security@12.3.0
  - @objectstack/service-i18n@12.3.0
  - @objectstack/types@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/rest@12.2.0
  - @objectstack/spec@12.2.0
  - @objectstack/plugin-security@12.2.0
  - @objectstack/objectql@12.2.0
  - @objectstack/runtime@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/service-i18n@12.2.0
  - @objectstack/account@12.2.0
  - @objectstack/setup@12.2.0
  - @objectstack/studio@12.2.0
  - @objectstack/driver-memory@12.2.0
  - @objectstack/plugin-auth@12.2.0
  - @objectstack/plugin-hono-server@12.2.0
  - @objectstack/plugin-org-scoping@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [497bda8]
- Updated dependencies [93e6d02]
  - @objectstack/runtime@12.1.0
  - @objectstack/spec@12.1.0
  - @objectstack/account@12.1.0
  - @objectstack/setup@12.1.0
  - @objectstack/studio@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/objectql@12.1.0
  - @objectstack/driver-memory@12.1.0
  - @objectstack/plugin-auth@12.1.0
  - @objectstack/plugin-hono-server@12.1.0
  - @objectstack/plugin-org-scoping@12.1.0
  - @objectstack/plugin-security@12.1.0
  - @objectstack/rest@12.1.0
  - @objectstack/service-i18n@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [1b1b34e]
- Updated dependencies [9796e7c]
- Updated dependencies [9693a36]
- Updated dependencies [7c09621]
- Updated dependencies [2d567cb]
- Updated dependencies [e3498fb]
- Updated dependencies [24b62ee]
- Updated dependencies [7709db4]
- Updated dependencies [48ad533]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [c2fdbf9]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/plugin-auth@12.0.0
  - @objectstack/plugin-security@12.0.0
  - @objectstack/runtime@12.0.0
  - @objectstack/objectql@12.0.0
  - @objectstack/rest@12.0.0
  - @objectstack/account@12.0.0
  - @objectstack/setup@12.0.0
  - @objectstack/studio@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/driver-memory@12.0.0
  - @objectstack/plugin-hono-server@12.0.0
  - @objectstack/plugin-org-scoping@12.0.0
  - @objectstack/service-i18n@12.0.0
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/plugin-security@11.10.0
  - @objectstack/account@11.10.0
  - @objectstack/setup@11.10.0
  - @objectstack/studio@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/objectql@11.10.0
  - @objectstack/driver-memory@11.10.0
  - @objectstack/plugin-auth@11.10.0
  - @objectstack/plugin-hono-server@11.10.0
  - @objectstack/plugin-org-scoping@11.10.0
  - @objectstack/rest@11.10.0
  - @objectstack/runtime@11.10.0
  - @objectstack/service-i18n@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [852bc8e]
- Updated dependencies [d3595d9]
  - @objectstack/runtime@11.9.0
  - @objectstack/spec@11.9.0
  - @objectstack/account@11.9.0
  - @objectstack/setup@11.9.0
  - @objectstack/studio@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/objectql@11.9.0
  - @objectstack/driver-memory@11.9.0
  - @objectstack/plugin-auth@11.9.0
  - @objectstack/plugin-hono-server@11.9.0
  - @objectstack/plugin-org-scoping@11.9.0
  - @objectstack/plugin-security@11.9.0
  - @objectstack/rest@11.9.0
  - @objectstack/service-i18n@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/account@11.8.0
- @objectstack/setup@11.8.0
- @objectstack/studio@11.8.0
- @objectstack/plugin-auth@11.8.0
- @objectstack/plugin-org-scoping@11.8.0
- @objectstack/plugin-security@11.8.0
- @objectstack/rest@11.8.0
- @objectstack/runtime@11.8.0
- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/types@11.8.0
- @objectstack/objectql@11.8.0
- @objectstack/driver-memory@11.8.0
- @objectstack/plugin-hono-server@11.8.0
- @objectstack/service-i18n@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/account@11.7.0
  - @objectstack/setup@11.7.0
  - @objectstack/studio@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/objectql@11.7.0
  - @objectstack/driver-memory@11.7.0
  - @objectstack/plugin-auth@11.7.0
  - @objectstack/plugin-hono-server@11.7.0
  - @objectstack/plugin-org-scoping@11.7.0
  - @objectstack/plugin-security@11.7.0
  - @objectstack/rest@11.7.0
  - @objectstack/runtime@11.7.0
  - @objectstack/service-i18n@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/objectql@11.6.0
- @objectstack/studio@11.6.0
- @objectstack/setup@11.6.0
- @objectstack/runtime@11.6.0
- @objectstack/rest@11.6.0
- @objectstack/driver-memory@11.6.0
- @objectstack/plugin-auth@11.6.0
- @objectstack/plugin-hono-server@11.6.0
- @objectstack/plugin-org-scoping@11.6.0
- @objectstack/plugin-security@11.6.0
- @objectstack/service-i18n@11.6.0
- @objectstack/account@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/account@11.5.0
  - @objectstack/setup@11.5.0
  - @objectstack/studio@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/objectql@11.5.0
  - @objectstack/driver-memory@11.5.0
  - @objectstack/plugin-auth@11.5.0
  - @objectstack/plugin-hono-server@11.5.0
  - @objectstack/plugin-org-scoping@11.5.0
  - @objectstack/plugin-security@11.5.0
  - @objectstack/rest@11.5.0
  - @objectstack/runtime@11.5.0
  - @objectstack/service-i18n@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/account@11.4.0
  - @objectstack/setup@11.4.0
  - @objectstack/studio@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/objectql@11.4.0
  - @objectstack/driver-memory@11.4.0
  - @objectstack/plugin-auth@11.4.0
  - @objectstack/plugin-hono-server@11.4.0
  - @objectstack/plugin-org-scoping@11.4.0
  - @objectstack/plugin-security@11.4.0
  - @objectstack/rest@11.4.0
  - @objectstack/runtime@11.4.0
  - @objectstack/service-i18n@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
- Updated dependencies [59576d0]
  - @objectstack/spec@11.3.0
  - @objectstack/plugin-auth@11.3.0
  - @objectstack/account@11.3.0
  - @objectstack/setup@11.3.0
  - @objectstack/studio@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/objectql@11.3.0
  - @objectstack/driver-memory@11.3.0
  - @objectstack/plugin-hono-server@11.3.0
  - @objectstack/plugin-org-scoping@11.3.0
  - @objectstack/plugin-security@11.3.0
  - @objectstack/rest@11.3.0
  - @objectstack/runtime@11.3.0
  - @objectstack/service-i18n@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/account@11.2.0
  - @objectstack/setup@11.2.0
  - @objectstack/studio@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/objectql@11.2.0
  - @objectstack/driver-memory@11.2.0
  - @objectstack/plugin-auth@11.2.0
  - @objectstack/plugin-hono-server@11.2.0
  - @objectstack/plugin-org-scoping@11.2.0
  - @objectstack/plugin-security@11.2.0
  - @objectstack/rest@11.2.0
  - @objectstack/runtime@11.2.0
  - @objectstack/service-i18n@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [574e7a3]
- Updated dependencies [cbc8c02]
- Updated dependencies [18f9713]
- Updated dependencies [7cf81a7]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [8c84c97]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [13dbcf2]
- Updated dependencies [9ccfcd6]
- Updated dependencies [dc2990f]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
- Updated dependencies [7087cfe]
- Updated dependencies [69ae136]
  - @objectstack/plugin-security@11.1.0
  - @objectstack/plugin-auth@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/rest@11.1.0
  - @objectstack/runtime@11.1.0
  - @objectstack/objectql@11.1.0
  - @objectstack/plugin-hono-server@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0
  - @objectstack/driver-memory@11.1.0
  - @objectstack/account@11.1.0
  - @objectstack/setup@11.1.0
  - @objectstack/studio@11.1.0
  - @objectstack/plugin-org-scoping@11.1.0
  - @objectstack/service-i18n@11.1.0

## 11.0.0

### Major Changes

- 638f472: Remove the deprecated `IUIService` contract (use `IMetadataService`) — 11.0.

  `IUIService` (spec `contracts/ui-service.ts`) was superseded by `IMetadataService`
  (views/dashboards are metadata: `metadata.get('view', …)` / `register(…)`). This
  removes the dead interface and its dev stub:

  - spec: delete `contracts/ui-service.ts` + its barrel export.
  - plugin-dev: drop the bespoke `ui` dev stub (`createUIStub`). `'ui'` remains a
    `CoreServiceName`, so dev mode still registers a generic stub for it via the
    fallback path; only the obsolete view/dashboard methods are gone.

  Use `IMetadataService` for view/dashboard CRUD.

### Patch Changes

- Updated dependencies [caa3ef4]
- Updated dependencies [22b32c1]
- Updated dependencies [4d99a5c]
- Updated dependencies [21b3208]
- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
- Updated dependencies [ab5718a]
- Updated dependencies [61d441f]
- Updated dependencies [c224e18]
- Updated dependencies [d616e1d]
- Updated dependencies [1e8a813]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [359c0aa]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [9a810f8]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [a619a3a]
- Updated dependencies [795b6d1]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/plugin-auth@11.0.0
  - @objectstack/objectql@11.0.0
  - @objectstack/runtime@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/rest@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0
  - @objectstack/account@11.0.0
  - @objectstack/setup@11.0.0
  - @objectstack/studio@11.0.0
  - @objectstack/plugin-org-scoping@11.0.0
  - @objectstack/plugin-security@11.0.0
  - @objectstack/driver-memory@11.0.0
  - @objectstack/plugin-hono-server@11.0.0
  - @objectstack/service-i18n@11.0.0

## 10.3.0

### Patch Changes

- Updated dependencies [211425e]
- Updated dependencies [8cf4f7c]
- Updated dependencies [f2063f3]
  - @objectstack/objectql@10.3.0
  - @objectstack/runtime@10.3.0
  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0
  - @objectstack/types@10.3.0
  - @objectstack/studio@10.3.0
  - @objectstack/setup@10.3.0
  - @objectstack/rest@10.3.0
  - @objectstack/driver-memory@10.3.0
  - @objectstack/plugin-auth@10.3.0
  - @objectstack/plugin-hono-server@10.3.0
  - @objectstack/plugin-org-scoping@10.3.0
  - @objectstack/plugin-security@10.3.0
  - @objectstack/service-i18n@10.3.0
  - @objectstack/account@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/account@10.2.0
  - @objectstack/setup@10.2.0
  - @objectstack/studio@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/objectql@10.2.0
  - @objectstack/driver-memory@10.2.0
  - @objectstack/plugin-auth@10.2.0
  - @objectstack/plugin-hono-server@10.2.0
  - @objectstack/plugin-org-scoping@10.2.0
  - @objectstack/plugin-security@10.2.0
  - @objectstack/rest@10.2.0
  - @objectstack/runtime@10.2.0
  - @objectstack/service-i18n@10.2.0
  - @objectstack/types@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
- Updated dependencies [94d2161]
- Updated dependencies [517dad9]
  - @objectstack/spec@10.1.0
  - @objectstack/runtime@10.1.0
  - @objectstack/rest@10.1.0
  - @objectstack/account@10.1.0
  - @objectstack/setup@10.1.0
  - @objectstack/studio@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/objectql@10.1.0
  - @objectstack/driver-memory@10.1.0
  - @objectstack/plugin-auth@10.1.0
  - @objectstack/plugin-hono-server@10.1.0
  - @objectstack/plugin-org-scoping@10.1.0
  - @objectstack/plugin-security@10.1.0
  - @objectstack/service-i18n@10.1.0
  - @objectstack/types@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [e16f2a8]
- Updated dependencies [cfd86ce]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [47d978a]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [3754f80]
- Updated dependencies [feead7e]
- Updated dependencies [00c32f2]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/objectql@10.0.0
  - @objectstack/rest@10.0.0
  - @objectstack/plugin-security@10.0.0
  - @objectstack/runtime@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/plugin-hono-server@10.0.0
  - @objectstack/account@10.0.0
  - @objectstack/setup@10.0.0
  - @objectstack/studio@10.0.0
  - @objectstack/driver-memory@10.0.0
  - @objectstack/plugin-auth@10.0.0
  - @objectstack/plugin-org-scoping@10.0.0
  - @objectstack/service-i18n@10.0.0
  - @objectstack/types@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [e7f6539]
- Updated dependencies [fa8964d]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [751f5cf]
- Updated dependencies [5a5a9fe]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/rest@9.11.0
  - @objectstack/plugin-security@9.11.0
  - @objectstack/objectql@9.11.0
  - @objectstack/runtime@9.11.0
  - @objectstack/account@9.11.0
  - @objectstack/setup@9.11.0
  - @objectstack/studio@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/driver-memory@9.11.0
  - @objectstack/plugin-auth@9.11.0
  - @objectstack/plugin-hono-server@9.11.0
  - @objectstack/plugin-org-scoping@9.11.0
  - @objectstack/service-i18n@9.11.0
  - @objectstack/types@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [f169558]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
- Updated dependencies [fd07027]
  - @objectstack/spec@9.10.0
  - @objectstack/plugin-org-scoping@9.10.0
  - @objectstack/plugin-security@9.10.0
  - @objectstack/objectql@9.10.0
  - @objectstack/runtime@9.10.0
  - @objectstack/rest@9.10.0
  - @objectstack/account@9.10.0
  - @objectstack/setup@9.10.0
  - @objectstack/studio@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/driver-memory@9.10.0
  - @objectstack/plugin-auth@9.10.0
  - @objectstack/plugin-hono-server@9.10.0
  - @objectstack/service-i18n@9.10.0
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1
- @objectstack/objectql@9.9.1
- @objectstack/studio@9.9.1
- @objectstack/setup@9.9.1
- @objectstack/runtime@9.9.1
- @objectstack/rest@9.9.1
- @objectstack/driver-memory@9.9.1
- @objectstack/plugin-auth@9.9.1
- @objectstack/plugin-hono-server@9.9.1
- @objectstack/plugin-org-scoping@9.9.1
- @objectstack/plugin-security@9.9.1
- @objectstack/service-i18n@9.9.1
- @objectstack/account@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [0d4e3f3]
- Updated dependencies [44c5348]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [bfa3102]
- Updated dependencies [83fd318]
- Updated dependencies [134043a]
- Updated dependencies [67c29ee]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [92d75ca]
- Updated dependencies [601cc11]
- Updated dependencies [d99a75a]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/plugin-auth@9.9.0
  - @objectstack/objectql@9.9.0
  - @objectstack/rest@9.9.0
  - @objectstack/runtime@9.9.0
  - @objectstack/plugin-security@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/account@9.9.0
  - @objectstack/setup@9.9.0
  - @objectstack/studio@9.9.0
  - @objectstack/driver-memory@9.9.0
  - @objectstack/plugin-hono-server@9.9.0
  - @objectstack/plugin-org-scoping@9.9.0
  - @objectstack/service-i18n@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [7fe0b91]
- Updated dependencies [76ac582]
- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
- Updated dependencies [884bf2f]
  - @objectstack/rest@9.8.0
  - @objectstack/objectql@9.8.0
  - @objectstack/spec@9.8.0
  - @objectstack/runtime@9.8.0
  - @objectstack/account@9.8.0
  - @objectstack/setup@9.8.0
  - @objectstack/studio@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/driver-memory@9.8.0
  - @objectstack/plugin-auth@9.8.0
  - @objectstack/plugin-hono-server@9.8.0
  - @objectstack/plugin-org-scoping@9.8.0
  - @objectstack/plugin-security@9.8.0
  - @objectstack/service-i18n@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/objectql@9.7.0
- @objectstack/runtime@9.7.0
- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/types@9.7.0
- @objectstack/studio@9.7.0
- @objectstack/setup@9.7.0
- @objectstack/rest@9.7.0
- @objectstack/driver-memory@9.7.0
- @objectstack/plugin-auth@9.7.0
- @objectstack/plugin-hono-server@9.7.0
- @objectstack/plugin-org-scoping@9.7.0
- @objectstack/plugin-security@9.7.0
- @objectstack/service-i18n@9.7.0
- @objectstack/account@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [1b82b64]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
- Updated dependencies [b04b7e3]
- Updated dependencies [d13df3f]
  - @objectstack/spec@9.6.0
  - @objectstack/plugin-auth@9.6.0
  - @objectstack/objectql@9.6.0
  - @objectstack/rest@9.6.0
  - @objectstack/runtime@9.6.0
  - @objectstack/account@9.6.0
  - @objectstack/setup@9.6.0
  - @objectstack/studio@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/driver-memory@9.6.0
  - @objectstack/plugin-hono-server@9.6.0
  - @objectstack/plugin-org-scoping@9.6.0
  - @objectstack/plugin-security@9.6.0
  - @objectstack/service-i18n@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/account@9.5.1
  - @objectstack/setup@9.5.1
  - @objectstack/studio@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/objectql@9.5.1
  - @objectstack/driver-memory@9.5.1
  - @objectstack/plugin-auth@9.5.1
  - @objectstack/plugin-hono-server@9.5.1
  - @objectstack/plugin-org-scoping@9.5.1
  - @objectstack/plugin-security@9.5.1
  - @objectstack/rest@9.5.1
  - @objectstack/runtime@9.5.1
  - @objectstack/service-i18n@9.5.1
  - @objectstack/types@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
- Updated dependencies [1a4f079]
- Updated dependencies [110a333]
  - @objectstack/spec@9.5.0
  - @objectstack/rest@9.5.0
  - @objectstack/setup@9.5.0
  - @objectstack/studio@9.5.0
  - @objectstack/account@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/objectql@9.5.0
  - @objectstack/driver-memory@9.5.0
  - @objectstack/plugin-auth@9.5.0
  - @objectstack/plugin-hono-server@9.5.0
  - @objectstack/plugin-org-scoping@9.5.0
  - @objectstack/plugin-security@9.5.0
  - @objectstack/runtime@9.5.0
  - @objectstack/service-i18n@9.5.0
  - @objectstack/types@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [c1dfe34]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [593d43b]
- Updated dependencies [593d43b]
- Updated dependencies [593d43b]
- Updated dependencies [3e675f6]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/objectql@9.4.0
  - @objectstack/rest@9.4.0
  - @objectstack/runtime@9.4.0
  - @objectstack/account@9.4.0
  - @objectstack/setup@9.4.0
  - @objectstack/studio@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/driver-memory@9.4.0
  - @objectstack/plugin-auth@9.4.0
  - @objectstack/plugin-hono-server@9.4.0
  - @objectstack/plugin-org-scoping@9.4.0
  - @objectstack/plugin-security@9.4.0
  - @objectstack/service-i18n@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [b08d08d]
- Updated dependencies [6259882]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
- Updated dependencies [b10aa78]
- Updated dependencies [2796a1f]
  - @objectstack/spec@9.3.0
  - @objectstack/objectql@9.3.0
  - @objectstack/runtime@9.3.0
  - @objectstack/rest@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/driver-memory@9.3.0
  - @objectstack/plugin-auth@9.3.0
  - @objectstack/plugin-hono-server@9.3.0
  - @objectstack/plugin-org-scoping@9.3.0
  - @objectstack/plugin-security@9.3.0
  - @objectstack/service-i18n@9.3.0
  - @objectstack/types@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/objectql@9.2.0
  - @objectstack/driver-memory@9.2.0
  - @objectstack/plugin-auth@9.2.0
  - @objectstack/plugin-hono-server@9.2.0
  - @objectstack/plugin-org-scoping@9.2.0
  - @objectstack/plugin-security@9.2.0
  - @objectstack/rest@9.2.0
  - @objectstack/runtime@9.2.0
  - @objectstack/service-i18n@9.2.0
  - @objectstack/types@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/objectql@9.1.0
  - @objectstack/driver-memory@9.1.0
  - @objectstack/plugin-auth@9.1.0
  - @objectstack/plugin-hono-server@9.1.0
  - @objectstack/plugin-org-scoping@9.1.0
  - @objectstack/plugin-security@9.1.0
  - @objectstack/rest@9.1.0
  - @objectstack/runtime@9.1.0
  - @objectstack/service-i18n@9.1.0
  - @objectstack/types@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/objectql@9.0.1
  - @objectstack/driver-memory@9.0.1
  - @objectstack/plugin-auth@9.0.1
  - @objectstack/plugin-hono-server@9.0.1
  - @objectstack/plugin-org-scoping@9.0.1
  - @objectstack/plugin-security@9.0.1
  - @objectstack/rest@9.0.1
  - @objectstack/runtime@9.0.1
  - @objectstack/service-i18n@9.0.1
  - @objectstack/types@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/plugin-auth@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/objectql@9.0.0
  - @objectstack/driver-memory@9.0.0
  - @objectstack/plugin-hono-server@9.0.0
  - @objectstack/plugin-org-scoping@9.0.0
  - @objectstack/plugin-security@9.0.0
  - @objectstack/rest@9.0.0
  - @objectstack/runtime@9.0.0
  - @objectstack/service-i18n@9.0.0
  - @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/types@8.0.1
- @objectstack/objectql@8.0.1
- @objectstack/runtime@8.0.1
- @objectstack/rest@8.0.1
- @objectstack/driver-memory@8.0.1
- @objectstack/plugin-auth@8.0.1
- @objectstack/plugin-hono-server@8.0.1
- @objectstack/plugin-org-scoping@8.0.1
- @objectstack/plugin-security@8.0.1
- @objectstack/service-i18n@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [f68be58]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [93f97b2]
- Updated dependencies [bc0d85b]
- Updated dependencies [2537e28]
- Updated dependencies [0ec7717]
- Updated dependencies [e6374b5]
- Updated dependencies [1e8b680]
- Updated dependencies [0a6438e]
- Updated dependencies [3306d2f]
- Updated dependencies [ae7fb3f]
- Updated dependencies [c262301]
- Updated dependencies [e1478fe]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
- Updated dependencies [345e189]
  - @objectstack/spec@8.0.0
  - @objectstack/runtime@8.0.0
  - @objectstack/objectql@8.0.0
  - @objectstack/plugin-hono-server@8.0.0
  - @objectstack/plugin-auth@8.0.0
  - @objectstack/plugin-security@8.0.0
  - @objectstack/rest@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/driver-memory@8.0.0
  - @objectstack/plugin-org-scoping@8.0.0
  - @objectstack/service-i18n@8.0.0
  - @objectstack/types@8.0.0

## 7.9.0

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
  - @objectstack/objectql@7.9.0
  - @objectstack/rest@7.9.0
  - @objectstack/runtime@7.9.0
  - @objectstack/spec@7.9.0
  - @objectstack/core@7.9.0
  - @objectstack/types@7.9.0
  - @objectstack/driver-memory@7.9.0
  - @objectstack/plugin-auth@7.9.0
  - @objectstack/plugin-hono-server@7.9.0
  - @objectstack/plugin-org-scoping@7.9.0
  - @objectstack/plugin-security@7.9.0
  - @objectstack/service-i18n@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [6fc2678]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/objectql@7.8.0
  - @objectstack/rest@7.8.0
  - @objectstack/runtime@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/driver-memory@7.8.0
  - @objectstack/plugin-auth@7.8.0
  - @objectstack/plugin-hono-server@7.8.0
  - @objectstack/plugin-org-scoping@7.8.0
  - @objectstack/plugin-security@7.8.0
  - @objectstack/service-i18n@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/objectql@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/driver-memory@7.7.0
  - @objectstack/plugin-auth@7.7.0
  - @objectstack/plugin-hono-server@7.7.0
  - @objectstack/plugin-org-scoping@7.7.0
  - @objectstack/plugin-security@7.7.0
  - @objectstack/rest@7.7.0
  - @objectstack/runtime@7.7.0
  - @objectstack/service-i18n@7.7.0
  - @objectstack/types@7.7.0

## 7.6.0

### Patch Changes

- bb04824: fix(build): don't bundle lazily-imported optional drivers (fixes build break from #1524).

  After moving optional internal `@objectstack/*` peerDependencies off `peer` (to
  stop the changesets fixed-group major cascade), tsup no longer auto-externalized
  them and began bundling the lazily `await import()`-ed driver packages — pulling
  in their optional native clients (`mysql` / `oracledb` via knex) and failing the
  build. Fix: `service-datasource` externalizes `@objectstack/driver-*` in tsup
  (kept as devDeps for tests); `plugin-dev` moves its framework packages to
  `dependencies` (auto-externalized; it's a dev-only plugin). Full build green.

- 8c01eea: fix(dev): seed the dev admin in-process and fix the port-drift seed failure.

  `os dev` (and `pnpm dev:showcase`) seeded the admin over HTTP against a
  hard-coded `localhost:3000`. In dev, `serve` auto-shifts off a busy port, so
  the seed POST hit the wrong server (or nothing) and the running instance never
  got an admin. A second, divergent seed in `plugin-dev` inserted a
  credential-less `sys_user` row that could not log in.

  Consolidate to a single in-process seed:

  - **`@objectstack/plugin-auth`** — `maybeSeedDevAdmin()` runs on `kernel:ready`
    and creates `admin@objectos.ai` / `admin123` through better-auth's real
    `signUpEmail` pipeline (hashed credential), so the account is loginable;
    `plugin-security` then promotes it to platform admin. Empty-DB only
    (excludes the system service account), idempotent, never overwrites an
    existing account. Hard-gated to `NODE_ENV=development`; opt out with
    `OS_SEED_ADMIN=0`.
  - **`@objectstack/cli`** — removed the HTTP seed; `--seed-admin` now passes
    `OS_SEED_ADMIN[_EMAIL|_PASSWORD]` to the serve child. `serve` publishes its
    actually-bound port over IPC and to a `runtime.<env>.json` state file under
    `OS_HOME`.
  - **`@objectstack/plugin-dev`** — removed the credential-less raw insert;
    `seedAdminUser` maps to the unified `OS_SEED_ADMIN` toggle.

- 3377e38: fix(release): stop the fixed-group major cascade caused by internal `@objectstack/*` peerDependencies.

  These packages declared workspace peerDependencies on other framework packages
  in the changesets `fixed` group. Inside a fixed group, changesets rewrites those
  peer ranges on every release and treats a peer-range change as breaking → major,
  which cascaded to **all 69 packages → 8.0.0** on _any_ minor changeset. Required
  internal peers are now regular `dependencies`; optional ones move to
  `devDependencies` (kept for in-workspace tests, no longer a published peer edge).
  Releases now bump correctly (patch/minor) instead of a spurious major.

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8c01eea]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [8e539cc]
- Updated dependencies [b7a4f14]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/objectql@7.6.0
  - @objectstack/plugin-auth@7.6.0
  - @objectstack/runtime@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/driver-memory@7.6.0
  - @objectstack/plugin-hono-server@7.6.0
  - @objectstack/plugin-org-scoping@7.6.0
  - @objectstack/plugin-security@7.6.0
  - @objectstack/rest@7.6.0
  - @objectstack/service-i18n@7.6.0
  - @objectstack/types@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1

## 7.4.0

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/types@7.3.0

## 7.2.1

### Patch Changes

- 9096dfe: **`OS_` env-var prefix migration** (issue #1382).

  All ObjectStack-owned environment variables now use the `OS_` prefix. Legacy
  names still work for one release and emit a one-shot deprecation warning via
  the new `readEnvWithDeprecation()` helper in `@objectstack/types`.

  **Renamed (with legacy fallback):**

  | New                       | Legacy (deprecated)                                    |
  | :------------------------ | :----------------------------------------------------- |
  | `OS_AUTH_SECRET`          | `AUTH_SECRET`, `BETTER_AUTH_SECRET`                    |
  | `OS_AUTH_URL`             | `AUTH_BASE_URL`, `BETTER_AUTH_URL`, `OS_AUTH_BASE_URL` |
  | `OS_PORT`                 | `PORT`                                                 |
  | `OS_DATABASE_URL`         | `DATABASE_URL`                                         |
  | `OS_ROOT_DOMAIN`          | `ROOT_DOMAIN`                                          |
  | `OS_MULTI_ORG_ENABLED`    | `OS_MULTI_TENANT`                                      |
  | `OS_CORS_ENABLED`         | `CORS_ENABLED`                                         |
  | `OS_CORS_ORIGIN`          | `CORS_ORIGIN`                                          |
  | `OS_CORS_CREDENTIALS`     | `CORS_CREDENTIALS`                                     |
  | `OS_CORS_MAX_AGE`         | `CORS_MAX_AGE`                                         |
  | `OS_AI_MODEL`             | `AI_MODEL`                                             |
  | `OS_MCP_SERVER_ENABLED`   | `MCP_SERVER_ENABLED`                                   |
  | `OS_MCP_SERVER_NAME`      | `MCP_SERVER_NAME`                                      |
  | `OS_MCP_SERVER_TRANSPORT` | `MCP_SERVER_TRANSPORT`                                 |
  | `OS_NODE_ID`              | `OBJECTSTACK_NODE_ID`                                  |
  | `OS_METADATA_WRITABLE`    | `OBJECTSTACK_METADATA_WRITABLE`                        |
  | `OS_DEV_CRYPTO_KEY`       | `OBJECTSTACK_DEV_CRYPTO_KEY`                           |
  | `OS_HOME`                 | `OBJECTSTACK_HOME`                                     |

  **Migration:** rename in your `.env`. Legacy names continue to work this
  release and will be removed in a future major. Industry-standard names
  (`NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth
  `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`,
  `AI_GATEWAY_*`, `SMTP_*`) are NOT renamed.

- Updated dependencies [9096dfe]
  - @objectstack/types@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- 3a630b6: **Split organization-scoping from `@objectstack/plugin-security` into a new `@objectstack/plugin-org-scoping` package.**

  Per ADR-0002, "tenant" in ObjectStack means _physical_ isolation (one Environment = one database, handled by `@objectstack/driver-turso`'s multi-tenant router). The row-level `organization_id` scoping that previously lived inside SecurityPlugin is a different concept — _logical_ scoping inside a single DB — and now ships as its own plugin.

  ### Breaking changes — `@objectstack/plugin-security`

  - Removed the `multiTenant` constructor option. SecurityPlugin no longer touches `organization_id` on insert and no longer registers the `sys_organization` post-create seed pipeline.
  - Wildcard `current_user.organization_id` RLS policies in the default permission sets are now stripped UNLESS the new `org-scoping` service is registered (i.e. unless `OrgScopingPlugin` is also installed).
  - Removed export `cloneTenantSeedData` (now exposed as `cloneOrgSeedData` from `@objectstack/plugin-org-scoping`).
  - `bootstrapPlatformAdmin()` no longer accepts a `multiTenant` flag and no longer auto-creates a default organization — that behavior moved to `ensureDefaultOrganization()` in the new plugin.

  ### Migration

  Single-tenant deployments — no action required.

  Multi-tenant deployments (previously `new SecurityPlugin({ multiTenant: true })`):

  ```diff
  + import { OrgScopingPlugin } from '@objectstack/plugin-org-scoping';
    import { SecurityPlugin } from '@objectstack/plugin-security';

  + await kernel.use(new OrgScopingPlugin());     // MUST be BEFORE SecurityPlugin
  - await kernel.use(new SecurityPlugin({ multiTenant: true }));
  + await kernel.use(new SecurityPlugin());
  ```

  The runtime's `OS_MULTI_TENANT` env switch — read by `@objectstack/runtime/cloud/ArtifactKernelFactory`, `@objectstack/plugin-dev`, and the `objectstack` CLI's `serve` / `dev` / `start` commands — automatically registers `OrgScopingPlugin` when set to `true`, so projects driven by the CLI need no code changes.

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [3a630b6]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/plugin-auth@7.0.0
  - @objectstack/runtime@7.0.0
  - @objectstack/plugin-security@7.0.0
  - @objectstack/plugin-org-scoping@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/objectql@7.0.0
  - @objectstack/driver-memory@7.0.0
  - @objectstack/plugin-hono-server@7.0.0
  - @objectstack/rest@7.0.0
  - @objectstack/service-i18n@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/runtime@6.0.0
  - @objectstack/rest@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/objectql@6.0.0
  - @objectstack/driver-memory@6.0.0
  - @objectstack/plugin-auth@6.0.0
  - @objectstack/plugin-hono-server@6.0.0
  - @objectstack/plugin-security@6.0.0
  - @objectstack/service-i18n@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [5e9dcb4]
- Updated dependencies [f139a24]
- Updated dependencies [4eb9f8c]
- Updated dependencies [2f7e42a]
- Updated dependencies [602cce7]
- Updated dependencies [1e625b8]
- Updated dependencies [6ee42b8]
- Updated dependencies [888a5c1]
- Updated dependencies [5cfdc85]
- Updated dependencies [09f005a]
- Updated dependencies [7825394]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
- Updated dependencies [2f9073a]
  - @objectstack/objectql@5.0.0
  - @objectstack/runtime@5.0.0
  - @objectstack/rest@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/plugin-auth@5.0.0
  - @objectstack/plugin-security@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/driver-memory@5.0.0
  - @objectstack/plugin-hono-server@5.0.0
  - @objectstack/service-i18n@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4
  - @objectstack/objectql@4.0.4
  - @objectstack/driver-memory@4.0.4
  - @objectstack/plugin-auth@4.0.4
  - @objectstack/plugin-hono-server@4.0.4
  - @objectstack/plugin-security@4.0.4
  - @objectstack/plugin-setup@4.0.4
  - @objectstack/rest@4.0.4
  - @objectstack/runtime@4.0.4
  - @objectstack/service-i18n@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/plugin-auth@4.0.3
- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3
- @objectstack/objectql@4.0.3
- @objectstack/runtime@4.0.3
- @objectstack/rest@4.0.3
- @objectstack/driver-memory@4.0.3
- @objectstack/plugin-hono-server@4.0.3
- @objectstack/plugin-security@4.0.3
- @objectstack/plugin-setup@4.0.3
- @objectstack/service-i18n@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/plugin-hono-server@4.0.2
  - @objectstack/driver-memory@4.0.2
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2
  - @objectstack/objectql@4.0.2
  - @objectstack/plugin-auth@4.0.2
  - @objectstack/plugin-security@4.0.2
  - @objectstack/plugin-setup@4.0.2
  - @objectstack/rest@4.0.2
  - @objectstack/runtime@4.0.2
  - @objectstack/service-i18n@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/runtime@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/objectql@4.0.0
  - @objectstack/plugin-auth@4.0.0
  - @objectstack/driver-memory@4.0.0
  - @objectstack/plugin-hono-server@4.0.0
  - @objectstack/plugin-security@4.0.0
  - @objectstack/plugin-setup@4.0.0
  - @objectstack/rest@4.0.0
  - @objectstack/service-i18n@4.0.0

## 3.3.1

### Patch Changes

- Updated dependencies [772dc3f]
  - @objectstack/service-i18n@3.3.1
  - @objectstack/spec@3.3.1
  - @objectstack/core@3.3.1
  - @objectstack/objectql@3.3.1
  - @objectstack/runtime@3.3.1
  - @objectstack/rest@3.3.1
  - @objectstack/driver-memory@3.3.1
  - @objectstack/plugin-auth@3.3.1
  - @objectstack/plugin-hono-server@3.3.1
  - @objectstack/plugin-security@3.3.1

## 3.3.0

### Patch Changes

- Updated dependencies [814a6c4]
  - @objectstack/plugin-auth@3.3.0
  - @objectstack/spec@3.3.0
  - @objectstack/core@3.3.0
  - @objectstack/objectql@3.3.0
  - @objectstack/runtime@3.3.0
  - @objectstack/rest@3.3.0
  - @objectstack/driver-memory@3.3.0
  - @objectstack/plugin-hono-server@3.3.0
  - @objectstack/plugin-security@3.3.0
  - @objectstack/service-i18n@3.3.0

## 3.2.9

### Patch Changes

- Updated dependencies [0bc7b0c]
- Updated dependencies [c3065dd]
  - @objectstack/plugin-hono-server@3.2.9
  - @objectstack/objectql@3.2.9
  - @objectstack/plugin-auth@3.2.9
  - @objectstack/spec@3.2.9
  - @objectstack/core@3.2.9
  - @objectstack/runtime@3.2.9
  - @objectstack/rest@3.2.9
  - @objectstack/driver-memory@3.2.9
  - @objectstack/plugin-security@3.2.9
  - @objectstack/service-i18n@3.2.9

## 3.2.8

### Patch Changes

- Updated dependencies [1fe5612]
  - @objectstack/plugin-auth@3.2.8
  - @objectstack/spec@3.2.8
  - @objectstack/core@3.2.8
  - @objectstack/objectql@3.2.8
  - @objectstack/runtime@3.2.8
  - @objectstack/rest@3.2.8
  - @objectstack/driver-memory@3.2.8
  - @objectstack/plugin-hono-server@3.2.8
  - @objectstack/plugin-security@3.2.8
  - @objectstack/service-i18n@3.2.8

## 3.2.7

### Patch Changes

- Updated dependencies [35a1ebb]
  - @objectstack/plugin-auth@3.2.7
  - @objectstack/spec@3.2.7
  - @objectstack/core@3.2.7
  - @objectstack/objectql@3.2.7
  - @objectstack/runtime@3.2.7
  - @objectstack/rest@3.2.7
  - @objectstack/driver-memory@3.2.7
  - @objectstack/plugin-hono-server@3.2.7
  - @objectstack/plugin-security@3.2.7
  - @objectstack/service-i18n@3.2.7

## 3.2.6

### Patch Changes

- Updated dependencies [83151bc]
  - @objectstack/service-i18n@3.2.6
  - @objectstack/spec@3.2.6
  - @objectstack/core@3.2.6
  - @objectstack/objectql@3.2.6
  - @objectstack/runtime@3.2.6
  - @objectstack/rest@3.2.6
  - @objectstack/driver-memory@3.2.6
  - @objectstack/plugin-auth@3.2.6
  - @objectstack/plugin-hono-server@3.2.6
  - @objectstack/plugin-security@3.2.6

## 3.2.5

### Patch Changes

- Updated dependencies [e854538]
  - @objectstack/plugin-auth@3.2.5
  - @objectstack/spec@3.2.5
  - @objectstack/core@3.2.5
  - @objectstack/objectql@3.2.5
  - @objectstack/runtime@3.2.5
  - @objectstack/rest@3.2.5
  - @objectstack/driver-memory@3.2.5
  - @objectstack/plugin-hono-server@3.2.5
  - @objectstack/plugin-security@3.2.5

## 3.2.4

### Patch Changes

- Updated dependencies [f490991]
  - @objectstack/plugin-auth@3.2.4
  - @objectstack/spec@3.2.4
  - @objectstack/core@3.2.4
  - @objectstack/objectql@3.2.4
  - @objectstack/runtime@3.2.4
  - @objectstack/rest@3.2.4
  - @objectstack/driver-memory@3.2.4
  - @objectstack/plugin-hono-server@3.2.4
  - @objectstack/plugin-security@3.2.4

## 3.2.3

### Patch Changes

- Updated dependencies [0b1d7c9]
  - @objectstack/plugin-auth@3.2.3
  - @objectstack/spec@3.2.3
  - @objectstack/core@3.2.3
  - @objectstack/objectql@3.2.3
  - @objectstack/runtime@3.2.3
  - @objectstack/rest@3.2.3
  - @objectstack/driver-memory@3.2.3
  - @objectstack/plugin-hono-server@3.2.3
  - @objectstack/plugin-security@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [cfaabbb]
- Updated dependencies [46defbb]
  - @objectstack/plugin-auth@3.2.2
  - @objectstack/spec@3.2.2
  - @objectstack/driver-memory@3.2.2
  - @objectstack/core@3.2.2
  - @objectstack/objectql@3.2.2
  - @objectstack/plugin-hono-server@3.2.2
  - @objectstack/plugin-security@3.2.2
  - @objectstack/rest@3.2.2
  - @objectstack/runtime@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1
  - @objectstack/objectql@3.2.1
  - @objectstack/driver-memory@3.2.1
  - @objectstack/plugin-auth@3.2.1
  - @objectstack/plugin-hono-server@3.2.1
  - @objectstack/plugin-security@3.2.1
  - @objectstack/rest@3.2.1
  - @objectstack/runtime@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0
  - @objectstack/objectql@3.2.0
  - @objectstack/driver-memory@3.2.0
  - @objectstack/plugin-auth@3.2.0
  - @objectstack/plugin-hono-server@3.2.0
  - @objectstack/plugin-security@3.2.0
  - @objectstack/rest@3.2.0
  - @objectstack/runtime@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1
  - @objectstack/objectql@3.1.1
  - @objectstack/driver-memory@3.1.1
  - @objectstack/plugin-auth@3.1.1
  - @objectstack/plugin-hono-server@3.1.1
  - @objectstack/plugin-security@3.1.1
  - @objectstack/rest@3.1.1
  - @objectstack/runtime@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0
  - @objectstack/objectql@3.1.0
  - @objectstack/driver-memory@3.1.0
  - @objectstack/plugin-auth@3.1.0
  - @objectstack/plugin-hono-server@3.1.0
  - @objectstack/plugin-security@3.1.0
  - @objectstack/rest@3.1.0
  - @objectstack/runtime@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11
  - @objectstack/objectql@3.0.11
  - @objectstack/driver-memory@3.0.11
  - @objectstack/plugin-auth@3.0.11
  - @objectstack/plugin-hono-server@3.0.11
  - @objectstack/plugin-security@3.0.11
  - @objectstack/rest@3.0.11
  - @objectstack/runtime@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10
  - @objectstack/objectql@3.0.10
  - @objectstack/driver-memory@3.0.10
  - @objectstack/plugin-auth@3.0.10
  - @objectstack/plugin-hono-server@3.0.10
  - @objectstack/plugin-security@3.0.10
  - @objectstack/rest@3.0.10
  - @objectstack/runtime@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9
  - @objectstack/objectql@3.0.9
  - @objectstack/driver-memory@3.0.9
  - @objectstack/plugin-auth@3.0.9
  - @objectstack/plugin-hono-server@3.0.9
  - @objectstack/plugin-security@3.0.9
  - @objectstack/rest@3.0.9
  - @objectstack/runtime@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
  - @objectstack/objectql@3.0.8
  - @objectstack/driver-memory@3.0.8
  - @objectstack/plugin-auth@3.0.8
  - @objectstack/plugin-hono-server@3.0.8
  - @objectstack/plugin-security@3.0.8
  - @objectstack/rest@3.0.8
  - @objectstack/runtime@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7
  - @objectstack/objectql@3.0.7
  - @objectstack/driver-memory@3.0.7
  - @objectstack/plugin-auth@3.0.7
  - @objectstack/plugin-hono-server@3.0.7
  - @objectstack/plugin-security@3.0.7
  - @objectstack/rest@3.0.7
  - @objectstack/runtime@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6
  - @objectstack/objectql@3.0.6
  - @objectstack/driver-memory@3.0.6
  - @objectstack/plugin-auth@3.0.6
  - @objectstack/plugin-hono-server@3.0.6
  - @objectstack/plugin-security@3.0.6
  - @objectstack/rest@3.0.6
  - @objectstack/runtime@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5
  - @objectstack/objectql@3.0.5
  - @objectstack/driver-memory@3.0.5
  - @objectstack/plugin-auth@3.0.5
  - @objectstack/plugin-hono-server@3.0.5
  - @objectstack/plugin-security@3.0.5
  - @objectstack/rest@3.0.5
  - @objectstack/runtime@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
- Updated dependencies [437b0b8]
  - @objectstack/spec@3.0.4
  - @objectstack/objectql@3.0.4
  - @objectstack/core@3.0.4
  - @objectstack/driver-memory@3.0.4
  - @objectstack/plugin-auth@3.0.4
  - @objectstack/plugin-hono-server@3.0.4
  - @objectstack/plugin-security@3.0.4
  - @objectstack/rest@3.0.4
  - @objectstack/runtime@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3
  - @objectstack/objectql@3.0.3
  - @objectstack/runtime@3.0.3
  - @objectstack/rest@3.0.3
  - @objectstack/driver-memory@3.0.3
  - @objectstack/plugin-auth@3.0.3
  - @objectstack/plugin-hono-server@3.0.3
  - @objectstack/plugin-security@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2
  - @objectstack/objectql@3.0.2
  - @objectstack/driver-memory@3.0.2
  - @objectstack/plugin-auth@3.0.2
  - @objectstack/plugin-hono-server@3.0.2
  - @objectstack/plugin-security@3.0.2
  - @objectstack/rest@3.0.2
  - @objectstack/runtime@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1
  - @objectstack/objectql@3.0.1
  - @objectstack/driver-memory@3.0.1
  - @objectstack/plugin-auth@3.0.1
  - @objectstack/plugin-hono-server@3.0.1
  - @objectstack/plugin-security@3.0.1
  - @objectstack/rest@3.0.1
  - @objectstack/runtime@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0
  - @objectstack/objectql@3.0.0
  - @objectstack/runtime@3.0.0
  - @objectstack/rest@3.0.0
  - @objectstack/driver-memory@3.0.0
  - @objectstack/plugin-auth@3.0.0
  - @objectstack/plugin-hono-server@3.0.0
  - @objectstack/plugin-security@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7
  - @objectstack/objectql@2.0.7
  - @objectstack/driver-memory@2.0.7
  - @objectstack/plugin-auth@2.0.7
  - @objectstack/plugin-hono-server@2.0.7
  - @objectstack/plugin-security@2.0.7
  - @objectstack/rest@2.0.7
  - @objectstack/runtime@2.0.7
