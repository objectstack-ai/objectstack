# @objectstack/example-crm

## 4.0.93

### Patch Changes

- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [ca2e020]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [e43d63a]
- Updated dependencies [e374b4d]
- Updated dependencies [a433122]
- Updated dependencies [bc6434b]
- Updated dependencies [96f397a]
- Updated dependencies [9aa8890]
- Updated dependencies [48032c9]
- Updated dependencies [7c9c1dd]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [6a51704]
- Updated dependencies [c766ec3]
- Updated dependencies [420804d]
- Updated dependencies [c8e85fc]
- Updated dependencies [3d61924]
- Updated dependencies [5244fd7]
- Updated dependencies [716ac9b]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [b2789ad]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [6aceca9]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [1e050a5]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [11b779e]
- Updated dependencies [739fe5b]
- Updated dependencies [20067c5]
- Updated dependencies [e783e16]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [4fc4a3c]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [17854cb]
- Updated dependencies [3851f87]
- Updated dependencies [09b880b]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [7fc01db]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [c86799f]
- Updated dependencies [5989b0d]
- Updated dependencies [19db5fa]
- Updated dependencies [2b9d33a]
- Updated dependencies [ad217b1]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/runtime@17.1.0

## 4.0.92

### Patch Changes

- 7e06f51: fix(example-crm): bind the three declared positions to `crm_sales_user` (#8060)

  `examples/app-crm/src/security/sales-positions.ts` declared three positions
  (`sales_rep`, `sales_manager`, `finance_approver`) and a `crm_sales_user`
  permission set, but nothing ever joined them — the app seeded no
  `sys_position_permission_set` rows, and `crm_sales_user` was not marked
  `isDefault` (which would have granted every user, not just the three
  positions). A user assigned any of the three positions therefore resolved
  only the platform `everyone` baseline and was 403'd on every CRM object.

  Mirrors `examples/app-showcase/src/security/bind-position-sets.ts`: a new
  `examples/app-crm/src/security/bind-position-sets.ts` binds the three
  positions to `crm_sales_user` imperatively on `kernel:bootstrapped` (a
  declarative seed can't do this — the seed loader runs before the security
  bootstrap creates the `sys_position`/`sys_permission_set` rows), wired via a
  new `onEnable` export in `objectstack.config.ts`.

  Measured with `objectstack verify --app examples/app-crm/objectstack.config.ts
--rls`: the three per-position probe personas went from 18-of-18
  `probe-blocked` (no object grant at all — the by-id-write class was never
  exercised) to 3 `probe-blocked` (one per persona: `crm_opportunity_line_item`,
  which `crm_sales_user` does not grant — a separate, pre-existing gap, not
  addressed here). Zero RLS holes introduced or found.

- c4624f0: fix(example-crm): grant `crm_opportunity_line_item` in `crm_sales_user`, matching its master `crm_opportunity` (#8164)

  `crm_opportunity_line_item` is a master-detail CHILD of `crm_opportunity`
  (`sharingModel: 'controlled_by_parent'`, `inlineEdit: 'grid'` on the
  Opportunity form), but `crm_sales_user` — the app's only non-guest
  permission set — granted object-level CRUD on 5 CRM objects and never the
  line item. Record-level access always follows the master (ADR-0055), but
  object-level CRUD is a SEPARATE gate the platform never derives: every
  role-bound (non-admin) user, including the three positions this app ships
  to demonstrate selling, got a silent 403 the moment they tried to add or
  edit a product line on an Opportunity they otherwise fully own. The
  platform's own build-time lint (`security-master-detail-ungranted`) already
  flagged this independently.

  Added `crm_opportunity_line_item` to `crm_sales_user`'s `objects` map with
  the exact same grant shape as its master `crm_opportunity`
  (`{ allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false }`)
  — the line item's own access is meant to follow its master, not invent an
  independent policy.

  Measured with `objectstack verify --app examples/app-crm/objectstack.config.ts
--rls`: every position persona's `probeBlocked` count dropped from 1 (the
  line item, the sole remaining gap left open by #8060) to 0, with zero RLS
  holes introduced or found. The build's `security-master-detail-ungranted`
  warning for this object is gone.

- 450f3e5: fix(examples): name the form/page sections that had a label but no `name`, and translate the headings into zh-CN (#8231)

  `translation-section-name-missing` fired on every build of both example apps: a
  form or `record:details` section that declares a `label` but no `name` has no
  key a bundle can carry (`objects.<object>._sections.<name>.label`), so its
  heading renders in the source locale in EVERY locale — permanently, and
  invisibly, because every neighbouring field label on the same object
  translates fine. `app-crm` ships en + zh-CN; `app-showcase` ships the same.

  21 of the 24 flagged sections now declare a stable snake_case `name` and
  resolve a real (non-echoed) zh-CN label:

  - **app-crm** (9/9): `crm_activity` (`activity_details`, `related_records`,
    `notes`), `crm_lead` (`contact_us`, `lead_information`, `qualification`,
    `conversion`, `notes`), `crm_opportunity` (`opportunity`).
  - **app-showcase** (12/15): `showcase_project` form (`project`,
    `budget_schedule`) and its detail page (`overview`, `financials`,
    `timeline`); `showcase_task`'s detail page (`overview`, `schedule`,
    `details` — reusing the same names and zh-CN copy its `tabbed` form view
    already declares, so no new bundle entries were needed there);
    `showcase_inquiry` (`tell_us_about_yourself`); `showcase_business_unit`
    (`unit`); `showcase_preference`'s settings page (`appearance`,
    `notifications`).

  **Not named here — a `packages/**`conflict, out of this PR's scope.** Three`app-showcase` sections (`showcase_task`'s `formViews.edit`/`Task`and`formViews.quick`/`Quick Edit`, `showcase_contact`'s `formViews.create`/`Who is
  this?`) are pinned NAMELESS as regression fixtures by
`packages/lint/src/validate-translatable-sections.test.ts`and`validate-translation-references.test.ts`, which import `TaskViews`/`ContactViews`directly from this app and assert on their current unnamed
shape. Naming them requires a coordinated`packages/lint` test update; #8231
  remains open for that follow-up.

  Adding a `name` alone would have silenced the warning with zero translation
  delivered, so both apps also gain a generalized i18n-coverage sweep test
  (`examples/app-crm/test/i18n-sections.test.ts`,
  `examples/app-showcase/test/seed.test.ts`) asserting every section this PR
  touches BOTH has a `name` AND resolves a real, non-ASCII zh-CN
  `_sections.<name>.label` — not just that the section has a name.

- e533b0b: feat(spec)!: retire `datasource.capabilities` — eleven flags nothing read, one of them a safety claim (#4583)

  `DatasourceCapabilities` declared eleven booleans — `transactions`, seven `query*`
  flags, `joins`, `fullTextSearch`, `readOnly`, `dynamicSchema` — all strict-guarded,
  all read by nothing. Pushdown is decided by the runtime driver's own `supports.*`
  object, a different mechanism entirely, so a datasource declaring
  `queryAggregations: false` never once changed which engine path ran. The block is
  removed rather than bridged: there was nothing on the other side to connect it to.

  **`readOnly` is why this is not tidy-up.** It reads as a safety property and was
  authored as one — the shipped CRM example labelled a datasource "CRM Analytics Read
  Replica" on the strength of it, while the datasource accepted writes exactly like the
  primary. The key had already been MOVED twice toward somewhere it might be enforced,
  out of `config` in #4410 and into `capabilities` in #4465, and was inert at every
  address. This removes it instead of moving it a third time.

  **Removing it does not hand you a working replacement, and the rejection says so.**
  The one enforced datasource-wide write gate is `external.allowWrites: false`, and it
  applies only to a FEDERATED datasource — `assertWriteAllowed` returns early for a
  `managed` (or unset-`schemaMode`) datasource, so that key would be equally inert for a
  local database. **A managed datasource has no read-only gate at all**; that gap is
  #4584, deliberately not invented here. Until it is answered, enforce read-only where
  it is real: grant the connection SELECT-only at the database.

  FROM → TO:

  ```ts
  // before — parsed cleanly, changed nothing
  defineDatasource({
    name: 'analytics', driver: 'sqlite', config: { filename: ':memory:' },
    capabilities: { readOnly: true, queryAggregations: true },
  })

  // after — delete the block; for a FEDERATED datasource the enforced gate is:
  defineDatasource({
    name: 'warehouse', driver: 'postgres', config: { … },
    schemaMode: 'external',
    external: { allowWrites: false },
  })
  ```

  `os migrate meta --from 16` rewrites it automatically (ADR-0087 conversion
  `datasource-capabilities-removed`). Both `DatasourceSchema` and
  `DriverDefinitionSchema` are `.strict()`, so a leftover key is a loud rejection
  carrying the prescription — never a silent strip.

  Also fixed: `READ_ONLY_BELONGS_ON_DATASOURCE`, the prescription every SQL driver
  shares for a `readOnly` written inside `config`, was still sending authors _to_ the
  removed key. It now names the enforced gate and states plainly where that gate does
  not apply — a prescription that lands on an inert key manufactures exactly the belief
  it was meant to correct.

  The `datasource` liveness ledger drops from 20 dead properties to 9 (remaining:
  `healthCheck` ×3, `retryPolicy` ×4, `external` ×2 — batches B/C/D of #4583).

- 5293114: fix(automation): a decision's three declared ways to route a branch are now one working model (#4414)

  A `decision` node advertised three mechanisms for splitting a path and only one
  of them did anything. The other two were the ADR-0049 `declared ≠ enforced`
  shape, and the pair of them shipped a guard that does not guard in
  `examples/app-crm`.

  | mechanism                                            | before                                                                                                 | now                                                   |
  | :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------- | :---------------------------------------------------- |
  | `edge.condition`                                     | ✅ the only one that worked                                                                            | unchanged                                             |
  | `edge.isDefault`                                     | **zero readers** anywhere but the schema declaration                                                   | BPMN default flow, enforced in `traverseNext`         |
  | `decision.config.conditions[].label` → `branchLabel` | matched **0** out-edge labels across every example app, then fell back to the full edge set in silence | routes; an unclaimable label is logged, not swallowed |

  ## What was broken, end to end

  `crm_convert_lead_wizard` means "already converted → abort screen; otherwise →
  the wizard". It ran **both**: an already-converted lead got
  "This lead has already been converted" and then walked straight into the
  conversion wizard behind it. Four independent silences stacked up:

  1. the decision's first condition was authored `{lead_record.status} ==
'converted'` — braces in a slot declared bare CEL, so it was string-compared
     and never true;
  2. the second (`'true'`) therefore won, yielding `branchLabel: 'No — proceed'`;
  3. no out-edge carried that label (they were `'Yes'` / `'No'`), so traversal
     discarded the branch and considered every out-edge;
  4. `e3b` was unconditional, so it ran regardless — and the natural fix, marking
     it `isDefault: true`, was a dead key.

  ## The model

  `branchLabel` narrows the edge set → `condition` gates each edge → `isDefault`
  catches whatever is left. Concretely:

  - **`isDefault` is enforced.** A default edge is traversed only when no
    conditional sibling of the same source node matched, and it is no longer part
    of the unconditional parallel fan-out — that distinction is the whole point of
    the marker. Passed over because a real branch won, its target records the same
    `skipped` step a closed gate does (#4354).
  - **An unclaimable branch label warns.** Traversal still falls back to the full
    edge set (a run mid-flight must not die on a metadata error) but says so,
    naming the computed branch and the out-edge labels that exist.
  - **A decision that declares no `conditions` reports no branch.** It used to
    report `'default'` unconditionally — a label no out-edge in the repo ever
    carried — which is why every decision node fell back to the full edge set.
    The `'default'` sentinel survives for the case it actually describes (declared
    conditions, none matched) and is now claimed by the `isDefault` edge as well
    as by an edge literally labelled `'default'`.
  - **`conditions[].expression` is evaluated as the bare CEL it is declared to
    be.** The raw string went to the legacy `{var}` template path, where
    `lead.status == 'converted'` cannot resolve and the branch is decided by
    string comparison. Unlike `edge.condition` this slot carries no
    `ExpressionInput` envelope — the decision descriptor is deliberately
    schemaless — so the executor supplies the dialect. A brace-in-CEL predicate
    now fails loudly (ADR-0032 §1c) instead of deciding `false`.

  ## Caught at authoring time too

  Four new `os build` / `os validate` warnings, because a wrong route is silent at
  run time by nature (Prime Directive #12):

  `flow-branch-label-unmatched` (the shipped shape),
  `flow-decision-unconditional-branch` (a guarded decision with an unconditional
  sibling — the actual hole), `flow-default-edge-with-condition` and
  `flow-multiple-default-edges`.

  Both of the first two fire on the pre-fix `convert-lead.flow.ts` and are silent
  after it.

  ## Effect on flows that already exist

  Enforcing `isDefault` changes how a **stored** flow behaves, and the flows it
  changes are mostly Studio's own. `objectui`'s flow edge inspector has always
  written `isDefault: true` when you bind an out-edge to a decision's default/else
  branch — into a key with zero readers, so that edge ran unconditionally, in
  parallel with whichever branch actually matched. Those flows now take exactly
  one branch. That is the fix, but it is a behaviour change on existing data
  rather than only on newly authored metadata, so it is worth knowing before
  upgrading: a flow that quietly ran two paths will now run one.

  Nothing changes for an edge that never carried the marker — `isDefault` defaults
  to `false`, and an ordinary unconditional out-edge still fans out in parallel
  exactly as before.

  ## The example app

  `crm_convert_lead_wizard`'s guard is now a plain exclusive gateway: the
  redundant `config.conditions` is gone and `e3b` carries `isDefault: true`. One
  mechanism per decision, and exactly one branch runs.

  Verified: 11 new engine/executor tests (including the reported repro in both
  directions), 12 new linter tests; `@objectstack/service-automation` 577 tests
  and `@objectstack/cli` 652 tests green, all three example apps build with no new
  findings.

- c6b6bb4: docs(spec): managed-datasource read-only is a database privilege, and the platform will not add a flag (#4584)

  #4583 removed `datasource.capabilities.readOnly` and left a gap open in its
  rejection message: `external.allowWrites: false` is the one enforced write gate
  and it covers only FEDERATED datasources, so a **managed** datasource had no
  read-only gate at all. The rejection pointed at #4584 and said "tracked". #4584
  is now answered, and the answer is that this stays so **on purpose**:

  > **方案 B —— 不建平台层只读闸门，文档明确记录**。
  > 一个只拦 ObjectQL 写路径、拦不住直连/迁移/DDL 的位，是「看起来存在的能力」——
  > #4583 刚删掉的 `capabilities.readOnly` 就是这个形状，不再造第二遍。真只读属于
  > 数据库账号权限（GRANT SELECT），那里没有绕行面。

  Read-only for a database ObjectStack owns is a **database account privilege** —
  `GRANT SELECT`. An ObjectQL-level flag would stop writes on one path and leave a
  direct `psql` session, a migration, a `syncSchema()` DDL statement and any
  process sharing the connection string untouched. A boundary that holds in one
  path is not a boundary, and one that looks like a boundary is worse than none
  because it gets trusted — which is exactly the defect #4583 removed.

  Documentation-only. No schema shape changes; the `capabilities.readOnly`
  tombstone now carries the answer instead of an open issue reference:

  - **Database Drivers** gains _Read-only: grant it at the database, not in
    metadata_ (a worked `GRANT SELECT` account, the DDL/schema-sync consequence, why
    the platform declines the flag, and a table of what actually enforces what)
    and _Read replicas: the platform does not route_ — the #4479 dual conclusion:
    no query path separates reads from writes, so put replicas behind pgpool /
    ProxySQL / an RDS reader endpoint and point `config` there. That is the
    correct answer, not a stopgap.
  - **External Datasources** now says plainly that the double opt-in write gate is
    federation-only, and that the parse rejects an `external` block on a `managed`
    datasource.
  - `example-crm`'s `crm_analytics` header comment recorded the ruling instead of
    waiting on it.

- Updated dependencies [50616d9]
- Updated dependencies [bc35e00]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [6e141bc]
- Updated dependencies [9fe9c1d]
- Updated dependencies [da5d1b4]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [30536e3]
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
- Updated dependencies [a4e2684]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [739f496]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [0c90ece]
- Updated dependencies [195ad76]
- Updated dependencies [c2bbd97]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [698cbc2]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [ffb003c]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fa1827]
- Updated dependencies [6fdc5c6]
- Updated dependencies [0e79785]
- Updated dependencies [8b9d71e]
- Updated dependencies [7e7a605]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [6877e9a]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [0f12193]
- Updated dependencies [0bab8bb]
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [3c8cfd1]
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
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [116c0d9]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [9f747ee]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [c546c89]
- Updated dependencies [57a3bb3]
- Updated dependencies [627e65a]
- Updated dependencies [4c5df00]
- Updated dependencies [b16dcb4]
- Updated dependencies [22df871]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [ac37fc6]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [f7d80f4]
- Updated dependencies [fce14ab]
- Updated dependencies [43ca399]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [7309c81]
- Updated dependencies [d3f2ff6]
- Updated dependencies [b7550d6]
- Updated dependencies [0164f40]
- Updated dependencies [e295ad1]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
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
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [4ff8abf]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [121852d]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [e38db3d]
- Updated dependencies [a225ef5]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [48c110e]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [63b33e6]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [c9d254a]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [ff17642]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [c3bcb42]
- Updated dependencies [19e3e6e]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [7bf3d1c]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [b3de0dd]
- Updated dependencies [20bc357]
- Updated dependencies [0373d52]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [4f30943]
- Updated dependencies [db9c331]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [217b791]
- Updated dependencies [bb192c4]
- Updated dependencies [fd8521f]
- Updated dependencies [35b36f2]
- Updated dependencies [86e6f6c]
- Updated dependencies [cbedd62]
- Updated dependencies [19aaf4b]
- Updated dependencies [0e4a7fb]
- Updated dependencies [98e7cc7]
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
- Updated dependencies [4cf7c61]
- Updated dependencies [f505689]
- Updated dependencies [76682cb]
- Updated dependencies [d9fa683]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [347f460]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [18b8eaa]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [8a341a4]
- Updated dependencies [78adc2e]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [81e2744]
- Updated dependencies [277eb36]
- Updated dependencies [41e605e]
- Updated dependencies [2649ccb]
- Updated dependencies [1eb13a0]
- Updated dependencies [a70cd0a]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [881a3cc]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [385c4b0]
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
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [d9cac60]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [7674859]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [db59e9c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [d127ff0]
- Updated dependencies [af05400]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [c51ffa5]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [fa48973]
- Updated dependencies [cf7c694]
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
- Updated dependencies [b508244]
- Updated dependencies [6146b67]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [99b4392]
- Updated dependencies [591f675]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [8aacf94]
- Updated dependencies [d56012f]
- Updated dependencies [73648ba]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [a954634]
- Updated dependencies [2a6c279]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [7180ed5]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [33a5ff4]
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [8fbed3b]
- Updated dependencies [083c414]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [b295e4b]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [91eddca]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [7dbf4c3]
- Updated dependencies [e15e679]
- Updated dependencies [2ddba89]
- Updated dependencies [2ab1257]
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
- Updated dependencies [ef7845a]
- Updated dependencies [4cc4fb7]
- Updated dependencies [9b2d720]
- Updated dependencies [95ef5c0]
- Updated dependencies [97b6658]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [1fa224a]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [8e08bc3]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [3ba8d77]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [3d5f726]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [70a1ce1]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [a3cb9c8]
- Updated dependencies [e87fea1]
- Updated dependencies [4be9d99]
- Updated dependencies [c65e529]
- Updated dependencies [8dcc0f5]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [5b08389]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [48d5a1c]
- Updated dependencies [cc3555e]
- Updated dependencies [f8fe47e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [5c13368]
- Updated dependencies [3216344]
- Updated dependencies [f5bfac8]
- Updated dependencies [6163393]
- Updated dependencies [688e9df]
- Updated dependencies [8f124a7]
- Updated dependencies [21ca1d5]
- Updated dependencies [03b11e8]
- Updated dependencies [89d7b35]
- Updated dependencies [0cd08d5]
- Updated dependencies [8891f93]
- Updated dependencies [6155c3c]
- Updated dependencies [d729a31]
- Updated dependencies [b30963d]
- Updated dependencies [cb8322e]
- Updated dependencies [94f7b6a]
- Updated dependencies [1d5dc46]
- Updated dependencies [d13f627]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [86d2e5e]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [810a3a2]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [9981c1d]
- Updated dependencies [d60968c]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [1e38158]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [0996899]
- Updated dependencies [de6daa5]
- Updated dependencies [378d8b1]
- Updated dependencies [3510e4a]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
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
- Updated dependencies [6f23667]
- Updated dependencies [cca11e9]
- Updated dependencies [cfb549d]
- Updated dependencies [77a77fd]
- Updated dependencies [d82f8c0]
- Updated dependencies [cde1975]
- Updated dependencies [e231abb]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
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
- Updated dependencies [ee264b2]
- Updated dependencies [2053714]
- Updated dependencies [60b672e]
- Updated dependencies [6b441a8]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [7309c81]
- Updated dependencies [f8cfbb4]
- Updated dependencies [5aaa6fc]
- Updated dependencies [dca5bd3]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecf0bef]
- Updated dependencies [68f5ecc]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [43fc039]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [bd5fc38]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
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
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
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
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
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
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0
  - @objectstack/runtime@17.0.0

## 4.0.92-rc.5

### Patch Changes

- c6b6bb4: docs(spec): managed-datasource read-only is a database privilege, and the platform will not add a flag (#4584)

  #4583 removed `datasource.capabilities.readOnly` and left a gap open in its
  rejection message: `external.allowWrites: false` is the one enforced write gate
  and it covers only FEDERATED datasources, so a **managed** datasource had no
  read-only gate at all. The rejection pointed at #4584 and said "tracked". #4584
  is now answered, and the answer is that this stays so **on purpose**:

  > **方案 B —— 不建平台层只读闸门，文档明确记录**。
  > 一个只拦 ObjectQL 写路径、拦不住直连/迁移/DDL 的位，是「看起来存在的能力」——
  > #4583 刚删掉的 `capabilities.readOnly` 就是这个形状，不再造第二遍。真只读属于
  > 数据库账号权限（GRANT SELECT），那里没有绕行面。

  Read-only for a database ObjectStack owns is a **database account privilege** —
  `GRANT SELECT`. An ObjectQL-level flag would stop writes on one path and leave a
  direct `psql` session, a migration, a `syncSchema()` DDL statement and any
  process sharing the connection string untouched. A boundary that holds in one
  path is not a boundary, and one that looks like a boundary is worse than none
  because it gets trusted — which is exactly the defect #4583 removed.

  Documentation-only. No schema shape changes; the `capabilities.readOnly`
  tombstone now carries the answer instead of an open issue reference:

  - **Database Drivers** gains _Read-only: grant it at the database, not in
    metadata_ (a worked `GRANT SELECT` account, the DDL/schema-sync consequence, why
    the platform declines the flag, and a table of what actually enforces what)
    and _Read replicas: the platform does not route_ — the #4479 dual conclusion:
    no query path separates reads from writes, so put replicas behind pgpool /
    ProxySQL / an RDS reader endpoint and point `config` there. That is the
    correct answer, not a stopgap.
  - **External Datasources** now says plainly that the double opt-in write gate is
    federation-only, and that the parse rejects an `external` block on a `managed`
    datasource.
  - `example-crm`'s `crm_analytics` header comment recorded the ruling instead of
    waiting on it.

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
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [4c5df00]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [f7d80f4]
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
- Updated dependencies [121852d]
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
- Updated dependencies [86e6f6c]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
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
- Updated dependencies [db59e9c]
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
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [c51ffa5]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [6146b67]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [73648ba]
- Updated dependencies [a954634]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [8fbed3b]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [b295e4b]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [1fa224a]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [f8fe47e]
- Updated dependencies [89d7b35]
- Updated dependencies [6155c3c]
- Updated dependencies [d13f627]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [0996899]
- Updated dependencies [378d8b1]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [cca11e9]
- Updated dependencies [cfb549d]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [68f5ecc]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [bd5fc38]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/runtime@17.0.0-rc.6

## 4.0.92-rc.4

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/runtime@17.0.0-rc.5

## 4.0.92-rc.3

### Patch Changes

- Updated dependencies [9fe9c1d]
- Updated dependencies [da5d1b4]
- Updated dependencies [d4e0809]
- Updated dependencies [739f496]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [9f747ee]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [43ca399]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [7bf3d1c]
- Updated dependencies [db9c331]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [217b791]
- Updated dependencies [fd8521f]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [18b8eaa]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [78adc2e]
- Updated dependencies [81e2744]
- Updated dependencies [277eb36]
- Updated dependencies [41e605e]
- Updated dependencies [2649ccb]
- Updated dependencies [1eb13a0]
- Updated dependencies [a70cd0a]
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
- Updated dependencies [d9cac60]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [2ddba89]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [ef7845a]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [0cd08d5]
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
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [5aaa6fc]
- Updated dependencies [dca5bd3]
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
  - @objectstack/runtime@17.0.0-rc.4

## 4.0.92-rc.2

### Patch Changes

- e533b0b: feat(spec)!: retire `datasource.capabilities` — eleven flags nothing read, one of them a safety claim (#4583)

  `DatasourceCapabilities` declared eleven booleans — `transactions`, seven `query*`
  flags, `joins`, `fullTextSearch`, `readOnly`, `dynamicSchema` — all strict-guarded,
  all read by nothing. Pushdown is decided by the runtime driver's own `supports.*`
  object, a different mechanism entirely, so a datasource declaring
  `queryAggregations: false` never once changed which engine path ran. The block is
  removed rather than bridged: there was nothing on the other side to connect it to.

  **`readOnly` is why this is not tidy-up.** It reads as a safety property and was
  authored as one — the shipped CRM example labelled a datasource "CRM Analytics Read
  Replica" on the strength of it, while the datasource accepted writes exactly like the
  primary. The key had already been MOVED twice toward somewhere it might be enforced,
  out of `config` in #4410 and into `capabilities` in #4465, and was inert at every
  address. This removes it instead of moving it a third time.

  **Removing it does not hand you a working replacement, and the rejection says so.**
  The one enforced datasource-wide write gate is `external.allowWrites: false`, and it
  applies only to a FEDERATED datasource — `assertWriteAllowed` returns early for a
  `managed` (or unset-`schemaMode`) datasource, so that key would be equally inert for a
  local database. **A managed datasource has no read-only gate at all**; that gap is
  #4584, deliberately not invented here. Until it is answered, enforce read-only where
  it is real: grant the connection SELECT-only at the database.

  FROM → TO:

  ```ts
  // before — parsed cleanly, changed nothing
  defineDatasource({
    name: 'analytics', driver: 'sqlite', config: { filename: ':memory:' },
    capabilities: { readOnly: true, queryAggregations: true },
  })

  // after — delete the block; for a FEDERATED datasource the enforced gate is:
  defineDatasource({
    name: 'warehouse', driver: 'postgres', config: { … },
    schemaMode: 'external',
    external: { allowWrites: false },
  })
  ```

  `os migrate meta --from 16` rewrites it automatically (ADR-0087 conversion
  `datasource-capabilities-removed`). Both `DatasourceSchema` and
  `DriverDefinitionSchema` are `.strict()`, so a leftover key is a loud rejection
  carrying the prescription — never a silent strip.

  Also fixed: `READ_ONLY_BELONGS_ON_DATASOURCE`, the prescription every SQL driver
  shares for a `readOnly` written inside `config`, was still sending authors _to_ the
  removed key. It now names the enforced gate and states plainly where that gate does
  not apply — a prescription that lands on an inert key manufactures exactly the belief
  it was meant to correct.

  The `datasource` liveness ledger drops from 20 dead properties to 9 (remaining:
  `healthCheck` ×3, `retryPolicy` ×4, `external` ×2 — batches B/C/D of #4583).

- 5293114: fix(automation): a decision's three declared ways to route a branch are now one working model (#4414)

  A `decision` node advertised three mechanisms for splitting a path and only one
  of them did anything. The other two were the ADR-0049 `declared ≠ enforced`
  shape, and the pair of them shipped a guard that does not guard in
  `examples/app-crm`.

  | mechanism                                            | before                                                                                                 | now                                                   |
  | :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------- | :---------------------------------------------------- |
  | `edge.condition`                                     | ✅ the only one that worked                                                                            | unchanged                                             |
  | `edge.isDefault`                                     | **zero readers** anywhere but the schema declaration                                                   | BPMN default flow, enforced in `traverseNext`         |
  | `decision.config.conditions[].label` → `branchLabel` | matched **0** out-edge labels across every example app, then fell back to the full edge set in silence | routes; an unclaimable label is logged, not swallowed |

  ## What was broken, end to end

  `crm_convert_lead_wizard` means "already converted → abort screen; otherwise →
  the wizard". It ran **both**: an already-converted lead got
  "This lead has already been converted" and then walked straight into the
  conversion wizard behind it. Four independent silences stacked up:

  1. the decision's first condition was authored `{lead_record.status} ==
'converted'` — braces in a slot declared bare CEL, so it was string-compared
     and never true;
  2. the second (`'true'`) therefore won, yielding `branchLabel: 'No — proceed'`;
  3. no out-edge carried that label (they were `'Yes'` / `'No'`), so traversal
     discarded the branch and considered every out-edge;
  4. `e3b` was unconditional, so it ran regardless — and the natural fix, marking
     it `isDefault: true`, was a dead key.

  ## The model

  `branchLabel` narrows the edge set → `condition` gates each edge → `isDefault`
  catches whatever is left. Concretely:

  - **`isDefault` is enforced.** A default edge is traversed only when no
    conditional sibling of the same source node matched, and it is no longer part
    of the unconditional parallel fan-out — that distinction is the whole point of
    the marker. Passed over because a real branch won, its target records the same
    `skipped` step a closed gate does (#4354).
  - **An unclaimable branch label warns.** Traversal still falls back to the full
    edge set (a run mid-flight must not die on a metadata error) but says so,
    naming the computed branch and the out-edge labels that exist.
  - **A decision that declares no `conditions` reports no branch.** It used to
    report `'default'` unconditionally — a label no out-edge in the repo ever
    carried — which is why every decision node fell back to the full edge set.
    The `'default'` sentinel survives for the case it actually describes (declared
    conditions, none matched) and is now claimed by the `isDefault` edge as well
    as by an edge literally labelled `'default'`.
  - **`conditions[].expression` is evaluated as the bare CEL it is declared to
    be.** The raw string went to the legacy `{var}` template path, where
    `lead.status == 'converted'` cannot resolve and the branch is decided by
    string comparison. Unlike `edge.condition` this slot carries no
    `ExpressionInput` envelope — the decision descriptor is deliberately
    schemaless — so the executor supplies the dialect. A brace-in-CEL predicate
    now fails loudly (ADR-0032 §1c) instead of deciding `false`.

  ## Caught at authoring time too

  Four new `os build` / `os validate` warnings, because a wrong route is silent at
  run time by nature (Prime Directive #12):

  `flow-branch-label-unmatched` (the shipped shape),
  `flow-decision-unconditional-branch` (a guarded decision with an unconditional
  sibling — the actual hole), `flow-default-edge-with-condition` and
  `flow-multiple-default-edges`.

  Both of the first two fire on the pre-fix `convert-lead.flow.ts` and are silent
  after it.

  ## Effect on flows that already exist

  Enforcing `isDefault` changes how a **stored** flow behaves, and the flows it
  changes are mostly Studio's own. `objectui`'s flow edge inspector has always
  written `isDefault: true` when you bind an out-edge to a decision's default/else
  branch — into a key with zero readers, so that edge ran unconditionally, in
  parallel with whichever branch actually matched. Those flows now take exactly
  one branch. That is the fix, but it is a behaviour change on existing data
  rather than only on newly authored metadata, so it is worth knowing before
  upgrading: a flow that quietly ran two paths will now run one.

  Nothing changes for an edge that never carried the marker — `isDefault` defaults
  to `false`, and an ordinary unconditional out-edge still fans out in parallel
  exactly as before.

  ## The example app

  `crm_convert_lead_wizard`'s guard is now a plain exclusive gateway: the
  redundant `config.conditions` is gone and `e3b` carries `isDefault: true`. One
  mechanism per decision, and exactly one branch runs.

  Verified: 11 new engine/executor tests (including the reported repro in both
  directions), 12 new linter tests; `@objectstack/service-automation` 577 tests
  and `@objectstack/cli` 652 tests green, all three example apps build with no new
  findings.

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [e6b1b69]
- Updated dependencies [7e7a605]
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
- Updated dependencies [63b33e6]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [ff17642]
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
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [8aacf94]
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
  - @objectstack/runtime@17.0.0-rc.2
  - @objectstack/spec@17.0.0-rc.2

## 4.0.92-rc.1

### Patch Changes

- Updated dependencies [bc35e00]
- Updated dependencies [6a67d7a]
- Updated dependencies [6e141bc]
- Updated dependencies [48fcf70]
- Updated dependencies [0ecc656]
- Updated dependencies [a4e2684]
- Updated dependencies [06772eb]
- Updated dependencies [0c90ece]
- Updated dependencies [195ad76]
- Updated dependencies [c2bbd97]
- Updated dependencies [698cbc2]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [ffb003c]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [6fa1827]
- Updated dependencies [05154a1]
- Updated dependencies [0f12193]
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
- Updated dependencies [fce14ab]
- Updated dependencies [2e836de]
- Updated dependencies [7309c81]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [a225ef5]
- Updated dependencies [c9d254a]
- Updated dependencies [c8124e5]
- Updated dependencies [c3bcb42]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [217e2e6]
- Updated dependencies [0373d52]
- Updated dependencies [4f30943]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [bb192c4]
- Updated dependencies [98e7cc7]
- Updated dependencies [4cf7c61]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [347f460]
- Updated dependencies [8a341a4]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [385c4b0]
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
- Updated dependencies [99b4392]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [33a5ff4]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
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
- Updated dependencies [3ba8d77]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [a3cb9c8]
- Updated dependencies [e87fea1]
- Updated dependencies [4be9d99]
- Updated dependencies [c65e529]
- Updated dependencies [8dcc0f5]
- Updated dependencies [5b08389]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [5c13368]
- Updated dependencies [1d5dc46]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [1e38158]
- Updated dependencies [65a3a84]
- Updated dependencies [de6daa5]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [77a77fd]
- Updated dependencies [d82f8c0]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [2053714]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [7309c81]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [43fc039]
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
  - @objectstack/runtime@17.0.0-rc.1
  - @objectstack/spec@17.0.0-rc.1

## 4.0.92-rc.0

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
- Updated dependencies [376a061]
- Updated dependencies [19e3e6e]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [cbedd62]
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

## 4.0.91

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [818e6a3]
  - @objectstack/spec@16.1.0
  - @objectstack/runtime@16.1.0

## 4.0.90

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [fdc244e]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [ee0a499]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
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

## 4.0.90-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [ee0a499]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/runtime@16.0.0-rc.1

## 4.0.90-rc.0

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [fdc244e]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
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

## 4.0.89

### Patch Changes

- @objectstack/runtime@15.1.1
- @objectstack/spec@15.1.1

## 4.0.88

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
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/runtime@15.1.0

## 4.0.87

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/runtime@15.0.0

## 4.0.86

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/runtime@14.8.0

## 4.0.85

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/runtime@14.7.0

## 4.0.84

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/runtime@14.6.0

## 4.0.83

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

## 4.0.82

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/runtime@14.4.0

## 4.0.81

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/runtime@14.3.0

## 4.0.80

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/runtime@14.2.0

## 4.0.79

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/runtime@14.1.0

## 4.0.78

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

## 4.0.77

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
  - @objectstack/runtime@13.0.0

## 4.0.76

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [b5a87eb]
  - @objectstack/spec@12.6.0
  - @objectstack/runtime@12.6.0

## 4.0.75

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/runtime@12.5.0

## 4.0.74

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/runtime@12.4.0

## 4.0.73

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/runtime@12.3.0

## 4.0.72

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/runtime@12.2.0

## 4.0.71

### Patch Changes

- Updated dependencies [497bda8]
- Updated dependencies [93e6d02]
  - @objectstack/runtime@12.1.0
  - @objectstack/spec@12.1.0

## 4.0.70

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

## 4.0.69

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/runtime@11.10.0

## 4.0.68

### Patch Changes

- Updated dependencies [852bc8e]
- Updated dependencies [d3595d9]
  - @objectstack/runtime@11.9.0
  - @objectstack/spec@11.9.0

## 4.0.67

### Patch Changes

- @objectstack/runtime@11.8.0
- @objectstack/spec@11.8.0

## 4.0.66

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/runtime@11.7.0

## 4.0.65

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/runtime@11.6.0

## 4.0.64

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/runtime@11.5.0

## 4.0.63

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/runtime@11.4.0

## 4.0.62

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/runtime@11.3.0

## 4.0.61

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/runtime@11.2.0

## 4.0.60

### Patch Changes

- Updated dependencies [e011d42]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
- Updated dependencies [7087cfe]
- Updated dependencies [69ae136]
  - @objectstack/runtime@11.1.0
  - @objectstack/spec@11.1.0

## 4.0.59

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
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/runtime@11.0.0
  - @objectstack/spec@11.0.0

## 4.0.58

### Patch Changes

- Updated dependencies [8cf4f7c]
- Updated dependencies [f2063f3]
  - @objectstack/runtime@10.3.0
  - @objectstack/spec@10.3.0

## 4.0.57

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/runtime@10.2.0

## 4.0.56

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
- Updated dependencies [94d2161]
  - @objectstack/spec@10.1.0
  - @objectstack/runtime@10.1.0

## 4.0.55

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [47d978a]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/runtime@10.0.0

## 4.0.54

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

## 4.0.53

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
  - @objectstack/spec@9.10.0
  - @objectstack/runtime@9.10.0

## 4.0.52

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/runtime@9.9.1

## 4.0.51

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

## 4.0.50

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/runtime@9.8.0

## 4.0.49

### Patch Changes

- @objectstack/runtime@9.7.0
- @objectstack/spec@9.7.0

## 4.0.48

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/runtime@9.6.0

## 4.0.47

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/runtime@9.5.1

## 4.0.46

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/runtime@9.5.0

## 4.0.45

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/runtime@9.4.0

## 4.0.44

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/runtime@9.3.0

## 4.0.43

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/runtime@9.2.0

## 4.0.42

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/runtime@9.1.0

## 4.0.41

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/runtime@9.0.1

## 4.0.40

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/runtime@9.0.0

## 4.0.39

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/runtime@8.0.1

## 4.0.38

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [f68be58]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [bc0d85b]
- Updated dependencies [2537e28]
- Updated dependencies [0ec7717]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/runtime@8.0.0

## 4.0.37

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
  - @objectstack/runtime@7.9.0
  - @objectstack/spec@7.9.0

## 4.0.36

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/runtime@7.8.0

## 4.0.35

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/runtime@7.7.0

## 4.0.34

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [8e539cc]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/runtime@7.6.0

## 4.0.33

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/runtime@7.5.0

## 4.0.32

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/runtime@7.4.1

## 4.0.31

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [394d34f]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/runtime@7.4.0

## 4.0.30

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/runtime@7.3.0

## 4.0.29

### Patch Changes

- Updated dependencies [9096dfe]
  - @objectstack/runtime@7.2.1
  - @objectstack/spec@7.2.1

## 4.0.28

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/runtime@7.2.0

## 4.0.27

### Patch Changes

- 47a92f4: Promote `email_template` to a first-class metadata type using the canonical
  `EmailTemplateDefinitionSchema`.

  Previously `email_template` had two competing Zod schemas (Prime Directive
  #8 violation): the legacy `EmailTemplateSchema` (a sub-shape of
  `Notification`) and the richer `EmailTemplateDefinitionSchema`. The runtime
  metadata protocol (`packages/objectql/src/protocol.ts`) and Studio's
  property panel registered the legacy one, which is why all the new fields
  (`name`, `label`, `category`, `locale`, `bodyHtml`, `bodyText`, …) were
  reported as “declared in form layout but missing from schema”.

  This change:

  - Repoints the `email_template` entry in `TYPE_TO_SCHEMA`
    (`packages/objectql/src/protocol.ts`) and in
    `BUILTIN_METADATA_TYPE_SCHEMAS`
    (`packages/spec/src/kernel/metadata-type-schemas.ts`) to
    `EmailTemplateDefinitionSchema`. The legacy `EmailTemplateSchema` is
    kept only as an inline sub-shape inside `Notification`.
  - Adds an `emailTemplates` collection to `defineStack()` input
    (`packages/spec/src/stack.zod.ts`), registers it in
    `MAP_SUPPORTED_FIELDS`/`PLURAL_TO_SINGULAR`
    (`packages/spec/src/shared/metadata-collection.zod.ts`), wires it into
    `ARTIFACT_FIELD_TO_TYPE` (`packages/metadata/src/plugin.ts`) and
    `APP_CATEGORY_KEYS` (`packages/runtime/src/app-plugin.ts`).
  - Rewrites `packages/spec/src/system/email-template.form.ts` for the new
    schema with sections for Identity, Subject, HTML body, Plain-text body,
    Variables, Delivery overrides, Status.
  - Ships three reference templates in `examples/app-crm/src/emails/`:
    `crm.deal_won` (rewritten to canonical shape), `crm.welcome` (new),
    `crm.lead_followup` (new), and wires them into the CRM stack via
    `emailTemplates: Object.values(emails)`.

  End-to-end verified in Studio: list view at
  `/_console/apps/studio/metadata/email_template` shows all three entries;
  the detail view renders the EmailTemplatePreview iframe and the property
  panel cleanly renders every canonical field (no missing-schema warnings).
  `GET /api/v1/meta` now returns the new `properties` set
  (`name, label, category, locale, subject, bodyHtml, bodyText, variables,
fromOverride, replyTo, active, isSystem, description`).

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/runtime@7.1.0

## 4.0.26

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [3a630b6]
  - @objectstack/spec@7.0.0
  - @objectstack/runtime@7.0.0

## 4.0.25

### Patch Changes

- Updated dependencies [bac7ae5]
  - @objectstack/runtime@6.9.0
  - @objectstack/spec@6.9.0

## 4.0.24

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/runtime@6.8.1

## 4.0.23

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [50ccd9c]
  - @objectstack/spec@6.8.0
  - @objectstack/runtime@6.8.0

## 4.0.22

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/runtime@6.7.1

## 4.0.21

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [c5efe15]
- Updated dependencies [4944f3a]
- Updated dependencies [e0c593f]
  - @objectstack/spec@6.7.0
  - @objectstack/runtime@6.7.0

## 4.0.20

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/runtime@6.6.0

## 4.0.19

### Patch Changes

- @objectstack/runtime@6.5.1
- @objectstack/spec@6.5.1

## 4.0.18

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/runtime@6.5.0

## 4.0.17

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/runtime@6.4.0

## 4.0.16

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/runtime@6.3.0

## 4.0.15

### Patch Changes

- Updated dependencies [b4c74a9]
- Updated dependencies [dbb54e1]
  - @objectstack/spec@6.2.0
  - @objectstack/runtime@6.2.0

## 4.0.14

### Patch Changes

- @objectstack/runtime@6.1.1
- @objectstack/spec@6.1.1

## 4.0.13

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/runtime@6.1.0

## 4.0.12

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/runtime@6.0.0

## 4.0.11

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/runtime@5.2.0
  - @objectstack/plugin-webhooks@5.2.0
  - @objectstack/driver-mongodb@5.2.0
  - @objectstack/service-analytics@5.2.0
  - @objectstack/service-automation@5.2.0

## 4.0.10

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/driver-mongodb@5.1.0
  - @objectstack/runtime@5.1.0
  - @objectstack/service-analytics@5.1.0
  - @objectstack/service-automation@5.1.0

## 4.0.9

### Patch Changes

- Updated dependencies [5e9dcb4]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
- Updated dependencies [2f9073a]
  - @objectstack/runtime@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/driver-mongodb@5.0.0
  - @objectstack/service-analytics@5.0.0
  - @objectstack/service-automation@5.0.0

## 4.0.8

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/runtime@4.2.0
  - @objectstack/driver-mongodb@4.2.0
  - @objectstack/service-analytics@4.2.0
  - @objectstack/service-automation@4.2.0

## 4.0.7

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/runtime@4.1.1
- @objectstack/driver-mongodb@4.1.1
- @objectstack/service-analytics@4.1.1
- @objectstack/service-automation@4.1.1

## 4.0.6

### Patch Changes

- fcc54fd: chore(example-crm): cull duplicate/low-value reports

  Remove three reports from the CRM example that didn't pass the
  "Report vs. Dashboard" value test:

  - `LeadsBySourceReport` (single-dim count by `lead_source`) — fully
    redundant with the sales dashboard's "Lead Source" pie tile.
  - `ContactsByAccountReport` — really a Contact List View grouped by
    account, not a report.
  - `TasksByOwnerReport` — single-dim count, not navigated anywhere.

  Remaining 10 reports keep full shape coverage: summary (2), matrix (4),
  joined (2), multi-pane (1) plus a chartful summary.

- Updated dependencies [2108c30]
- Updated dependencies [96fb108]
- Updated dependencies [23db640]
- Updated dependencies [70db902]
- Updated dependencies [70db902]
  - @objectstack/spec@4.1.0
  - @objectstack/runtime@4.1.0
  - @objectstack/driver-mongodb@4.1.0
  - @objectstack/service-analytics@4.1.0
  - @objectstack/service-automation@4.1.0

## 4.0.5

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/runtime@4.0.5
  - @objectstack/driver-mongodb@4.0.5
  - @objectstack/service-automation@4.0.5
  - @objectstack/service-analytics@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2

## 3.0.26

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0

## 3.0.25

### Patch Changes

- @objectstack/spec@3.3.1

## 3.0.24

### Patch Changes

- @objectstack/spec@3.3.0

## 3.0.23

### Patch Changes

- @objectstack/spec@3.2.9

## 3.0.22

### Patch Changes

- @objectstack/spec@3.2.8

## 3.0.21

### Patch Changes

- @objectstack/spec@3.2.7

## 3.0.20

### Patch Changes

- @objectstack/spec@3.2.6

## 3.0.19

### Patch Changes

- @objectstack/spec@3.2.5

## 3.0.18

### Patch Changes

- @objectstack/spec@3.2.4

## 3.0.17

### Patch Changes

- @objectstack/spec@3.2.3

## 3.0.16

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2

## 3.0.15

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1

## 3.0.14

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0

## 3.0.13

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1

## 3.0.12

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8

## 1.2.16

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7

## 1.2.15

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6

## 1.2.14

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5

## 1.2.13

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4

## 1.2.12

### Patch Changes

- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3

## 1.2.11

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2

## 1.2.10

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1

## 1.2.9

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0

## 1.2.8

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7

## 1.2.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.6

## 1.2.6

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5

## 1.2.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.4

## 1.2.4

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.3

## 1.2.3

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2

## 1.2.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.1

## 1.2.1

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0

## 0.9.15

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.12

## 0.9.14

### Patch Changes

- @objectstack/spec@1.0.11

## 0.9.13

### Patch Changes

- @objectstack/spec@1.0.10

## 0.9.12

### Patch Changes

- @objectstack/spec@1.0.9

## 0.9.11

### Patch Changes

- @objectstack/spec@1.0.8

## 0.9.10

### Patch Changes

- @objectstack/spec@1.0.7

## 0.9.9

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6

## 0.9.8

### Patch Changes

- Updated dependencies [b1d24bd]
  - @objectstack/spec@1.0.5

## 0.9.7

### Patch Changes

- @objectstack/spec@1.0.4

## 0.9.6

### Patch Changes

- @objectstack/spec@1.0.3

## 0.9.5

### Patch Changes

- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/spec@1.0.2

## 0.9.4

### Patch Changes

- @objectstack/spec@1.0.1

## 0.9.3

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.1

## 0.7.5

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2

## 0.7.4

### Patch Changes

- @objectstack/spec@0.8.1

## 0.7.3

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.7.2

### Patch Changes

- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.7.1

## 0.6.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0

## 1.0.9

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.4.2

## 1.0.8

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.4.1

## 1.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.3.3

## 1.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.3.2

## 1.0.5

### Patch Changes

- @objectstack/spec@0.3.1

## 1.0.4

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 1.0.3

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.3.0

## 1.0.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.2.0

## 1.0.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.1.2
