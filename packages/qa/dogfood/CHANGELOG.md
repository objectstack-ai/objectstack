# @objectstack/dogfood

## 0.0.41

### Patch Changes

- 2ce1eb4: docs(qa): narrow the ADR-0056 D10 authz conformance matrix's advertised completeness claim to what its ratchet actually checks (#8711)
  
  The matrix header and its companion test's header previously read as though
  a new declared-but-unenforced authorization primitive would "break CI." It
  would not, for most of the ledger: the completeness `discover()` ratchets is
  over a **curated table of HTTP/transport entry points** (15 probes over 11
  named source files), not over primitives. A primitive enforced by a predicate
  inside an existing resolver — the `sys_permission_set.active` /
  `sys_position.active` rows added in #8812 are the normal case, not an
  exception — adds no entry point, so it can be neither UNCLASSIFIED nor STALE.
  
  Both headers now say so explicitly, carrying the measured numbers so the
  narrowed claim is load-bearing rather than vague: 43 of the matrix's 50 rows
  carry no `covers` key at all, 37 of the 43 `enforced` rows are exactly that
  in-resolver shape, and — preserved, because it is real — 5 of the file's 9
  `covers` keys are gate-pins that vanish (and fail CI) when the guard call
  they name is deleted. Prose and comments only; nothing about the ratchet's
  checking behaviour, the `discover()` table, or any row changes. Maintainer
  ruling on #8711 (Option A): narrow the claim, do not build a
  primitive-discovery ratchet (measured unachievable in general form).
- 3c4c2ff: test(qa): a wired realtime transport can no longer be signed off by the row that records the absence of authorization (#9083)
  
  The ADR-0056 D10 authz conformance matrix carries a tripwire note promising
  that wiring an end-user realtime transport reds CI "until this row is upgraded
  with the enforcement site." The gate did not hold that out. `checkLedger`
  requires an `enforcement` site only when `state === 'enforced'`, while a row's
  `covers` keys classify a discovered surface **regardless of state** — so the
  shortest path from red back to green was to append the tripwire key to the
  `experimental` `realtime-delivery-authz` row, whose own summary records that
  realtime fan-out has **NO** per-recipient authorization.
  
  Measured on `origin/main` before the fix, both legs reproduced from the filing:
  wiring `new EventSource('/api/v1/stream')` into `packages/client/src/realtime-api.ts`
  fails 2 of 15 cases as `UNCLASSIFIED surface — … realtime:client/realtime-api.ts:transport(TRANSPORT-WIRED)`;
  appending that one key to the experimental row — with the transport still wired
  and zero authorization written — returns 15/15 green. The `removed` state was
  measured to admit the identical exit, so the rule keys on **not `enforced`**
  rather than on `experimental`.
  
  `checkTransportWiredAdmission` in `authz-conformance.test.ts` now refuses a
  `TRANSPORT-WIRED` key covered by any row that is not `enforced`, and
  `checkLedger`'s existing enforced-has-site invariant supplies the other half —
  the two compose into the promise the note makes, so flipping a row's state
  without writing the site is refused as well. The rule lives beside the probe
  table rather than in the shared ADR-0060 `checkLedger` helper on purpose:
  `TRANSPORT-WIRED` is this ledger's own vocabulary, and five other conformance
  ledgers share that helper without having transport tripwires. Tripwire keys are
  now minted through one `tripwireKey()` helper so the marker cannot drift out of
  the rule's sight (the keys themselves are byte-identical to before), and every
  assertion in the file drives the composed gate instead of `checkLedger`.
  
  The matrix note, the `covers` field TSDoc and both file headers were corrected
  to describe the gate that actually ships — the declared-≠-enforced defect here
  was in the *note*, so leaving it in place would only have moved the
  discrepancy. Six cases pin the new rule, including both reverse-verification
  legs and a positive control proving an `enforced` row naming its site still
  admits the key; each refusal case also asserts that bare `checkLedger` accepts
  the same ledger, so none can pass for an unrelated reason. Gate behaviour only
  — no runtime, spec or product surface changes, and no matrix row changed state.
- 0bb8dbd: docs(qa): record `dispatcher-plugin.ts` as deliberately outside the #2992 transport tripwire set, with the reason (#9410)
  
  `packages/runtime/src/dispatcher-plugin.ts` has both properties that make a file
  a plausible landing site for a realtime transport, and neither the conformance
  test nor the protocol page said anything about it. It **mounts routes** —
  `/actions`, `/automation` and `/packages`, the registration path separate from
  the `@objectstack/rest` one — and it **already writes SSE**: two
  `text/event-stream` sites with `no-cache` and `keep-alive`, working plumbing an
  agent could extend without writing any new transport mechanics. None of the five
  `#2992` / ADR-0096 D4 transport tripwires watch it, so a subscribe/fan-out
  transport wired there mints no `TRANSPORT-WIRED` key, produces no UNCLASSIFIED
  surface and reds no build. The protocol page stated the general limitation ("a
  transport wired outside the watched files produces no key and no failure")
  without naming the specific already-SSE-capable file sitting inside it.
  
  **This change is a recording. It changes no behaviour**: no probe is added, no
  key is minted, and no matrix row is written for the two existing sites.
  
  The reason is recorded because it is the part a reader cannot re-derive cheaply.
  Those two `text/event-stream` sites are **per-request AI response streaming, not
  realtime subscription fan-out**: each drains one `AsyncIterable` that the route
  handler itself returned into that same request's response body and then calls
  `res.end()` — the second site's own source comment names its producer as the AI
  routes. No subscriber is registered, no event is delivered to a *set* of
  recipients, and the file carries no upgrade handler, no subscribe registration
  and no realtime-service call. Watching it with the existing mechanics pattern
  would therefore mint a key on day one for a surface that is not the hazard
  `#2992` is about, leaving only two exits: classify two non-realtime sites in the
  matrix vocabulary, or weaken the pattern. Neither is acceptable, so the file
  stays out and the boundary is written down instead.
  
  It is written in the two places a reader actually lands. In
  `authz-conformance.test.ts` the note closes the tripwire probe list, so a reader
  who has just finished enumerating the watched set reads the set's boundary in
  the same breath — beside, and explicitly distinguished from, the pre-existing
  `#5519` mention of the same file, which is about anonymous gates on the mounted
  routes and is a different point. In `realtime-protocol.mdx` it extends the
  identity-admission callout at the exact sentence that states the general
  limitation.
  
  The exclusion is drawn on **fan-out, not on the SSE content type**, and both
  records say so: wiring an upgrade handler, a subscribe registration or a
  realtime-service call into that file puts it back inside the hazard while the
  recorded boundary still claims otherwise. Promoting it into the tripwire
  population with such a fan-out-specific marker is written into #8347's
  acceptance as a precondition of the WebSocket/SSE transport landing, so the
  design effort is spent when the hazard becomes real rather than now.
- 2d0af57: fix(tests): give two default-vitest-timeout cases real margin instead of a bare default (#9311)
  
  Two cases only passed `pnpm test` when they were not competing for CPU — the
  same defect class as the already-closed precedents #3662, #4186, #4485,
  #5421, #6329: a test running under vitest's **default** `testTimeout` /
  `hookTimeout` with no margin for anything heavier than an idle box.
  
  **`packages/types/src/node.test.ts`** — `"falls back to the importing
  package's own resolution when the host does not declare"` is the only case
  in the file that performs a real dynamic `import()` of `@objectstack/spec` (a
  multi-megabyte package); every sibling in the same `describe` block resolves
  a small on-disk fixture or fails fast, all under 10ms. Measured on this box:
  ~0.9-1.1s unloaded, already observed failing at 5061ms against the 5000ms
  default under nothing heavier than `turbo run test --concurrency=2` (#9311's
  own isolation runs). Gave that one case an explicit 30s `testTimeout` — the
  same order of magnitude the repo already uses for subprocess/real-load cases
  (`#3662` precedent) — and left every sub-10ms sibling alone.
  
  **`packages/qa/dogfood/test/semantic-roles.dogfood.test.ts`** — its
  `beforeAll` boots the full showcase stack (ObjectQL + ~45 plugins) through
  `@objectstack/verify`'s `bootStack`, which does not fit vitest's 10s
  `hookTimeout` default with any margin at all: observed failing at 10027ms
  against the 10000ms budget, and this file's own isolated run measured 18.3s
  (vitest `Duration`) / 19.5s wall clock for the whole file even with the box
  otherwise idle. Gave the hook an explicit 180s timeout, matching this
  package's own existing house pattern for the identical
  `bootStack(showcaseStack, …)` call
  (`admin-identity-audit-trail.dogfood.test.ts`'s `beforeAll(…, 180_000)`)
  rather than inventing a new number for the same operation.
  
  **No behaviour change** — both suites already pass; this only gives the two
  timeout-sensitive cases room to finish on a loaded box. The repo's full test
  suite is confirmed green at low concurrency (#9311), so this is margin
  repair, not a product fix. `turbo.json`'s default concurrency is out of scope
  for this change (a maintainer-level default, per #9311's own filing).
- Updated dependencies [56656aa]
- Updated dependencies [c9f5950]
- Updated dependencies [d6e80b2]
- Updated dependencies [07e630e]
- Updated dependencies [66beee0]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [e717ba1]
- Updated dependencies [f287435]
- Updated dependencies [e43d63a]
- Updated dependencies [e374b4d]
- Updated dependencies [1408fe3]
- Updated dependencies [fe90efa]
- Updated dependencies [445ae4d]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [03520eb]
- Updated dependencies [a751f7d]
- Updated dependencies [eccb8b2]
- Updated dependencies [650cd3d]
- Updated dependencies [b735507]
- Updated dependencies [91c6c28]
- Updated dependencies [75b7c24]
- Updated dependencies [cf0d902]
- Updated dependencies [498f4e8]
- Updated dependencies [cc5c07b]
- Updated dependencies [d5552ca]
- Updated dependencies [c7655d4]
- Updated dependencies [d9813a9]
- Updated dependencies [4c178c1]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [04d03c3]
- Updated dependencies [2d0af57]
- Updated dependencies [7337f30]
- Updated dependencies [420804d]
- Updated dependencies [8656d67]
- Updated dependencies [716ac9b]
- Updated dependencies [e9534a4]
- Updated dependencies [6feac91]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [27a567d]
- Updated dependencies [4ea921c]
- Updated dependencies [42b05af]
- Updated dependencies [0ccea4a]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [b705a6c]
- Updated dependencies [f8eb736]
- Updated dependencies [11b779e]
- Updated dependencies [4e71ae1]
- Updated dependencies [739fe5b]
- Updated dependencies [20067c5]
- Updated dependencies [d09d0fd]
- Updated dependencies [5ed8ee6]
- Updated dependencies [ff4ba6a]
- Updated dependencies [f9d7acf]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [2a9752c]
- Updated dependencies [b348ac2]
- Updated dependencies [e4e5c6e]
- Updated dependencies [4dfa369]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [44738f7]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [5e2f594]
- Updated dependencies [e2899f6]
- Updated dependencies [bbd86ed]
- Updated dependencies [b6c7690]
- Updated dependencies [2a6ebaf]
- Updated dependencies [855591f]
- Updated dependencies [3851f87]
- Updated dependencies [c73eacd]
- Updated dependencies [f8537df]
- Updated dependencies [712e185]
- Updated dependencies [d693ba1]
- Updated dependencies [53fc099]
- Updated dependencies [693c788]
- Updated dependencies [845e164]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [0425db9]
- Updated dependencies [cd455c8]
- Updated dependencies [326f5de]
- Updated dependencies [30d3752]
- Updated dependencies [b3de42c]
- Updated dependencies [21995d7]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [6a5e6ad]
- Updated dependencies [30b1c63]
- Updated dependencies [7fc01db]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [03fa4c9]
- Updated dependencies [f01c0ee]
- Updated dependencies [fab693b]
- Updated dependencies [b53d38e]
- Updated dependencies [06f9848]
- Updated dependencies [b0fa4fc]
- Updated dependencies [4012a70]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [b5f6b26]
- Updated dependencies [04f8fdb]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [b2a451f]
- Updated dependencies [c25b2d5]
- Updated dependencies [6158146]
- Updated dependencies [84cb121]
- Updated dependencies [ca19ee8]
- Updated dependencies [147eadc]
- Updated dependencies [90417a8]
- Updated dependencies [a675b4d]
- Updated dependencies [b887013]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [7c2f386]
- Updated dependencies [56bca91]
- Updated dependencies [b3f9831]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [8a9e7f4]
- Updated dependencies [3d0ded8]
- Updated dependencies [44bc51d]
- Updated dependencies [bbbfcfc]
- Updated dependencies [1258dca]
- Updated dependencies [4639cec]
- Updated dependencies [91c4ff5]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
- Updated dependencies [682b86b]
- Updated dependencies [6a1b45e]
- Updated dependencies [b278695]
- Updated dependencies [5126e79]
  - @objectstack/spec@17.1.0
  - @objectstack/platform-objects@17.1.0
  - @objectstack/plugin-auth@17.1.0
  - @objectstack/types@17.1.0
  - @objectstack/plugin-security@17.1.0
  - @objectstack/objectql@17.1.0
  - @objectstack/plugin-audit@17.1.0
  - @objectstack/plugin-email@17.1.0
  - @objectstack/plugin-sharing@17.1.0
  - @objectstack/metadata@17.1.0
  - @objectstack/service-messaging@17.1.0
  - @objectstack/mcp@17.1.0
  - @objectstack/service-analytics@17.1.0
  - @objectstack/service-storage@17.1.0
  - @objectstack/metadata-core@17.1.0
  - @objectstack/example-showcase@0.3.15
  - @objectstack/plugin-webhooks@17.1.0
  - @objectstack/example-crm@4.0.93
  - @objectstack/connector-mcp@17.1.0
  - @objectstack/connector-openapi@17.1.0
  - @objectstack/connector-rest@17.1.0
  - @objectstack/verify@17.1.0

## 0.0.40

### Patch Changes

- Updated dependencies [c9c2d92]
- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [098f4bb]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [48fcf70]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [257d97a]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [3ec8186]
- Updated dependencies [6169615]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [a749273]
- Updated dependencies [99736a0]
- Updated dependencies [134df4f]
- Updated dependencies [fe67e34]
- Updated dependencies [b1863a5]
- Updated dependencies [b1863a5]
- Updated dependencies [3d3fddf]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [735f850]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [ffb003c]
- Updated dependencies [1ea6bce]
- Updated dependencies [e5e8b10]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [bb1ce2e]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [63f3b87]
- Updated dependencies [c44dd5e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [c7f4417]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [b4be309]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [7a55913]
- Updated dependencies [c637387]
- Updated dependencies [2f05139]
- Updated dependencies [c113690]
- Updated dependencies [9a75790]
- Updated dependencies [840ee4b]
- Updated dependencies [705efeb]
- Updated dependencies [978fed2]
- Updated dependencies [c36abfe]
- Updated dependencies [2bc1876]
- Updated dependencies [9ecdca9]
- Updated dependencies [7101ca2]
- Updated dependencies [cfc293f]
- Updated dependencies [fa94b2c]
- Updated dependencies [587fc91]
- Updated dependencies [79c3145]
- Updated dependencies [de70b42]
- Updated dependencies [1792384]
- Updated dependencies [7a55913]
- Updated dependencies [2f6516e]
- Updated dependencies [e6b1bb0]
- Updated dependencies [415254c]
- Updated dependencies [a7b854f]
- Updated dependencies [1d0faa7]
- Updated dependencies [f56ebea]
- Updated dependencies [1f8390b]
- Updated dependencies [f5ab1c7]
- Updated dependencies [3167e29]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [f522e95]
- Updated dependencies [0a6fb1e]
- Updated dependencies [fb3d99b]
- Updated dependencies [328ccc5]
- Updated dependencies [1eaea20]
- Updated dependencies [3abd233]
- Updated dependencies [628b028]
- Updated dependencies [b857356]
- Updated dependencies [fce4c73]
- Updated dependencies [1986594]
- Updated dependencies [f6385c7]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [52200b4]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [5fa04fb]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [ad878e7]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [2e4274d]
- Updated dependencies [941dec4]
- Updated dependencies [20b1a9e]
- Updated dependencies [c8ff269]
- Updated dependencies [0f8d16a]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [fec2f0e]
- Updated dependencies [8d895ff]
- Updated dependencies [c5e7bd9]
- Updated dependencies [83f7743]
- Updated dependencies [0162c81]
- Updated dependencies [055f0c9]
- Updated dependencies [a946efd]
- Updated dependencies [5777b1a]
- Updated dependencies [ea24593]
- Updated dependencies [86f7a20]
- Updated dependencies [7a40b7a]
- Updated dependencies [7cf1531]
- Updated dependencies [f2eb850]
- Updated dependencies [586d6f7]
- Updated dependencies [8bd437f]
- Updated dependencies [5046afe]
- Updated dependencies [984396b]
- Updated dependencies [d0fea33]
- Updated dependencies [2d14b35]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [3028326]
- Updated dependencies [f6472d7]
- Updated dependencies [f78dd23]
- Updated dependencies [6dcbbc3]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [fe2dfa1]
- Updated dependencies [c497d26]
- Updated dependencies [6f6fec7]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [36c2f00]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [bbdbf28]
- Updated dependencies [93929c2]
- Updated dependencies [37785ed]
- Updated dependencies [32f7188]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [3905c00]
- Updated dependencies [4335497]
- Updated dependencies [9b51981]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [db31402]
- Updated dependencies [a0a206f]
- Updated dependencies [6df5135]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [6af87d7]
- Updated dependencies [bcfebb0]
- Updated dependencies [12a19a8]
- Updated dependencies [533a0a4]
- Updated dependencies [5b843fb]
- Updated dependencies [10c4ea9]
- Updated dependencies [3e8e669]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [8e2bbba]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [846ed1f]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [7df7c64]
- Updated dependencies [7e06f51]
- Updated dependencies [c4624f0]
- Updated dependencies [450f3e5]
- Updated dependencies [c931e53]
- Updated dependencies [5c04b2a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [121852d]
- Updated dependencies [d8f65fe]
- Updated dependencies [58ffcab]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [462b713]
- Updated dependencies [36030ff]
- Updated dependencies [a225ef5]
- Updated dependencies [79228cd]
- Updated dependencies [c4ab50b]
- Updated dependencies [3133cda]
- Updated dependencies [1f0e7cb]
- Updated dependencies [8dbd2a8]
- Updated dependencies [ab54608]
- Updated dependencies [6117f7b]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [63b33e6]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [680e8e8]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [c3bcb42]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [c794f78]
- Updated dependencies [7c7e246]
- Updated dependencies [89e9808]
- Updated dependencies [8e17759]
- Updated dependencies [2ef1807]
- Updated dependencies [c519533]
- Updated dependencies [f9a5c59]
- Updated dependencies [f243727]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ce0ca9]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [b3de0dd]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [32d3800]
- Updated dependencies [2b63a00]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [55da611]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [4c45be1]
- Updated dependencies [ac471a0]
- Updated dependencies [6fde910]
- Updated dependencies [60ae58e]
- Updated dependencies [9c82b89]
- Updated dependencies [7f62706]
- Updated dependencies [60cbf9d]
- Updated dependencies [667fa44]
- Updated dependencies [9c4f174]
- Updated dependencies [d25f20b]
- Updated dependencies [205e81b]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [2ff87a2]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [ecc61ab]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [742a6a5]
- Updated dependencies [b5f9397]
- Updated dependencies [db0d53c]
- Updated dependencies [1b2eb1b]
- Updated dependencies [afa6aa5]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [c39d713]
- Updated dependencies [b7d3be4]
- Updated dependencies [afb83d3]
- Updated dependencies [2a0d65e]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [f598aa8]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [77be690]
- Updated dependencies [2b1e37f]
- Updated dependencies [245d1dc]
- Updated dependencies [6029cc1]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [2ad1eba]
- Updated dependencies [881a3cc]
- Updated dependencies [199ec47]
- Updated dependencies [b8c95a6]
- Updated dependencies [66360f3]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [2b2175b]
- Updated dependencies [b49ccfd]
- Updated dependencies [c7406b0]
- Updated dependencies [5b89711]
- Updated dependencies [edff010]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [c892829]
- Updated dependencies [2c19383]
- Updated dependencies [d449b0c]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [729a43a]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [d97f2a2]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [307e0fe]
- Updated dependencies [189854c]
- Updated dependencies [5d4de37]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [c7e7900]
- Updated dependencies [edb4af0]
- Updated dependencies [f09a2e7]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [cb5a75e]
- Updated dependencies [84b6e58]
- Updated dependencies [f160ba4]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [db59e9c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [290d944]
- Updated dependencies [042b9ee]
- Updated dependencies [55011af]
- Updated dependencies [284e7d2]
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [10575f3]
- Updated dependencies [f549a0d]
- Updated dependencies [127f091]
- Updated dependencies [524151c]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [d1cabaa]
- Updated dependencies [41642b0]
- Updated dependencies [aff9e56]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [1a19e9d]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [889d1b9]
- Updated dependencies [53ef057]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [65ac468]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [71af9f5]
- Updated dependencies [88a6bed]
- Updated dependencies [a6b3ee7]
- Updated dependencies [9fd9ae7]
- Updated dependencies [3670cf9]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [fce8e49]
- Updated dependencies [313d7be]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [5faeac6]
- Updated dependencies [e18a162]
- Updated dependencies [e98fb14]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [5d3ced9]
- Updated dependencies [9fa6bab]
- Updated dependencies [cf2c9b7]
- Updated dependencies [d127ff0]
- Updated dependencies [9881074]
- Updated dependencies [1b9a53b]
- Updated dependencies [61dc08e]
- Updated dependencies [8dcf607]
- Updated dependencies [ea1d916]
- Updated dependencies [b691ba9]
- Updated dependencies [36d90fc]
- Updated dependencies [1eadac0]
- Updated dependencies [7777e8f]
- Updated dependencies [c804f19]
- Updated dependencies [7c2f7dd]
- Updated dependencies [9b86cf6]
- Updated dependencies [9b26699]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [95b4f0d]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [e18e3da]
- Updated dependencies [b508244]
- Updated dependencies [dbe92a7]
- Updated dependencies [49f208b]
- Updated dependencies [8597a7d]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [e1fa8d5]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [402f534]
- Updated dependencies [3f7b4ff]
- Updated dependencies [4f3d232]
- Updated dependencies [5c2716b]
- Updated dependencies [e437471]
- Updated dependencies [e472bbe]
- Updated dependencies [4810dd6]
- Updated dependencies [7182362]
- Updated dependencies [99ffc04]
- Updated dependencies [9e9445b]
- Updated dependencies [3987a48]
- Updated dependencies [59c544d]
- Updated dependencies [f3e26b7]
- Updated dependencies [8e0bb68]
- Updated dependencies [73dc89b]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [ff39e63]
- Updated dependencies [a8dcc37]
- Updated dependencies [040ecd2]
- Updated dependencies [932d7e2]
- Updated dependencies [2f59da0]
- Updated dependencies [114e727]
- Updated dependencies [7372d46]
- Updated dependencies [5e247fd]
- Updated dependencies [a6cd2c1]
- Updated dependencies [fc3a819]
- Updated dependencies [d56012f]
- Updated dependencies [1a53a02]
- Updated dependencies [75fd301]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [fdca3a1]
- Updated dependencies [1507ba3]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [b5459bc]
- Updated dependencies [1624f4a]
- Updated dependencies [a954634]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [ac6c0be]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [7c6261a]
- Updated dependencies [90c2b15]
- Updated dependencies [7180ed5]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [39eb01b]
- Updated dependencies [f293d45]
- Updated dependencies [3c03725]
- Updated dependencies [1da39f5]
- Updated dependencies [2604d34]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [bf42e76]
- Updated dependencies [edbf873]
- Updated dependencies [beefe89]
- Updated dependencies [3208222]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [f1850d8]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [17d0954]
- Updated dependencies [f28ef3b]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [1cae606]
- Updated dependencies [4addd9d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [e3c8ed0]
- Updated dependencies [643b7c7]
- Updated dependencies [fa6dd59]
- Updated dependencies [018d22c]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [fc5f126]
- Updated dependencies [adabaa8]
- Updated dependencies [55bbefc]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [f1da948]
- Updated dependencies [b9cc17d]
- Updated dependencies [605c23f]
- Updated dependencies [255f2d7]
- Updated dependencies [29308ba]
- Updated dependencies [759a53a]
- Updated dependencies [b4ad984]
- Updated dependencies [00e9196]
- Updated dependencies [d99ff1a]
- Updated dependencies [bfe689b]
- Updated dependencies [e7a7506]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [de113a4]
- Updated dependencies [4e9e184]
- Updated dependencies [db8c285]
- Updated dependencies [9960cd2]
- Updated dependencies [8c767f5]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [0d24078]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [fda61e4]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [de43f94]
- Updated dependencies [5b8f95b]
- Updated dependencies [cb43296]
- Updated dependencies [0d9a779]
- Updated dependencies [b61afc1]
- Updated dependencies [4c31321]
- Updated dependencies [2c81b92]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [8e7955b]
- Updated dependencies [4921a95]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [7dbf4c3]
- Updated dependencies [e15e679]
- Updated dependencies [2ddba89]
- Updated dependencies [2ab1257]
- Updated dependencies [4b0ebdb]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [cc2de0e]
- Updated dependencies [52281b0]
- Updated dependencies [97b6658]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [69f1a5f]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [1fa224a]
- Updated dependencies [db48ad5]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [3cc8676]
- Updated dependencies [2cca98b]
- Updated dependencies [07f1822]
- Updated dependencies [76bcb83]
- Updated dependencies [e15bf7e]
- Updated dependencies [37a8f2b]
- Updated dependencies [e50e479]
- Updated dependencies [c41828d]
- Updated dependencies [3fb42d2]
- Updated dependencies [8e08bc3]
- Updated dependencies [441d79f]
- Updated dependencies [59b85c0]
- Updated dependencies [7f955e5]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [65f184b]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [dc6abfd]
- Updated dependencies [82397b6]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [4df747c]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [31fb03d]
- Updated dependencies [47a4e67]
- Updated dependencies [f07808c]
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [9bc846b]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [bf478e1]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [30f1b74]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [77fadbf]
- Updated dependencies [8dd98bf]
- Updated dependencies [4fedb11]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [bf1edef]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [f1a8114]
- Updated dependencies [cc3555e]
- Updated dependencies [f8fe47e]
- Updated dependencies [9e9445b]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [5c13368]
- Updated dependencies [89d7b35]
- Updated dependencies [1ee48bc]
- Updated dependencies [94f7b6a]
- Updated dependencies [d13f627]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [e5fd28c]
- Updated dependencies [5487c20]
- Updated dependencies [a841151]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4e74c18]
- Updated dependencies [8b90d68]
- Updated dependencies [4ac12ef]
- Updated dependencies [478f1fd]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [d318b24]
- Updated dependencies [21888ab]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [2680cd3]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b54aaab]
- Updated dependencies [1788e19]
- Updated dependencies [b88f5e8]
- Updated dependencies [531fb31]
- Updated dependencies [857a6cf]
- Updated dependencies [214eb30]
- Updated dependencies [bd68f08]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [93be029]
- Updated dependencies [21676eb]
- Updated dependencies [3f296bf]
- Updated dependencies [b40f81c]
- Updated dependencies [e474853]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [569611f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [6e66cbe]
- Updated dependencies [8e13ca8]
- Updated dependencies [4580597]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [3415a61]
- Updated dependencies [17688fe]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [f226605]
- Updated dependencies [fd6572b]
- Updated dependencies [c272e48]
- Updated dependencies [225ab04]
- Updated dependencies [ccd9397]
- Updated dependencies [d34d9c9]
- Updated dependencies [503be86]
- Updated dependencies [647ec8b]
- Updated dependencies [ba5ff2f]
- Updated dependencies [54299ca]
- Updated dependencies [9f41ee6]
- Updated dependencies [3264516]
- Updated dependencies [1f6ed16]
- Updated dependencies [db2ea82]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [2465133]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [9c90ea0]
- Updated dependencies [41c3b48]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [e51acd6]
- Updated dependencies [8669e5d]
- Updated dependencies [d48aad5]
- Updated dependencies [5f0852f]
- Updated dependencies [b41f51a]
- Updated dependencies [e787608]
- Updated dependencies [ef8b1ff]
- Updated dependencies [3de535b]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [026508b]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
- Updated dependencies [1f1edc0]
- Updated dependencies [efcd68c]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [718b229]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [d56bcdb]
- Updated dependencies [26bb053]
- Updated dependencies [ee3bde1]
- Updated dependencies [098b629]
- Updated dependencies [60b672e]
- Updated dependencies [779bab3]
- Updated dependencies [be90dea]
- Updated dependencies [04b9776]
- Updated dependencies [f104bab]
- Updated dependencies [d86815e]
- Updated dependencies [4f99860]
- Updated dependencies [dca25e1]
- Updated dependencies [68dea0b]
- Updated dependencies [6b441a8]
- Updated dependencies [64f8cbe]
- Updated dependencies [6cb81c7]
- Updated dependencies [61282f9]
- Updated dependencies [c073b8c]
- Updated dependencies [2a18012]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [3a2dde7]
- Updated dependencies [8c20f75]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [52d1a7d]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [c03108c]
- Updated dependencies [fc5f536]
- Updated dependencies [0a5dc29]
- Updated dependencies [e13fd91]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [7e4783f]
- Updated dependencies [b45c71e]
- Updated dependencies [d71ff32]
- Updated dependencies [50185a8]
- Updated dependencies [7309c81]
- Updated dependencies [f8cfbb4]
- Updated dependencies [414083c]
- Updated dependencies [d6bd5a1]
- Updated dependencies [6e6c872]
- Updated dependencies [c797473]
- Updated dependencies [2bd4e5e]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [488b66c]
- Updated dependencies [148d451]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [9aa5510]
- Updated dependencies [a629074]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [6ad13bb]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [e92e2c3]
- Updated dependencies [551f899]
- Updated dependencies [a0fdc56]
- Updated dependencies [946a131]
- Updated dependencies [909895d]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [54f479a]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [69a89ce]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [d19fb5c]
- Updated dependencies [c2a1134]
- Updated dependencies [e889386]
- Updated dependencies [76b9cf5]
- Updated dependencies [f5434b0]
- Updated dependencies [be37f85]
- Updated dependencies [0166bd5]
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [89be40c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [f46e987]
- Updated dependencies [1602949]
- Updated dependencies [06306f1]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [bf1ea92]
- Updated dependencies [719a21b]
- Updated dependencies [e3a6f6e]
- Updated dependencies [c95ac80]
- Updated dependencies [c9bf940]
- Updated dependencies [a1dd1e4]
- Updated dependencies [a682670]
- Updated dependencies [dadb43f]
- Updated dependencies [2b52bc8]
- Updated dependencies [3556b67]
  - @objectstack/plugin-auth@17.0.0
  - @objectstack/spec@17.0.0
  - @objectstack/objectql@17.0.0
  - @objectstack/plugin-audit@17.0.0
  - @objectstack/platform-objects@17.0.0
  - @objectstack/plugin-security@17.0.0
  - @objectstack/plugin-webhooks@17.0.0
  - @objectstack/service-storage@17.0.0
  - @objectstack/types@17.0.0
  - @objectstack/mcp@17.0.0
  - @objectstack/metadata@17.0.0
  - @objectstack/plugin-sharing@17.0.0
  - @objectstack/service-messaging@17.0.0
  - @objectstack/metadata-core@17.0.0
  - @objectstack/service-analytics@17.0.0
  - @objectstack/verify@17.0.0
  - @objectstack/example-showcase@0.3.14
  - @objectstack/plugin-email@17.0.0
  - @objectstack/connector-mcp@17.0.0
  - @objectstack/connector-openapi@17.0.0
  - @objectstack/connector-rest@17.0.0
  - @objectstack/example-crm@4.0.92

## 0.0.40-rc.5

### Patch Changes

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [63f3b87]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [2bc1876]
- Updated dependencies [1d0faa7]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [5fa04fb]
- Updated dependencies [ad878e7]
- Updated dependencies [43a7a8d]
- Updated dependencies [2e4274d]
- Updated dependencies [c8ff269]
- Updated dependencies [0f8d16a]
- Updated dependencies [83f7743]
- Updated dependencies [5777b1a]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [3028326]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [fe2dfa1]
- Updated dependencies [6f6fec7]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [10c4ea9]
- Updated dependencies [3e8e669]
- Updated dependencies [62b6a2f]
- Updated dependencies [8e2bbba]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [ab54608]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [f9a5c59]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [55da611]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [6fde910]
- Updated dependencies [9c82b89]
- Updated dependencies [74155c7]
- Updated dependencies [742a6a5]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [b7d3be4]
- Updated dependencies [2a0d65e]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [6029cc1]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [edb4af0]
- Updated dependencies [f09a2e7]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [db59e9c]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [55011af]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [53ef057]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d127ff0]
- Updated dependencies [ea1d916]
- Updated dependencies [c804f19]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [dbe92a7]
- Updated dependencies [49f208b]
- Updated dependencies [c6b6bb4]
- Updated dependencies [4f3d232]
- Updated dependencies [5c2716b]
- Updated dependencies [9e9445b]
- Updated dependencies [59c544d]
- Updated dependencies [f3e26b7]
- Updated dependencies [932d7e2]
- Updated dependencies [2f59da0]
- Updated dependencies [114e727]
- Updated dependencies [5e247fd]
- Updated dependencies [1a53a02]
- Updated dependencies [1507ba3]
- Updated dependencies [a954634]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [7c6261a]
- Updated dependencies [08863dd]
- Updated dependencies [3c03725]
- Updated dependencies [1da39f5]
- Updated dependencies [2604d34]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [bf42e76]
- Updated dependencies [90bbf25]
- Updated dependencies [f1850d8]
- Updated dependencies [eb91eba]
- Updated dependencies [17d0954]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [bfe689b]
- Updated dependencies [d0d5205]
- Updated dependencies [9960cd2]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [de43f94]
- Updated dependencies [4c31321]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [69f1a5f]
- Updated dependencies [1fa224a]
- Updated dependencies [3cc8676]
- Updated dependencies [e15bf7e]
- Updated dependencies [3fb42d2]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [82397b6]
- Updated dependencies [4df747c]
- Updated dependencies [7084313]
- Updated dependencies [47a4e67]
- Updated dependencies [91cefb8]
- Updated dependencies [9bc846b]
- Updated dependencies [0e043d8]
- Updated dependencies [4fedb11]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [f8fe47e]
- Updated dependencies [9e9445b]
- Updated dependencies [89d7b35]
- Updated dependencies [d13f627]
- Updated dependencies [e5fd28c]
- Updated dependencies [a841151]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [1788e19]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [8e13ca8]
- Updated dependencies [3510e4a]
- Updated dependencies [3415a61]
- Updated dependencies [17688fe]
- Updated dependencies [aa4b90d]
- Updated dependencies [fd6572b]
- Updated dependencies [54299ca]
- Updated dependencies [3264516]
- Updated dependencies [1f6ed16]
- Updated dependencies [dc61def]
- Updated dependencies [2465133]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [d48aad5]
- Updated dependencies [e787608]
- Updated dependencies [3de535b]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [d86815e]
- Updated dependencies [61282f9]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [e13fd91]
- Updated dependencies [2bd4e5e]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [d19fb5c]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
- Updated dependencies [c9bf940]
- Updated dependencies [a682670]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/objectql@17.0.0-rc.6
  - @objectstack/plugin-security@17.0.0-rc.6
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/service-storage@17.0.0-rc.6
  - @objectstack/service-analytics@17.0.0-rc.6
  - @objectstack/plugin-audit@17.0.0-rc.6
  - @objectstack/service-messaging@17.0.0-rc.6
  - @objectstack/metadata@17.0.0-rc.6
  - @objectstack/plugin-sharing@17.0.0-rc.6
  - @objectstack/plugin-auth@17.0.0-rc.6
  - @objectstack/example-crm@4.0.92-rc.5
  - @objectstack/mcp@17.0.0-rc.6
  - @objectstack/example-showcase@0.3.14-rc.5
  - @objectstack/types@17.0.0-rc.6
  - @objectstack/plugin-email@17.0.0-rc.6
  - @objectstack/plugin-webhooks@17.0.0-rc.6
  - @objectstack/verify@17.0.0-rc.6
  - @objectstack/connector-mcp@17.0.0-rc.6
  - @objectstack/connector-openapi@17.0.0-rc.6
  - @objectstack/connector-rest@17.0.0-rc.6

## 0.0.40-rc.4

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ee3bde1]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
- Updated dependencies [148d451]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/objectql@17.0.0-rc.5
  - @objectstack/example-crm@4.0.92-rc.4
  - @objectstack/example-showcase@0.3.14-rc.4
  - @objectstack/connector-mcp@17.0.0-rc.5
  - @objectstack/connector-openapi@17.0.0-rc.5
  - @objectstack/connector-rest@17.0.0-rc.5
  - @objectstack/mcp@17.0.0-rc.5
  - @objectstack/metadata@17.0.0-rc.5
  - @objectstack/platform-objects@17.0.0-rc.5
  - @objectstack/plugin-audit@17.0.0-rc.5
  - @objectstack/plugin-auth@17.0.0-rc.5
  - @objectstack/plugin-email@17.0.0-rc.5
  - @objectstack/plugin-security@17.0.0-rc.5
  - @objectstack/plugin-sharing@17.0.0-rc.5
  - @objectstack/plugin-webhooks@17.0.0-rc.5
  - @objectstack/service-analytics@17.0.0-rc.5
  - @objectstack/service-messaging@17.0.0-rc.5
  - @objectstack/service-storage@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5
  - @objectstack/verify@17.0.0-rc.5

## 0.0.40-rc.3

### Patch Changes

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [c637387]
- Updated dependencies [c113690]
- Updated dependencies [705efeb]
- Updated dependencies [978fed2]
- Updated dependencies [c36abfe]
- Updated dependencies [9ecdca9]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [1792384]
- Updated dependencies [2f6516e]
- Updated dependencies [e6b1bb0]
- Updated dependencies [a7b854f]
- Updated dependencies [f56ebea]
- Updated dependencies [64cd010]
- Updated dependencies [f522e95]
- Updated dependencies [fb3d99b]
- Updated dependencies [628b028]
- Updated dependencies [b857356]
- Updated dependencies [fce4c73]
- Updated dependencies [f6385c7]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [c5e7bd9]
- Updated dependencies [0162c81]
- Updated dependencies [055f0c9]
- Updated dependencies [7a40b7a]
- Updated dependencies [7cf1531]
- Updated dependencies [586d6f7]
- Updated dependencies [2d14b35]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [c497d26]
- Updated dependencies [bbdbf28]
- Updated dependencies [93929c2]
- Updated dependencies [2e284b2]
- Updated dependencies [3905c00]
- Updated dependencies [4335497]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [bcfebb0]
- Updated dependencies [533a0a4]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [846ed1f]
- Updated dependencies [947d4f9]
- Updated dependencies [d8f65fe]
- Updated dependencies [58ffcab]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [3133cda]
- Updated dependencies [1f0e7cb]
- Updated dependencies [8dbd2a8]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c794f78]
- Updated dependencies [9ce0ca9]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [2b63a00]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [9c4f174]
- Updated dependencies [d25f20b]
- Updated dependencies [205e81b]
- Updated dependencies [37e38d1]
- Updated dependencies [ecc61ab]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [afa6aa5]
- Updated dependencies [afb83d3]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [2b2175b]
- Updated dependencies [b49ccfd]
- Updated dependencies [c7406b0]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [729a43a]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [d97f2a2]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [290d944]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [88a6bed]
- Updated dependencies [a6b3ee7]
- Updated dependencies [7f1a635]
- Updated dependencies [e98fb14]
- Updated dependencies [5d3ced9]
- Updated dependencies [9fa6bab]
- Updated dependencies [1b9a53b]
- Updated dependencies [61dc08e]
- Updated dependencies [8dcf607]
- Updated dependencies [b691ba9]
- Updated dependencies [1eadac0]
- Updated dependencies [7c2f7dd]
- Updated dependencies [9b26699]
- Updated dependencies [95b4f0d]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [e18e3da]
- Updated dependencies [b508244]
- Updated dependencies [8597a7d]
- Updated dependencies [594508e]
- Updated dependencies [ff39e63]
- Updated dependencies [1c625ca]
- Updated dependencies [b5459bc]
- Updated dependencies [1624f4a]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [26e1029]
- Updated dependencies [1cae606]
- Updated dependencies [4addd9d]
- Updated dependencies [108ba8d]
- Updated dependencies [b9cc17d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [de113a4]
- Updated dependencies [db8c285]
- Updated dependencies [0d24078]
- Updated dependencies [089767f]
- Updated dependencies [5b8f95b]
- Updated dependencies [2ddba89]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [2cca98b]
- Updated dependencies [07f1822]
- Updated dependencies [37a8f2b]
- Updated dependencies [441d79f]
- Updated dependencies [7f955e5]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [dc6abfd]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [bf1edef]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [2680cd3]
- Updated dependencies [c5a5996]
- Updated dependencies [b40f81c]
- Updated dependencies [6e66cbe]
- Updated dependencies [f226605]
- Updated dependencies [c272e48]
- Updated dependencies [9f41ee6]
- Updated dependencies [db2ea82]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [9c90ea0]
- Updated dependencies [41c3b48]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [ef8b1ff]
- Updated dependencies [1f1edc0]
- Updated dependencies [718b229]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [d56bcdb]
- Updated dependencies [f104bab]
- Updated dependencies [dca25e1]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [488b66c]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [e92e2c3]
- Updated dependencies [946a131]
- Updated dependencies [909895d]
- Updated dependencies [c183a12]
- Updated dependencies [69a89ce]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
- Updated dependencies [2b52bc8]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/service-analytics@17.0.0-rc.4
  - @objectstack/metadata@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4
  - @objectstack/plugin-audit@17.0.0-rc.4
  - @objectstack/plugin-auth@17.0.0-rc.4
  - @objectstack/objectql@17.0.0-rc.4
  - @objectstack/example-showcase@0.3.14-rc.3
  - @objectstack/plugin-email@17.0.0-rc.4
  - @objectstack/plugin-security@17.0.0-rc.4
  - @objectstack/verify@17.0.0-rc.4
  - @objectstack/plugin-sharing@17.0.0-rc.4
  - @objectstack/mcp@17.0.0-rc.4
  - @objectstack/service-messaging@17.0.0-rc.4
  - @objectstack/service-storage@17.0.0-rc.4
  - @objectstack/example-crm@4.0.92-rc.3
  - @objectstack/connector-mcp@17.0.0-rc.4
  - @objectstack/connector-openapi@17.0.0-rc.4
  - @objectstack/connector-rest@17.0.0-rc.4
  - @objectstack/plugin-webhooks@17.0.0-rc.4

## 0.0.40-rc.2

### Patch Changes

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [257d97a]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
- Updated dependencies [e6b1b69]
- Updated dependencies [2f05139]
- Updated dependencies [fa94b2c]
- Updated dependencies [328ccc5]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [941dec4]
- Updated dependencies [20b1a9e]
- Updated dependencies [f2eb850]
- Updated dependencies [8bd437f]
- Updated dependencies [5046afe]
- Updated dependencies [203a449]
- Updated dependencies [6dcbbc3]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [462b713]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [63b33e6]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [4c45be1]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [d449b0c]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [cb5a75e]
- Updated dependencies [84b6e58]
- Updated dependencies [f160ba4]
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [127f091]
- Updated dependencies [9fd9ae7]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [040ecd2]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [0d9a779]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [1ee48bc]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [ba5ff2f]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [26bb053]
- Updated dependencies [be90dea]
- Updated dependencies [04b9776]
- Updated dependencies [04f1182]
- Updated dependencies [c03108c]
- Updated dependencies [5647006]
- Updated dependencies [50185a8]
- Updated dependencies [d6bd5a1]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [c2a1134]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/objectql@17.0.0-rc.2
  - @objectstack/plugin-auth@17.0.0-rc.2
  - @objectstack/plugin-audit@17.0.0-rc.2
  - @objectstack/plugin-security@17.0.0-rc.2
  - @objectstack/plugin-webhooks@17.0.0-rc.2
  - @objectstack/platform-objects@17.0.0-rc.2
  - @objectstack/service-analytics@17.0.0-rc.2
  - @objectstack/service-storage@17.0.0-rc.2
  - @objectstack/example-crm@4.0.92-rc.2
  - @objectstack/example-showcase@0.3.14-rc.2
  - @objectstack/plugin-sharing@17.0.0-rc.2
  - @objectstack/plugin-email@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2
  - @objectstack/verify@17.0.0-rc.2
  - @objectstack/service-messaging@17.0.0-rc.2
  - @objectstack/connector-mcp@17.0.0-rc.2
  - @objectstack/connector-openapi@17.0.0-rc.2
  - @objectstack/connector-rest@17.0.0-rc.2
  - @objectstack/mcp@17.0.0-rc.2

## 0.0.40-rc.1

### Patch Changes

- Updated dependencies [6a67d7a]
- Updated dependencies [48fcf70]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [3ec8186]
- Updated dependencies [b1863a5]
- Updated dependencies [b1863a5]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
- Updated dependencies [3aef718]
- Updated dependencies [ffb003c]
- Updated dependencies [1ea6bce]
- Updated dependencies [e5e8b10]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [bb1ce2e]
- Updated dependencies [b4be309]
- Updated dependencies [05154a1]
- Updated dependencies [7a55913]
- Updated dependencies [7a55913]
- Updated dependencies [f5ab1c7]
- Updated dependencies [9b6fe7c]
- Updated dependencies [3abd233]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [a946efd]
- Updated dependencies [ea24593]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [7df7c64]
- Updated dependencies [a225ef5]
- Updated dependencies [c8124e5]
- Updated dependencies [c3bcb42]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [c39d713]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [71af9f5]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [99ffc04]
- Updated dependencies [7309c81]
- Updated dependencies [a8dcc37]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [55bbefc]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [cc2de0e]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [bf478e1]
- Updated dependencies [ec796d5]
- Updated dependencies [77fadbf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [5c13368]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [65a3a84]
- Updated dependencies [4580597]
- Updated dependencies [d5749d7]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [efcd68c]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [68dea0b]
- Updated dependencies [64f8cbe]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/objectql@17.0.0-rc.1
  - @objectstack/service-storage@17.0.0-rc.1
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/plugin-sharing@17.0.0-rc.1
  - @objectstack/plugin-security@17.0.0-rc.1
  - @objectstack/plugin-auth@17.0.0-rc.1
  - @objectstack/plugin-webhooks@17.0.0-rc.1
  - @objectstack/service-messaging@17.0.0-rc.1
  - @objectstack/service-analytics@17.0.0-rc.1
  - @objectstack/plugin-audit@17.0.0-rc.1
  - @objectstack/connector-mcp@17.0.0-rc.1
  - @objectstack/connector-openapi@17.0.0-rc.1
  - @objectstack/connector-rest@17.0.0-rc.1
  - @objectstack/mcp@17.0.0-rc.1
  - @objectstack/verify@17.0.0-rc.1
  - @objectstack/example-showcase@0.3.14-rc.1
  - @objectstack/example-crm@4.0.92-rc.1

## 0.0.40-rc.0

### Patch Changes

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [6169615]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [a749273]
- Updated dependencies [99736a0]
- Updated dependencies [134df4f]
- Updated dependencies [fe67e34]
- Updated dependencies [3d3fddf]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [735f850]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [c7f4417]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [840ee4b]
- Updated dependencies [7101ca2]
- Updated dependencies [587fc91]
- Updated dependencies [415254c]
- Updated dependencies [1f8390b]
- Updated dependencies [3167e29]
- Updated dependencies [0a6fb1e]
- Updated dependencies [1986594]
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
- Updated dependencies [984396b]
- Updated dependencies [d0fea33]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [680e8e8]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f243727]
- Updated dependencies [f35cdc5]
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
- Updated dependencies [2c19383]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [307e0fe]
- Updated dependencies [189854c]
- Updated dependencies [5d4de37]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [d1cabaa]
- Updated dependencies [41642b0]
- Updated dependencies [aff9e56]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [65ac468]
- Updated dependencies [dac6a08]
- Updated dependencies [313d7be]
- Updated dependencies [5faeac6]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [e1fa8d5]
- Updated dependencies [402f534]
- Updated dependencies [0045682]
- Updated dependencies [7180ed5]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [fc5f126]
- Updated dependencies [adabaa8]
- Updated dependencies [030125b]
- Updated dependencies [605c23f]
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
- Updated dependencies [52281b0]
- Updated dependencies [db48ad5]
- Updated dependencies [8e08bc3]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [f1a8114]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [d318b24]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [bd68f08]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [5f0852f]
- Updated dependencies [cde1975]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [a629074]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [54f479a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [e889386]
- Updated dependencies [69f1dfd]
- Updated dependencies [c95ac80]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/objectql@17.0.0-rc.0
  - @objectstack/service-storage@17.0.0-rc.0
  - @objectstack/plugin-auth@17.0.0-rc.0
  - @objectstack/plugin-security@17.0.0-rc.0
  - @objectstack/mcp@17.0.0-rc.0
  - @objectstack/service-analytics@17.0.0-rc.0
  - @objectstack/verify@17.0.0-rc.0
  - @objectstack/plugin-audit@17.0.0-rc.0
  - @objectstack/plugin-webhooks@17.0.0-rc.0
  - @objectstack/example-crm@4.0.92-rc.0
  - @objectstack/example-showcase@0.3.14-rc.0
  - @objectstack/connector-mcp@17.0.0-rc.0
  - @objectstack/connector-openapi@17.0.0-rc.0
  - @objectstack/connector-rest@17.0.0-rc.0
  - @objectstack/service-messaging@17.0.0-rc.0

## 0.0.39

### Patch Changes

- Updated dependencies [9e45b63]
  - @objectstack/spec@16.1.0
  - @objectstack/plugin-audit@16.1.0
  - @objectstack/plugin-auth@16.1.0
  - @objectstack/plugin-security@16.1.0
  - @objectstack/service-storage@16.1.0
  - @objectstack/example-crm@4.0.91
  - @objectstack/example-showcase@0.3.13
  - @objectstack/connector-mcp@16.1.0
  - @objectstack/connector-openapi@16.1.0
  - @objectstack/connector-rest@16.1.0
  - @objectstack/mcp@16.1.0
  - @objectstack/objectql@16.1.0
  - @objectstack/verify@16.1.0

## 0.0.38

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [41e703b]
- Updated dependencies [2f3c641]
- Updated dependencies [e38da5b]
- Updated dependencies [f9b118d]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [deb7e7e]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [fdc244e]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [616e839]
- Updated dependencies [ee0a499]
- Updated dependencies [158aa14]
- Updated dependencies [9d897b3]
- Updated dependencies [62a2117]
- Updated dependencies [15dbe18]
- Updated dependencies [83e8f7d]
- Updated dependencies [230358c]
- Updated dependencies [d2723e2]
- Updated dependencies [674457a]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
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
  - @objectstack/spec@16.0.0
  - @objectstack/connector-openapi@16.0.0
  - @objectstack/plugin-security@16.0.0
  - @objectstack/objectql@16.0.0
  - @objectstack/plugin-auth@16.0.0
  - @objectstack/plugin-audit@16.0.0
  - @objectstack/service-storage@16.0.0
  - @objectstack/mcp@16.0.0
  - @objectstack/example-crm@4.0.90
  - @objectstack/example-showcase@0.3.12
  - @objectstack/verify@16.0.0
  - @objectstack/connector-mcp@16.0.0
  - @objectstack/connector-rest@16.0.0

## 0.0.38-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [ee0a499]
- Updated dependencies [9d897b3]
- Updated dependencies [62a2117]
- Updated dependencies [674457a]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/plugin-audit@16.0.0-rc.1
  - @objectstack/service-storage@16.0.0-rc.1
  - @objectstack/plugin-security@16.0.0-rc.1
  - @objectstack/objectql@16.0.0-rc.1
  - @objectstack/example-crm@4.0.90-rc.1
  - @objectstack/example-showcase@0.3.12-rc.1
  - @objectstack/connector-mcp@16.0.0-rc.1
  - @objectstack/connector-openapi@16.0.0-rc.1
  - @objectstack/connector-rest@16.0.0-rc.1
  - @objectstack/mcp@16.0.0-rc.1
  - @objectstack/plugin-auth@16.0.0-rc.1
  - @objectstack/verify@16.0.0-rc.1

## 0.0.38-rc.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [41e703b]
- Updated dependencies [2f3c641]
- Updated dependencies [e38da5b]
- Updated dependencies [f9b118d]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [deb7e7e]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [fdc244e]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [616e839]
- Updated dependencies [158aa14]
- Updated dependencies [15dbe18]
- Updated dependencies [83e8f7d]
- Updated dependencies [230358c]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
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
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/connector-openapi@16.0.0-rc.0
  - @objectstack/plugin-security@16.0.0-rc.0
  - @objectstack/objectql@16.0.0-rc.0
  - @objectstack/plugin-auth@16.0.0-rc.0
  - @objectstack/plugin-audit@16.0.0-rc.0
  - @objectstack/mcp@16.0.0-rc.0
  - @objectstack/example-crm@4.0.90-rc.0
  - @objectstack/example-showcase@0.3.12-rc.0
  - @objectstack/verify@16.0.0-rc.0
  - @objectstack/connector-mcp@16.0.0-rc.0
  - @objectstack/connector-rest@16.0.0-rc.0
  - @objectstack/service-storage@16.0.0-rc.0

## 0.0.37

### Patch Changes

- Updated dependencies [9dbb883]
- Updated dependencies [01ba3b3]
  - @objectstack/plugin-auth@15.1.1
  - @objectstack/verify@15.1.1
  - @objectstack/example-crm@4.0.89
  - @objectstack/example-showcase@0.3.11
  - @objectstack/spec@15.1.1
  - @objectstack/objectql@15.1.1
  - @objectstack/plugin-audit@15.1.1
  - @objectstack/plugin-security@15.1.1
  - @objectstack/connector-mcp@15.1.1
  - @objectstack/connector-rest@15.1.1
  - @objectstack/service-storage@15.1.1
  - @objectstack/connector-openapi@15.1.1

## 0.0.36

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
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
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [d75c7ac]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/objectql@15.1.0
  - @objectstack/plugin-audit@15.1.0
  - @objectstack/connector-rest@15.1.0
  - @objectstack/connector-openapi@15.1.0
  - @objectstack/connector-mcp@15.1.0
  - @objectstack/service-storage@15.1.0
  - @objectstack/verify@15.1.0
  - @objectstack/plugin-security@15.1.0
  - @objectstack/plugin-auth@15.1.0
  - @objectstack/example-crm@4.0.88
  - @objectstack/example-showcase@0.3.10

## 0.0.35

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [0fcef9b]
- Updated dependencies [13749ec]
- Updated dependencies [ca2b2f6]
- Updated dependencies [2ae78c6]
- Updated dependencies [5febe3f]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [698454e]
- Updated dependencies [29a4c90]
- Updated dependencies [ef70521]
- Updated dependencies [a581a65]
- Updated dependencies [31d04d4]
- Updated dependencies [5774a75]
  - @objectstack/spec@15.0.0
  - @objectstack/plugin-security@15.0.0
  - @objectstack/objectql@15.0.0
  - @objectstack/plugin-auth@15.0.0
  - @objectstack/example-crm@4.0.87
  - @objectstack/example-showcase@0.3.9
  - @objectstack/verify@15.0.0

## 0.0.34

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [a199626]
- Updated dependencies [607aaf4]
- Updated dependencies [f0acf25]
- Updated dependencies [712328a]
- Updated dependencies [1dede32]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/plugin-security@14.8.0
  - @objectstack/example-crm@4.0.86
  - @objectstack/example-showcase@0.3.8
  - @objectstack/objectql@14.8.0
  - @objectstack/plugin-auth@14.8.0
  - @objectstack/verify@14.8.0

## 0.0.33

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [da5e686]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/plugin-auth@14.7.0
  - @objectstack/plugin-security@14.7.0
  - @objectstack/example-crm@4.0.85
  - @objectstack/example-showcase@0.3.7
  - @objectstack/objectql@14.7.0
  - @objectstack/verify@14.7.0

## 0.0.32

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
- Updated dependencies [8f4a261]
- Updated dependencies [6e2b8ae]
  - @objectstack/spec@14.6.0
  - @objectstack/objectql@14.6.0
  - @objectstack/plugin-security@14.6.0
  - @objectstack/example-crm@4.0.84
  - @objectstack/example-showcase@0.3.6
  - @objectstack/verify@14.6.0

## 0.0.31

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [f70eb2c]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/plugin-security@14.5.0
  - @objectstack/objectql@14.5.0
  - @objectstack/example-crm@4.0.83
  - @objectstack/example-showcase@0.3.5
  - @objectstack/verify@14.5.0

## 0.0.30

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/objectql@14.4.0
  - @objectstack/plugin-security@14.4.0
  - @objectstack/example-showcase@0.3.4
  - @objectstack/example-crm@4.0.82
  - @objectstack/verify@14.4.0

## 0.0.29

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [8f0b9df]
- Updated dependencies [ff648ad]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/plugin-security@14.3.0
  - @objectstack/objectql@14.3.0
  - @objectstack/verify@14.3.0
  - @objectstack/example-crm@4.0.81
  - @objectstack/example-showcase@0.3.3

## 0.0.28

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/plugin-security@14.2.0
  - @objectstack/spec@14.2.0
  - @objectstack/verify@14.2.0
  - @objectstack/example-crm@4.0.80
  - @objectstack/example-showcase@0.3.2
  - @objectstack/objectql@14.2.0

## 0.0.27

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/example-crm@4.0.79
  - @objectstack/example-showcase@0.3.1
  - @objectstack/objectql@14.1.0
  - @objectstack/plugin-security@14.1.0
  - @objectstack/verify@14.1.0

## 0.0.26

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [ac08698]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [afa8115]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
- Updated dependencies [bd39dc5]
- Updated dependencies [1056c5f]
  - @objectstack/spec@14.0.0
  - @objectstack/example-showcase@0.3.0
  - @objectstack/plugin-security@14.0.0
  - @objectstack/objectql@14.0.0
  - @objectstack/example-crm@4.0.78
  - @objectstack/verify@14.0.0

## 0.0.25

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [799b285]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [a1766fe]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/objectql@13.0.0
  - @objectstack/plugin-security@13.0.0
  - @objectstack/example-crm@4.0.77
  - @objectstack/example-showcase@0.2.23
  - @objectstack/verify@13.0.0

## 0.0.24

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [3fd3576]
  - @objectstack/spec@12.6.0
  - @objectstack/verify@12.6.0
  - @objectstack/example-crm@4.0.76
  - @objectstack/example-showcase@0.2.22
  - @objectstack/objectql@12.6.0
  - @objectstack/plugin-security@12.6.0

## 0.0.23

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/objectql@12.5.0
  - @objectstack/example-crm@4.0.75
  - @objectstack/example-showcase@0.2.21
  - @objectstack/plugin-security@12.5.0
  - @objectstack/verify@12.5.0

## 0.0.22

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/objectql@12.4.0
  - @objectstack/example-crm@4.0.74
  - @objectstack/example-showcase@0.2.20
  - @objectstack/plugin-security@12.4.0
  - @objectstack/verify@12.4.0

## 0.0.21

### Patch Changes

- Updated dependencies [5a0da03]
- Updated dependencies [e7eceec]
  - @objectstack/objectql@12.3.0
  - @objectstack/spec@12.3.0
  - @objectstack/example-showcase@0.2.19
  - @objectstack/verify@12.3.0
  - @objectstack/example-crm@4.0.73
  - @objectstack/plugin-security@12.3.0

## 0.0.20

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/plugin-security@12.2.0
  - @objectstack/objectql@12.2.0
  - @objectstack/verify@12.2.0
  - @objectstack/example-crm@4.0.72
  - @objectstack/example-showcase@0.2.18

## 0.0.19

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/verify@12.1.0
  - @objectstack/example-crm@4.0.71
  - @objectstack/example-showcase@0.2.17
  - @objectstack/objectql@12.1.0
  - @objectstack/plugin-security@12.1.0

## 0.0.18

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [9796e7c]
- Updated dependencies [7c09621]
- Updated dependencies [2d567cb]
- Updated dependencies [24b62ee]
- Updated dependencies [7709db4]
- Updated dependencies [48ad533]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [c2fdbf9]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/plugin-security@12.0.0
  - @objectstack/objectql@12.0.0
  - @objectstack/verify@12.0.0
  - @objectstack/example-crm@4.0.70
  - @objectstack/example-showcase@0.2.16

## 0.0.17

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/plugin-security@11.10.0
  - @objectstack/example-crm@4.0.69
  - @objectstack/example-showcase@0.2.15
  - @objectstack/objectql@11.10.0
  - @objectstack/verify@11.10.0

## 0.0.16

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/example-crm@4.0.68
  - @objectstack/example-showcase@0.2.14
  - @objectstack/verify@11.9.0
  - @objectstack/objectql@11.9.0
  - @objectstack/plugin-security@11.9.0

## 0.0.15

### Patch Changes

- @objectstack/plugin-security@11.8.0
- @objectstack/example-crm@4.0.67
- @objectstack/example-showcase@0.2.13
- @objectstack/verify@11.8.0
- @objectstack/spec@11.8.0
- @objectstack/objectql@11.8.0

## 0.0.14

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/example-crm@4.0.66
  - @objectstack/example-showcase@0.2.12
  - @objectstack/objectql@11.7.0
  - @objectstack/plugin-security@11.7.0
  - @objectstack/verify@11.7.0

## 0.0.13

### Patch Changes

- @objectstack/example-crm@4.0.65
- @objectstack/example-showcase@0.2.11
- @objectstack/spec@11.6.0
- @objectstack/objectql@11.6.0
- @objectstack/plugin-security@11.6.0
- @objectstack/verify@11.6.0

## 0.0.12

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/example-crm@4.0.64
  - @objectstack/example-showcase@0.2.10
  - @objectstack/objectql@11.5.0
  - @objectstack/plugin-security@11.5.0
  - @objectstack/verify@11.5.0

## 0.0.11

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/example-crm@4.0.63
  - @objectstack/example-showcase@0.2.9
  - @objectstack/objectql@11.4.0
  - @objectstack/plugin-security@11.4.0
  - @objectstack/verify@11.4.0

## 0.0.10

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/example-crm@4.0.62
  - @objectstack/example-showcase@0.2.8
  - @objectstack/objectql@11.3.0
  - @objectstack/plugin-security@11.3.0
  - @objectstack/verify@11.3.0

## 0.0.9

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/example-crm@4.0.61
  - @objectstack/example-showcase@0.2.7
  - @objectstack/objectql@11.2.0
  - @objectstack/plugin-security@11.2.0
  - @objectstack/verify@11.2.0

## 0.0.8

### Patch Changes

- Updated dependencies [574e7a3]
- Updated dependencies [13dbcf2]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/plugin-security@11.1.0
  - @objectstack/objectql@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/verify@11.1.0
  - @objectstack/example-crm@4.0.60
  - @objectstack/example-showcase@0.2.6

## 0.0.7

### Patch Changes

- Updated dependencies [4d99a5c]
- Updated dependencies [ab5718a]
- Updated dependencies [61d441f]
- Updated dependencies [c224e18]
- Updated dependencies [d616e1d]
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
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/objectql@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/verify@11.0.0
  - @objectstack/example-showcase@0.2.5
  - @objectstack/example-crm@4.0.59
  - @objectstack/plugin-security@11.0.0

## 0.0.6

### Patch Changes

- Updated dependencies [211425e]
  - @objectstack/objectql@10.3.0
  - @objectstack/verify@10.3.0
  - @objectstack/example-crm@4.0.58
  - @objectstack/example-showcase@0.2.4
  - @objectstack/spec@10.3.0
  - @objectstack/plugin-security@10.3.0

## 0.0.5

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/example-crm@4.0.57
  - @objectstack/example-showcase@0.2.3
  - @objectstack/objectql@10.2.0
  - @objectstack/plugin-security@10.2.0
  - @objectstack/verify@10.2.0

## 0.0.4

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
- Updated dependencies [49da36e]
  - @objectstack/spec@10.1.0
  - @objectstack/verify@10.1.0
  - @objectstack/example-crm@4.0.56
  - @objectstack/example-showcase@0.2.2
  - @objectstack/objectql@10.1.0
  - @objectstack/plugin-security@10.1.0

## 0.0.3

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [cfd86ce]
- Updated dependencies [e411a82]
- Updated dependencies [ee86099]
- Updated dependencies [a581385]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [0feea92]
  - @objectstack/spec@10.0.0
  - @objectstack/objectql@10.0.0
  - @objectstack/plugin-security@10.0.0
  - @objectstack/verify@10.0.0
  - @objectstack/example-crm@4.0.55
  - @objectstack/example-showcase@0.2.1

## 0.0.2

### Patch Changes

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
- Updated dependencies [37e9acb]
- Updated dependencies [a8e4f3b]
- Updated dependencies [fd2e1a2]
  - @objectstack/spec@9.11.0
  - @objectstack/example-showcase@0.2.0
  - @objectstack/plugin-security@9.11.0
  - @objectstack/objectql@9.11.0
  - @objectstack/verify@9.11.0
  - @objectstack/example-crm@4.0.54

## 0.0.1

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [f169558]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
- Updated dependencies [fd07027]
  - @objectstack/service-analytics@9.10.0
  - @objectstack/spec@9.10.0
  - @objectstack/plugin-org-scoping@9.10.0
  - @objectstack/plugin-security@9.10.0
  - @objectstack/objectql@9.10.0
  - @objectstack/runtime@9.10.0
  - @objectstack/rest@9.10.0
  - @objectstack/driver-sqlite-wasm@9.10.0
  - @objectstack/example-crm@4.0.53
  - @objectstack/example-showcase@0.1.23
  - @objectstack/core@9.10.0
  - @objectstack/plugin-auth@9.10.0
  - @objectstack/plugin-hono-server@9.10.0
  - @objectstack/plugin-sharing@9.10.0
  - @objectstack/service-settings@9.10.0
