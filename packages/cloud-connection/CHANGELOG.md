# @objectstack/cloud-connection

## 17.0.0-rc.0

### Patch Changes

- 402f534: fix(objectql): bridge late-registered manifest objects into the metadata service

  Marketplace-installed template packages register through the `manifest`
  service on `kernel:ready` (install) or later (HTTP install), but the one-shot
  SchemaRegistry→metadata bridge runs once during `ObjectQLPlugin.start()` —
  so their objects only ever reached the ObjectQL registry. Every
  IMetadataService consumer (AI `describe_object`, Studio object lists,
  `metadata.listObjects`) missed them; only the seed loader had grown an
  engine-side fallback (#3422).

  The manifest service's `register` now bridges the manifest's own objects into
  the metadata service after registering them with the engine, resolving the
  service at call time and mirroring the startup bridge's contract:
  `register('object', name, obj, { notify: false })` (#3112), skip entries it
  did not bridge itself, refresh its own copy on same-package re-install (hot
  upgrade). Armed only after `start()` has run the one-shot bridge, and never
  on project kernels — boot-time behavior is unchanged. `register` now returns
  a promise; the marketplace install/rehydrate paths await it so metadata reads
  right after an install are deterministic.

- 1c8bf4f: fix(marketplace): heal missing sample data when rehydrating installed packages onto a new database

  The install ledger (`.objectstack/installed-packages/`) is anchored to the
  project directory while the database can be swapped out from under it —
  `os dev --fresh`, a deleted `dev.db`, a `--database` switch. Rehydrate
  deliberately never re-seeds (existing rows must not be re-upserted over user
  edits on every boot), which left a rehydrated marketplace package PERMANENTLY
  empty on a new database: app in the switcher, tables created, zero rows — the
  "HotCRM installed but every KPI is 0 / Sales Pipeline all-empty" state.

  Rehydrate now runs the bundled seed datasets iff the manifest actually bundles
  them, the user never explicitly purged them, the runtime is single-tenant
  (multi-tenant seeding stays owned by the per-org replay), and EVERY seeded
  object is empty — one surviving row anywhere means the data is still there and
  nothing is touched, so the heal is idempotent across restarts and can never
  revert user edits.

  Also fixed along the way: a purge now stamps `sampleDataPurged` on the ledger
  entry (so healed restarts respect the deliberate empty baseline), and install
  marks `withSampleData: true` when the seed run reports all rows _skipped_
  (already present, e.g. a reinstall over live demo data) instead of leaving the
  flag false over a seeded database.

- 810a3a2: fix(runtime,cloud-connection): multi-tenant seed replay covers every source, not just the first (#3453)

  In multi-tenant deployments (enterprise `@objectstack/organizations`) a brand-new org
  gets its own private copy of demo data by replaying the kernel's `seed-datasets` list
  on the `sys_organization` insert. That list is meant to hold the union of every seed
  source — every config-declared app AND every marketplace package — but two framework
  traps (the same pair #3444 fixed for seed-summary) shrank it to just the first source:

  - The standard `PluginContext` exposes `getService`/`registerService` but has NO
    `.kernel` handle, so `(ctx as any).kernel?.getService('seed-datasets')` always read
    `undefined`. Each source then saw "nothing registered" and overwrote the list with
    only its own datasets instead of extending it.
  - `registerService` throws on a duplicate name, so the second source's re-register was
    swallowed by the surrounding try/catch — its datasets (and, for a config app, its
    replayer) silently lost.

  Net effect: with two config apps, or a config app plus marketplace packages, a new org
  replayed only the first app's seeds.

  The fix mirrors #3444's seed-summary hardening: `seed-datasets` is now a single shared
  array, registered once and mutated in place by every source through a new
  `mergeSeedDatasets` helper that reads via the context's own resolver first. AppPlugin's
  per-org replayer reads that live list at invoke time instead of a captured snapshot, so
  it replays the full union — including datasets merged after its closure was built — and
  the replayer itself is registered once and reused by later config apps.

  Covered by seam-level unit tests (accumulation across app + marketplace sources; the
  replayer reads the live union). True multi-tenant end-to-end coverage requires the
  enterprise `@objectstack/organizations` plugin, which lives in the cloud repo.

- d60968c: Surface marketplace rehydrate/heal seed outcomes in the `os dev` / `os serve` boot banner (#3430), extending the config-app Seeds line from #3415.

  The seed pipeline's most useful result lines are all `logger.info`, but `os dev` forwards a default `warn` level and the serve boot-quiet window swallows stdout — so "marketplace package rehydrated onto a fresh DB with 0 rows", a fresh-DB self-heal, and row-level seed failures were all invisible unless you queried the database directly.

  The `seed-summary` kernel service is now a per-source list. AppPlugin (config apps) and the marketplace rehydrate/heal path each contribute a labelled entry, and the banner prints one combined line that ignores the log level:

  ```
  Seeds:   showcase 162 rows · hotcrm(marketplace) 157 ok / 5 errors ⚠
  ```

  Fresh-DB heals are marked `(healed on fresh db)`; a marketplace package that installed with seed datasets but landed 0 rows, and any run that dropped records, escalate to a yellow `⚠` line instead of passing silently.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [6877e9a]
- Updated dependencies [0bab8bb]
- Updated dependencies [840ee4b]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [3c8cfd1]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [db02d47]
- Updated dependencies [d3f2ff6]
- Updated dependencies [b7550d6]
- Updated dependencies [0164f40]
- Updated dependencies [e295ad1]
- Updated dependencies [0bfdf46]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [19e3e6e]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [cbedd62]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [7180ed5]
- Updated dependencies [083c414]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [67452d1]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [8e08bc3]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [3d5f726]
- Updated dependencies [70a1ce1]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [48d5a1c]
- Updated dependencies [3216344]
- Updated dependencies [f5bfac8]
- Updated dependencies [6163393]
- Updated dependencies [688e9df]
- Updated dependencies [8f124a7]
- Updated dependencies [21ca1d5]
- Updated dependencies [03b11e8]
- Updated dependencies [8891f93]
- Updated dependencies [d729a31]
- Updated dependencies [cb8322e]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [810a3a2]
- Updated dependencies [abceb0d]
- Updated dependencies [9981c1d]
- Updated dependencies [d60968c]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [e231abb]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/runtime@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
- Updated dependencies [818e6a3]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/runtime@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [fdc244e]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [ee0a499]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [a2d6555]
- Updated dependencies [3a6310c]
- Updated dependencies [32899e6]
- Updated dependencies [515f11a]
- Updated dependencies [4174a07]
- Updated dependencies [ce468c8]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/runtime@16.0.0
  - @objectstack/spec@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/types@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [ee0a499]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/runtime@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [fdc244e]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [a2d6555]
- Updated dependencies [3a6310c]
- Updated dependencies [32899e6]
- Updated dependencies [515f11a]
- Updated dependencies [4174a07]
- Updated dependencies [ce468c8]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/runtime@16.0.0-rc.0
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/runtime@15.1.1
- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1

## 15.1.0

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/runtime@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/runtime@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/runtime@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/runtime@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/runtime@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [5f43f88]
- Updated dependencies [261aff5]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/runtime@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/runtime@14.4.0
  - @objectstack/types@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/runtime@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/runtime@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/runtime@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [57b8fe0]
- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [bc26360]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [bd39dc5]
  - @objectstack/runtime@14.0.0
  - @objectstack/spec@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/types@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/runtime@13.0.0
  - @objectstack/types@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [b5a87eb]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/runtime@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/runtime@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/runtime@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/runtime@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/types@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/runtime@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [497bda8]
- Updated dependencies [93e6d02]
  - @objectstack/runtime@12.1.0
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [9693a36]
- Updated dependencies [7c09621]
- Updated dependencies [2d567cb]
- Updated dependencies [e3498fb]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/runtime@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/runtime@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [852bc8e]
- Updated dependencies [d3595d9]
  - @objectstack/runtime@11.9.0
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/runtime@11.8.0
- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/types@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/runtime@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/runtime@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/runtime@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/runtime@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/runtime@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/runtime@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [e011d42]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
- Updated dependencies [7087cfe]
- Updated dependencies [69ae136]
  - @objectstack/core@11.1.0
  - @objectstack/runtime@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [4d99a5c]
- Updated dependencies [ab5718a]
- Updated dependencies [61d441f]
- Updated dependencies [c224e18]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
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
  - @objectstack/runtime@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- Updated dependencies [8cf4f7c]
- Updated dependencies [f2063f3]
  - @objectstack/runtime@10.3.0
  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0
  - @objectstack/types@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/runtime@10.2.0
  - @objectstack/types@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
- Updated dependencies [94d2161]
  - @objectstack/spec@10.1.0
  - @objectstack/runtime@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/types@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [47d978a]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/runtime@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/types@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/runtime@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/types@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
  - @objectstack/spec@9.10.0
  - @objectstack/runtime@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1
- @objectstack/runtime@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [83fd318]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/runtime@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/runtime@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/runtime@9.7.0
- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/types@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/runtime@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/runtime@9.5.1
  - @objectstack/types@9.5.1

## 9.5.0

### Minor Changes

- 08a11f7: RuntimeConfigPlugin: make the per-request `features` seam open-ended and plan-agnostic (open-core boundary, cloud ADR-0012).

  The framework now transports an opaque feature map: a host's policy hook may return ANY boolean feature keys and they pass through to the SPA verbatim — the framework no longer enumerates a distribution's commercial feature catalog. Adds `resolveFeatures` (plan-agnostic) and `RuntimeFeatureOverrides`; deprecates `resolvePlanFeatures` / `RuntimeConfigPlanFeatures` (still honoured for backward compatibility).

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/runtime@9.5.0
  - @objectstack/types@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/runtime@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Minor Changes

- 998c4e4: New package: `@objectstack/cloud-connection` — the open runtime-side client for an ObjectStack cloud control plane (ADR-0008 Phase 2). Carries the marketplace browse proxy, install-local, the `/api/v1/cloud-connection/*` surface (status, RFC 8628 device-code bind, org catalog, installed views, control-plane install), and `RuntimeConfigPlugin` with a `resolvePlanFeatures` policy seam (plan entitlements stay host-side). Canonical sources move here from the cloud distribution's `@objectstack/objectos-runtime`, which now re-exports them.
- b8e4232: Self-hosted binding becomes consumable (cloud ADR-0008 consumption side): `ConnectionCredentialStore` persists the one-time `oscc_` runtime bearer the bind flow returns (0600, env-local); all control-plane forwards fall back to it when no `OS_CLOUD_API_KEY` is set; new `POST /cloud-connection/unbind` revokes + clears; install-local's catalog fetch presents the credential so org/private packages resolve. The binding Setup UI ships WITH the plugin as SDUI metadata (`cloud_connection_settings` page + Setup-nav contribution, ADR-0029 K2) — the console only registers the `cloud-connection:panel` widget.
- 8950204: The Installed Apps page ships as metadata with `MarketplaceInstallLocalPlugin` (cloud ADR-0009 P2a): `marketplace_installed` page (page:header + `marketplace:installed-list` widget) and the Setup nav entry switches to `type:'page'`.
- 17ffc74: `LocalManifestSource` — the install-local disk ledger promoted to a first-class, exported desired-state owner for self-hosted runtimes (cloud ADR-0007 step ⑤). `MarketplaceInstallLocalPlugin` now delegates all ledger reads/writes to it; behavior unchanged. Also exports `InstalledManifestEntry` and `DEFAULT_INSTALLED_PACKAGES_DIR`.
- c802327: Marketplace Setup navigation is now plugin-owned (cloud ADR-0009): `MarketplaceProxyPlugin` carries the "Browse Marketplace" entry and `MarketplaceInstallLocalPlugin` carries "Installed Apps" — no plugin mounted (e.g. `OS_CLOUD_URL=off`), no entry, no dead page. The two entries are removed from `@objectstack/platform-objects`' setup-nav contributions (ADR-0029 K2 ownership handoff).
- 48051ff: Runtime-identity bind v2 (cloud ADR runtime-identity-binding): a self-hosted runtime binds like a device — no environment id required. `bind/start`/`bind/poll` work environment-less in `singleEnvironment` mode; the bind call carries a registration claim (`hostname`, `runtime_version`, and the stored `runtime_id` on re-bind) and the store persists the cloud-minted `runtime_id` (durable identity, stable across token rotations). `status` reports `runtimeId` and treats "no env id" as unbound rather than 404; `unbind` revokes bearer-first with no environment requirement; `org-packages` forwards bearer-only when no environment is configured (the connection carries the org); `installation`/`installed` degrade gracefully for registration-only runtimes. `StoredConnectionCredential.environmentId` is now optional (`runtimeId` added).

### Patch Changes

- 9fea621: bind/start appends device context (`runtime_name`, `runtime_version`) to the device-flow verification URLs so the cloud approval page can show WHAT is being authorized (ADR runtime-identity-binding §2.3). Display-only informed-consent context; the approval page pairs it with an "only approve if you started this" warning.
- 3786f15: install-local accepts compiled stack bundles: a published version payload (`dist/objectstack.json`) nests its meta under `.manifest` while ObjectQL's registerApp expects the flat app shape — every install of a published compiled bundle failed with "Invalid manifest payload". The handler now flattens the bundle shape (both the cloud-fetch and inline/file-import paths).
- 9b4e870: `resolveEnvironmentId` no longer presents the CLI's local-dev sentinel ids (`env_local` / `proj_local`) to the control plane as cloud environment ids — they identify the local kernel only. A single-environment runtime started via `objectstack dev` now reads as cleanly unbound and binds environment-less (ADR runtime-identity-binding), instead of 404-ing the bind against a non-existent cloud environment.
- d01c427: Unbind keeps an identity residual: the credential is cleared (and revoked cloud-side first) but `runtimeId` survives in the store, so a later re-bind to the same org claims — and revives — the same registration instead of minting a new device per disconnect cycle. `ConnectionCredentialStore.read()` accepts token-less residual records.
- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/runtime@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/types@9.3.0
