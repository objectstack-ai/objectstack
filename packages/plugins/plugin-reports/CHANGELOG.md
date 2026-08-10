# @objectstack/plugin-reports

## 17.0.0-rc.6

### Patch Changes

- f40c5b4: refactor(plugin-approvals,plugin-reports): enforcement implementations annotate the full `ExecutionContext` (#7135)

  The services half of #7070, mirroring what PR #7140 did for
  `plugin-sharing` / `plugin-audit`. #6523 converged 36 contract signatures onto
  the complete `resolveAuthzContext` envelope, applying the #6206 ruling —
  enforcement adjudicates on the whole envelope, never a per-site subset. The
  implementations behind those contracts still annotated their own parameters
  with the six-field shape the contracts used to name, so nothing they could
  _read_ had widened.

  `ApprovalService`, the approval flow-node provider and `ReportService` now
  declare `ExecutionContext` on all 43 of those positions, and the casts the
  narrow annotation forced are gone:

  - `isOverrideActor()` read the derived `posture` (ADR-0095) through an
    unchecked `(context as any)`. That gate decides whether a platform or tenant
    admin may release a STUCK approval — one routed to an unstaffed position, the
    only in-product recovery from a permanently locked record — so an erasure sat
    directly on an enforcement input: a mistyped rung would have compiled and
    silently denied every override. It is a declared read now.
  - Both services' `SYSTEM_CTX` is typed as the envelope and passed as itself,
    retiring the `SYSTEM_CTX as unknown as …` double casts at the three sites
    that hand it to a contract method.
  - The `(context as any).userId` / `.tenantId` reads in `ApprovalService` now
    read declared fields.
  - `OwnerContextResolver` returns the envelope, which is what a scheduled report
    actually resolves for its owner (#2849 / #2980).

  **No runtime behaviour changes.** The values were always complete — this
  family's damage was type-side — so every gate answers exactly what it answered
  before. Method parameters only WIDEN what they accept, so no caller is
  affected, and no public export changes shape.

  Casts deliberately kept, and now documented where they sit: `organizationId`
  is not a field of the envelope at all — that spelling has its own history
  (#5858 / `check:org-identifier`) and was held out of this change by #7070. In
  `approval-node.ts` the single remaining assertion exists only because the
  literal names that key; it was reduced from `as unknown as …` to a single
  `as ExecutionContext`, which still requires the literal to be comparable to
  the envelope.

  Because a re-narrowed annotation would compile, ship and pass every test in
  these packages, the convergence is pinned by a new compile-time module per
  package, `exec-context-annotation.pin.ts`: it hands each parameter a fresh
  literal naming envelope-only fields (`posture`, `accessible_org_ids`,
  `org_user_ids`), which TypeScript's excess-property check rejects the moment a
  parameter narrows back, plus negative cases so a parameter erased to `any`
  cannot pass either.

  The exported `SharingExecutionContext` type itself is NOT removed here: it is
  defined in `packages/spec`, which is single-owner, so its retirement is a
  separate follow-up.

- d0d5205: refactor(core,plugin-audit,service-storage,plugin-reports): give the `__` operation-private-key convention a single owner (#7284)

  `withoutOperationPrivateKeys` — the rule that a consumer forwarding a caller's
  execution envelope to a question about a DIFFERENT object must first drop the
  `__`-prefixed keys plugin-security stamped for the operation in flight — had been
  hand-copied into three packages: `plugin-audit`'s comment access hooks (#7141),
  `service-storage`'s attachment access hooks (#7145) and `plugin-reports`' report
  service (#7204). Each carried its own `OPERATION_PRIVATE_KEY_PREFIX` and its own
  doc block, and the prose had already diverged while the code still agreed — the
  shape that makes a later divergence in behaviour hard to notice.

  The helper now lives once, in `@objectstack/core`
  (`security/operation-private-keys.ts`), exported from the package root. Core is
  the only candidate all three consumers already depend on: `plugin-security` is
  the producer of the convention and the most honest owner, but none of the three
  depends on it and a string-prefix filter does not justify three new dependency
  edges onto a plugin; `@objectstack/spec` is fenced off by Prime Directive #2. The
  new home sits beside `assemble-execution-context.ts`, which owns the other end of
  the same lifecycle — that file is where an `ExecutionContext` is built at a
  transport entry point, this one is where it is stripped back down before being
  forwarded.

  The full reasoning moved with the code rather than being thinned: which keys the
  middleware stamps and why each is a widening input, why they are dropped by
  PREFIX and never by a name list, and why the fresh copy is load-bearing in both
  directions. Each consumer keeps only its own local half — which object _its_
  gates actually ask about — and points at the shared home.

  No behaviour change: the three copies were byte-equivalent, and all three
  packages' suites pass unchanged. Two new pins at the home cover it — the rule's
  own behaviour, which no package-level test had ever asserted directly, and a
  repository-shape pin that turns red if a fourth file declares its own copy.

- cb466aa: Reports read with the caller's whole execution envelope, so a `group`-posture report no longer under-reports

  `executeReport` rebuilt a five-field projection of the caller's `ExecutionContext`
  (`userId` / `tenantId` / `positions` / `permissions` / `isSystem`) before handing it to
  the engine read that produces the report — while the method's own comment promised
  "reports execute with the caller's identity".

  **Before.** `accessible_org_ids` was not in that projection, and the engine reads it by
  name (`buildDriverOptions`, ADR-0105 D2 / #3623) to widen the driver's native tenant
  scope to the caller's whole membership set under the `group` tenancy posture. Absent, the
  drivers fall back to active-org equality — "fail toward isolation". So the identical query
  returned the membership union in an interactive list view and collapsed to the active org
  inside a **saved or scheduled** report: silently short rows, no error, nothing in the
  output saying so. Measured end-to-end on a real kernel + SQL driver: three rows across two
  member orgs came back as three interactively and two in the report, and a scheduled CSV
  digest emailed the owner the same two. `timezone` went the same way, so a read-time
  formula field resolved its calendar day in UTC instead of the caller's business timezone;
  `posture`, `org_user_ids`, `systemPermissions` and `onBehalfOf` were dropped too.

  **After.** The read receives the caller's envelope whole (the #6206 ruling — enforcement
  adjudicates on the whole `resolveAuthzContext` envelope, never a per-site subset), minus
  the `__`-prefixed keys plugin-security stamps for the operation in flight, and as a fresh
  object so a callee's stamp cannot write back into the caller's request context. The same
  shape `plugin-audit` (#7141) and `service-storage` (#7145) landed. Direction is unchanged
  outside `group`: the `isolated` posture, a deployment with no posture provider, and a
  `group` caller with an empty accessible set all still read at active-org equality.

- 2c2a212: fix(reports): owner-gate the saved-report schedule routes (#2980)

  The report read/run/delete routes are owner-isolated (a caller may only touch a
  report they own, denied as `REPORT_NOT_FOUND` to avoid leaking that the id
  exists), but the two schedule routes bypassed that gate: `unscheduleReport` and
  `listSchedules` took the caller `context` as `_context` and never consulted it,
  querying under the system context (RLS-bypassing). Any authenticated caller
  could therefore delete another owner's report schedule — a cross-owner
  destructive write — or list another owner's schedules (leaking recipient
  addresses and cron), by supplying an id.

  Both now resolve the schedule's parent report and require the caller to own it,
  mirroring the sibling routes:

  - **`unscheduleReport`** loads the schedule, then its report, and deletes only
    when `canAccessReport` holds; a cross-owner attempt throws `REPORT_NOT_FOUND`
    (mapped to `404` by the REST layer, deny-as-404 anti-enumeration), while a
    genuinely-absent schedule stays idempotent. `scheduleReport` (create) was
    already gated via `getReport`, so only the delete/list doors were open.
  - **`listSchedules`** returns an empty list to any non-system caller who cannot
    access the report it is scoped to — the same non-leaking posture as
    `listReports`. The scheduler's system context still sees every schedule.

  No authoring-surface or metadata change; existing owner-path behavior is
  unchanged.

- dadd1ad: refactor(spec,plugin-sharing): retire the exported `SharingExecutionContext` type (#7218)

  <!-- adr-0087: registered sharing-execution-context-retired -->

  **BREAKING — public surface removal.** `SharingExecutionContext` is deleted from
  `@objectstack/spec` (`contracts/sharing-service`) and from
  `@objectstack/plugin-sharing`, which re-exported it. Both `api-surface/` and
  `export-origins/` snapshots are regenerated accordingly.

  This is the deferred deletion recorded when #7070 split the convergence in two.
  #6523 / PR #7068 converged 36 contract signatures onto the full
  `resolveAuthzContext` envelope (`ExecutionContext`), applying the #6206 ruling —
  enforcement adjudicates on the whole envelope, never a per-site subset. The
  consumer halves then re-annotated the implementations: PR #7140 (identity:
  `plugin-sharing`, `plugin-audit`) and PR #7206 (services: `plugin-approvals`,
  `plugin-reports`). Both landed with the type still exported, because it is
  DEFINED in `packages/spec` and that package's retirement is the spec seat's to
  make. Nothing declares it any more, so it goes.

  **Migration.** Anyone who imported `SharingExecutionContext` from either package
  should import `ExecutionContext` from `@objectstack/spec` instead — the type the
  contracts have declared since #7068. The old shape was six optional fields, all
  of which exist on the envelope with the same names and types, so a value that
  satisfied the retired type already satisfies `ExecutionContext`; only the
  spelling of the annotation changes.

  **No runtime behaviour changes.** The type was erased at compile time and no
  signature's accepted shape moved: the contracts already took the wide envelope.

  **What the retirement did NOT remove — the reason to read the pins.** Deleting
  the type does not make re-narrowing a compile error. Structural subtyping still
  accepts a six-field context where the envelope is expected, so the boundary is
  held by the declared parameter type plus the pins, exactly as before. The three
  `exec-context-annotation.pin.ts` files (`plugin-sharing`, `plugin-approvals`,
  `plugin-reports`) told their failure story as "the parameter narrows back to
  `SharingExecutionContext`", which a deletion would have quietly hollowed out.
  Each now keeps the retired six-field shape as a local, non-exported SPECIMEN
  type and refutes every enforcement parameter against it by type identity, so a
  re-narrowing under ANY name is red — alongside the fresh-literal
  excess-property checks they already carried. `sharing-service.test.ts` in
  `packages/spec` is re-anchored the same way, and its "twin unchanged in shape"
  case becomes a "twin stays retired" case. The narrative the retired type's doc
  block carried (the measured `(context as any).posture` specimen, and why tsc
  cannot police this) moves to the module doc of `contracts/sharing-service`,
  which the contracts and pins now point at.

- 2465133: fix(plugins): sweep the service-lookup erasures out of the plugin composition roots, and fix the two alias-only HTTP reads it exposed (#4251 B5)

  Batch B5 of the #4251 sweep: the seven remaining `packages/plugins/*` composition
  roots. 35 lookup sites that had been erased to `any` now carry the slot's
  contract, so the compiler checks what each plugin actually calls on the service
  it resolved. The ratchet drops 143 sites / 32 files to 108 / 25.

  **Two real defects, both of the shape this sweep exists to find.** Approvals'
  actionable-link pages (ADR-0043) and sharing's public share-link REST routes each
  read the HTTP server under `http-server` _only_ — the deprecated alias. The
  ledger records `http.server` as canonical and as the only name present on every
  provider path: `runtime.ts`'s `config.server` path registers no alias at all. On
  that path both lookups threw, the surrounding `catch` swallowed it, and the
  routes silently never mounted — approval e-mail action links 404'd and the
  share-link surface was absent, with nothing in the log to say so. Both reads are
  now canonical-first with the alias as fallback, each name in its own `try`
  because `getService` throws on an empty slot (so `a() ?? b()` inside one `try`
  never reaches `b` — the same correction #4393 made in metadata and
  cloud-connection).

  Typing choices follow the batch method: pure data-plane consumers take the
  narrow contract (`IDataEngine` in reports), consumers that bind hook or
  middleware seams take the engine seen whole (`IObjectQLEngine` in approvals,
  sharing and pinyin-search), and slots with no contract get a **named** local
  surface rather than `any` — plugin-email's `MailSettingsSurface`, and the
  surfaces the consuming packages already declared (`ApprovalMessagingSurface`,
  `SharingSecurityProbe`, `ReportEmail`). A named surface that omits a member
  still makes the compiler name every call site; `any` says nothing.

  No behaviour change beyond the two alias reads. No contract changes.

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
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [5fa04fb]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
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
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
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
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
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
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [59c544d]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [61282f9]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/platform-objects@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [e98fb14]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [1b9a53b]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [f104bab]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
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
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
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
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
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
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
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
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/platform-objects@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2

## 17.0.0-rc.1

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- b5f9397: fix(sharing,runtime): a `sort` passed straight to the engine never ordered anything; migrate every in-repo engine call to canonical QueryAST keys (#4346)

  Two changes with different weights, from one sweep of every in-repo engine
  call site that still speaks a deprecated alias.

  **The bug — three dropped sorts.** #4346 made the engine fold `filter`→`where`
  and `top`→`limit` on all six methods. The other four pairs in
  `RPC_QUERY_ALIAS_SLOTS` (`select`, `sort`, `skip`, `populate`) are folded at
  the RPC/wire layer only — their values need shape lowering that belongs to
  those layers — and a **direct `engine.find()` never crosses that layer**. Three
  call sites passed `sort` there, so it rode onto the AST untouched, every
  driver's `Array.isArray(query.orderBy)` guard declined to emit an ORDER BY, and
  the query returned an ordinary-looking, arbitrarily-ordered result:

  | call site                           | asked for                                         | actually got                |
  | ----------------------------------- | ------------------------------------------------- | --------------------------- |
  | `share-link-routes.ts`              | shared AI conversation messages, `created_at asc` | messages in arbitrary order |
  | `runtime/domains/share-links.ts`    | same route, runtime-domain copy                   | same                        |
  | `share-link-service.ts` `listLinks` | the 200 most recent share links                   | an arbitrary 200            |

  All three combine the dropped sort with a `limit` — the "latest N" shape whose
  failure #4226 spelled out: an unapplied sort returns rows in arbitrary order,
  which `limit` then slices into an arbitrary page. #4226 fixed that in the wire
  normalizer; these calls sit one layer below it. `listLinks` had no test at all,
  which is why it went unnoticed. Now pinned — on the option bag the engine
  receives, not on row order, because the failure is that the key never becomes
  `orderBy` and a fake engine honouring either spelling would pass either way.

  **The cleanup — 27 no-op renames.** Every remaining in-repo engine call passing
  `filter` now passes `where` (approvals 5, auth 2, reports 6, sharing 11,
  webhooks 2, plus the one `filters` in a spec doc example). These are strict
  no-ops since #4346 folds the alias — the point is that the framework stops
  depending on a spelling it asks users to migrate off, which is a prerequisite
  for ever retiring the aliases. Service-level `filter` PARAMETERS (each
  service's own public API, e.g. `listRequests(filter)`) are deliberately
  untouched — those are not engine option bags.

  Two of the renamed calls were live victims of the #4346 bug rather than
  cosmetic: `auth-manager`'s `stampIdentitySource` read the table's first row via
  `findOne({filter})` and counted the whole table via `count({filter})`, so a
  federated sign-in never stamped `source: 'idp_provisioned'`. #4346 already
  corrected the behaviour; this makes the call say what it means.

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
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
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
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
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
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
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1

## 17.0.0-rc.0

### Major Changes

- 4ed7ed4: feat(security)!: the export axis is now OPT-IN, explainable, and covers reports (#3544, #3710)

  **BREAKING — `allowExport` unset no longer means "inherit read".** Reading a
  record and taking a bulk machine-readable copy of the whole table are different
  privileges (Salesforce "Export Reports", Dynamics "Export to Excel", NetSuite
  "Export Lists", SAP `S_GUI` 61 all separate them). The axis now says so.

  ### Migration — FROM → TO

  |                      | before                              | after                      |
  | -------------------- | ----------------------------------- | -------------------------- |
  | `allowExport` unset  | export **allowed** (inherited read) | export **denied**          |
  | `allowExport: false` | export denied                       | export denied (unchanged)  |
  | `allowExport: true`  | export allowed                      | export allowed (unchanged) |

  **The one-line fix:** add `allowExport: true` to the object entry (or the `'*'`
  wildcard) of every permission set whose holders should keep exporting.

  ```ts
  objects: {
    deal: { allowRead: true, allowExport: true },   // ← add the grant
  }
  ```

  Nothing else changes: read, CRUD, RLS, FLS and sharing are untouched, and a set
  that never exported is unaffected.

  **Who is affected.** Package-shipped sets are re-seeded on upgrade, so the
  built-ins are handled for you — `admin_full_access` and `organization_admin` now
  carry `allowExport: true` explicitly. **Environment-authored sets are not**: any
  custom set whose users export must be edited. `member_default` deliberately does
  NOT carry the grant, so ordinary authenticated users lose export until an admin
  grants it — that is the point of the flip, not an oversight.

  **Merge semantics.** Most-permissive, exactly like the CRUD bits: any set
  granting `true` grants export. `false` and unset are the same outcome; `false`
  is authoring intent, not a veto, because permission sets are additive capability
  containers (ADR-0090).

  **Not implied by super-user bits.** `viewAllRecords` / `modifyAllRecords` no
  longer confer export. Separating "may see all data" from "may take a bulk copy"
  is the segregation-of-duties case the axis exists for.

  ### Also in this change

  - **spec** — a set carrying `allowExport` is now **high-privilege**
    (`describeHighPrivilegeBits`), so it cannot be bound to the `everyone` /
    `guest` audience anchors. Without this the opt-in was defeatable by binding an
    export-granting set to `everyone`. One predicate, so the runtime anchor gate,
    the `@objectstack/lint` security-posture rule and the install-time suggestion
    surface all pick it up together.
  - **spec / plugin-security** — `ExplainOperationSchema` gains `export`, so
    `explain` can answer _why_ a caller got `403 EXPORT_NOT_PERMITTED`. It
    explains as `read ∧ the export grant`: `object_crud` reports the conjunction
    and attributes the granting set, while every data-shaped layer
    (requiredPermissions, OWD/depth/sharing, RLS, record attribution) is computed
    as the `find` the export actually performs — asking the RLS compiler about an
    `export` operation would match no policy and wrongly report "no RLS applies".
    `readFilter` is surfaced for `export` as it is for `read`.
  - **plugin-reports** — closes the reports side door (#3710). A report rendered
    as `csv`/`json` is the same bulk copy of the same object, so it is gated by
    the same `ISecurityService.canExport`. Enforced in `executeReport`, which the
    interactive run, the ad-hoc run and the scheduled dispatch all funnel through;
    `scheduleReport` additionally refuses at create time so an author is not told
    at 3am. A schedule created while granted stops delivering once the grant is
    revoked. `html_table` stays a read — it is a rendered view, not a bulk copy.
    Deployments without `plugin-security` are unaffected (no permission sets
    exist, so the axis does not apply).

### Patch Changes

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
- Updated dependencies [587fc91]
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
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
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
- Updated dependencies [524151c]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [d1cabaa]
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
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [67452d1]
- Updated dependencies [4921a95]
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
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [9aa5510]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/platform-objects@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
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
  - @objectstack/platform-objects@16.0.0
  - @objectstack/core@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
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
  - @objectstack/platform-objects@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/platform-objects@15.1.1

## 15.1.0

### Patch Changes

- f531a26: fix(security): close three execution-surface authz holes surfaced by the #2849 class sweep (#2980, #2981, #2982)

  Three independent, confirmed-exploitable defects where an execution surface
  ignored the caller's identity or fell open on a missing one. Each is fixed at
  its own enforcement point; none change behaviour for correctly-scoped callers.

  - **#2980 — reports IDOR + scheduled-report RLS bypass.** `ReportService`
    discarded the caller's context and read/wrote `sys_saved_report` with a system
    context, so any authenticated user could read, delete, or overwrite any saved
    report by id (cross-owner / cross-tenant), and `listReports` enumerated all
    owners. `getReport`/`deleteReport`/`saveReport`/`listReports` are now
    owner-scoped (system read of the protection-locked metadata object, but
    authorization enforced by owner match); create/overwrite can no longer spoof
    ownership. Scheduled dispatch no longer runs `isSystem` (which emailed the
    target object's entire table past the owner's RLS): it resolves the owner to a
    real RLS-bearing context via a new `resolveOwnerContext` seam and **fails
    closed** (skips + marks the schedule failed) when the owner can't be resolved,
    rather than running elevated. Wiring that resolver is the reports-surface
    consumer of ADR-0073's user-less identity resolution.

  - **#2981 — knowledge/RAG retrieval fall-open.** `applyPermissionFilter` returned
    every hit when the context was missing _or_ system. A missing identity is no
    longer treated as a grant: object-backed hits fail closed (dropped, keeping
    ACL-less file/http hits), and only an **explicit** system context passes
    through. Closes the agent path where an omitted `ToolExecutionContext.actor`
    yielded unfiltered semantic search over the whole corpus.

  - **#2982 — bulk-write OWD gap.** `update({multi:true})` / `deleteMany` had no
    single id to `canEdit`-gate, so owner scoping was skipped on private (and
    public_read) objects. A new `SharingService.buildWriteFilter` (the edit-set
    analogue of `buildReadFilter`) is AND-ed into the write AST for multi writes,
    constraining them to rows the caller may edit — including the on-behalf-of
    delegator intersection.

  Tracked as the motivating evidence of ADR-0096 (execution-surface identity
  admission); the mechanism that would prevent the class structurally is separate.

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
  - @objectstack/spec@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0

## 14.8.0

### Patch Changes

- 607aaf4: 导出文件名本地化 + 系统字段标签内置多语言回退。

  **`@objectstack/rest` — 导出下载文件名**:`GET /data/:object/export` 的 `Content-Disposition` 不再是裸的 `<对象名>.<扩展名>`,改为「对象显示名-时间戳」:ASCII 兜底用 API 名(`filename="contracts-20260714-153045.xlsx"`),本地化标签(如中文)按 RFC 5987/6266 编码进 `filename*=UTF-8''…`(浏览器直接下载得到 `合同-20260714-153045.xlsx`)。新增导出 `exportContentDisposition(objectName, label, ext, now?)`。

  **`@objectstack/spec` — 系统字段标签回退**:ObjectQL 注册表给每个对象注入的系统字段(`owner_id`/`created_at`/`created_by`/`updated_at`/`updated_by`)只带英文标签,自定义对象又没有对应的翻译条目,导致中文界面的列表表头、导出文件、导入模板里漏出 "Owner"/"Created At" 等英文。`translateObject` 现内置这五个字段的 en/zh-CN/ja-JP/es-ES 标签表(措辞与平台生成的翻译包一致),仅当字段仍是注入的英文默认值时套用——作者自定义的标签绝不覆盖;无翻译包时也生效(`translateObject` 不再因缺 bundle 而提前返回,REST 元数据翻译路径同步放宽,缓存 ETag 本就按 locale 分键,无缓存串味风险)。

  **`@objectstack/plugin-reports` — 附件文件名**:定时报表附件的文件名清洗从「非 ASCII 全部替换成 `_`」改为按 Unicode 字母/数字保留(`\p{L}\p{N}`),中文计划名不再变成一串下划线。

  **`@objectstack/rest` — 导入接受翻译后的选项标签(导出 ↔ 导入闭环)**:导出与导入模板写出的是*翻译后*的选项标签(如 `待规划`),但导入强制转换只认作者原始 schema 的标签/值,导致用户把自己刚导出的本地化文件原样导回时 select 字段全部报 `invalid_option`。`prepareImportRequest` 新增 `localizeSchema` 钩子(REST 导入路由传入 `translateMetaItem`),把当前 locale 的翻译标签合并进字段选项作为匹配同义词——作者标签与选项 code 照常匹配,非法值照常报错,翻译失败时降级为仅作者标签匹配。新增导出 `mergeLocalizedOptionSynonyms(metaMap, localizedMetaMap)`。

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/platform-objects@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
- Updated dependencies [8f23746]
- Updated dependencies [b97af7e]
- Updated dependencies [6da03ee]
  - @objectstack/spec@14.5.0
  - @objectstack/platform-objects@14.5.0
  - @objectstack/core@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/platform-objects@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [332b711]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
  - @objectstack/spec@14.0.0
  - @objectstack/platform-objects@14.0.0
  - @objectstack/core@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/platform-objects@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/platform-objects@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/platform-objects@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/platform-objects@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/platform-objects@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/platform-objects@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/platform-objects@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/platform-objects@12.0.0
  - @objectstack/core@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/platform-objects@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/platform-objects@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/platform-objects@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/platform-objects@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/platform-objects@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/platform-objects@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [cbc8c02]
- Updated dependencies [07c2773]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
- Updated dependencies [ab5718a]
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
- Updated dependencies [5737261]
- Updated dependencies [a619a3a]
- Updated dependencies [f44c1bd]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/platform-objects@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/platform-objects@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [7108ff3]
- Updated dependencies [30c0313]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [ae271d0]
- Updated dependencies [61ed5c7]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [0df063e]
- Updated dependencies [ce13bb8]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [47d978a]
  - @objectstack/spec@10.0.0
  - @objectstack/platform-objects@10.0.0
  - @objectstack/core@10.0.0

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
  - @objectstack/core@9.11.0
  - @objectstack/platform-objects@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/platform-objects@9.9.1

## 9.9.0

### Minor Changes

- d42004b: feat(reports): report schedules honor `cron_expression` + `timezone`

  `sys_report_schedule` has long carried `cron_expression` and `timezone` fields, but `ReportService` only ever advanced `next_run_at` by `interval_minutes` — both fields were stored and ignored. Scheduling now computes `next_run_at` from the cron expression (when present) in the schedule's timezone via `croner` — the same library the job scheduler uses — so "every weekday at 09:00 local" is expressible. `interval_minutes` remains the fallback.

  - `cron_expression` wins over `interval_minutes` when set (the field's documented contract).
  - Evaluated in `timezone` (default `UTC`).
  - `scheduleReport` validates the cron expression eagerly and rejects an invalid one with `VALIDATION_FAILED`, rather than silently falling back at sweep time. A cron that becomes unschedulable later is logged and falls back to the interval — it never throws into the dispatch sweep.

  The DB-polling dispatch model is unchanged; only the next-run computation is cron-aware. Part of ADR-0053 Phase 2 (#1983) but self-contained — report schedules run under a system context, so the timezone source is the schedule's own field, independent of the reference-timezone resolver.

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/platform-objects@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/platform-objects@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/platform-objects@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/platform-objects@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [5be7102]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/platform-objects@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/platform-objects@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/platform-objects@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/platform-objects@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/platform-objects@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/platform-objects@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/platform-objects@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/platform-objects@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/platform-objects@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/platform-objects@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [7ae6abc]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/platform-objects@7.4.1

## 7.4.0

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [4404572]
- Updated dependencies [eea3f1b]
- Updated dependencies [e478e0c]
- Updated dependencies [4cc2ced]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/platform-objects@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/platform-objects@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/platform-objects@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/platform-objects@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/platform-objects@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/platform-objects@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/platform-objects@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/platform-objects@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/platform-objects@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/platform-objects@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [888a5c1]
- Updated dependencies [2f9073a]
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/platform-objects@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/platform-objects@4.1.1

## 4.0.1

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0
