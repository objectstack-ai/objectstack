# @objectstack/service-messaging

## 17.0.0-rc.6

### Patch Changes

- f9a5c59: fix(service-messaging): close `DeliveryPayload.severity` to `'info' | 'warning' | 'critical'` (#7174)

  `DeliveryPayload.severity` was declared `'info' | 'warning' | 'critical' | string`.
  TypeScript absorbs a literal union member into the wider primitive it is unioned
  with, so this was exactly `string` — the three names read as a closed vocabulary
  but enforced nothing. `severity: 'urgent'` (or `''`) type-checked with no error,
  even though the value flows into `inbox-channel.ts`'s `n.severity ?? 'info'` and
  the `sys_inbox_message.severity` select column, whose options are the three
  names, and even though this package's three sibling declarations of the same
  concept — `MessagingService['emit']`'s `EmitInput.severity`
  (`messaging-service.ts`), `MessagingChannel`'s `Notification['severity']`
  (`channel.ts`), and the `inbox-message` object's `severity` select field — are
  already closed to exactly this set.

  Dropping the trailing `| string` makes the type mean what it says. No runtime
  behaviour changes — every real producer already writes `input.severity ?? 'info'`
  where `input.severity` is itself the already-closed `EmitInput.severity`, so no
  in-repo construction site changes shape. This is the type-level twin of #7086
  (`NotifyConfigSchema.severity`, closed in PR #7192): a construction site that
  would previously narrow silently through the collapsed union now gets a
  compiler refusal instead, named as a `@ts-expect-error` pin.

  This is a narrowing of a publicly exported type
  (`packages/services/service-messaging/src/outbox.ts`), so a consumer assigning
  an out-of-vocabulary literal directly to `DeliveryPayload.severity` would newly
  fail to compile — hence `patch`, following the #7140 precedent for a type-side
  enforcement tightening with no runtime behaviour change.

- 932d7e2: Migrate the inbox read-receipt race fallback onto the shared `isUniqueViolationError` predicate from `@objectstack/types` (#6542), deleting the last hand-written `isUniqueViolation()` copy that #6250 inventoried. One behaviour change, in the direction the call site wants: the shared predicate follows a bounded step down the `cause` chain, so a unique-constraint conflict wrapped by a pool or query-builder layer now triggers the `flipToRead()` convergence instead of being rethrown as a failed mark-read.
- f1850d8: fix(services): `markAllRead` clears the WHOLE inbox, not one 200-row window (#6436)

  `POST /api/v1/notifications/read/all` is published as "mark **every**
  currently-unread inbox message as read". It swept
  `listInbox(userId, { read: false, limit: 200 })` — one page of the LIST, and
  `200` is that list's hard cap — so it cleared at most 200 receipts per call.

  Measured over the real stack (sqlite-wasm + ObjectQL + service-messaging + hono

  - dispatcher), one user, 260 unread:

  | request                                |            before |            after |
  | :------------------------------------- | ----------------: | ---------------: |
  | `POST /notifications/read/all`         |  `readCount: 200` | `readCount: 260` |
  | `GET /notifications` (same user, next) | `unreadCount: 60` | `unreadCount: 0` |

  **#6363 did not cause this — it removed the cover.** While `unreadCount` was
  itself window-scoped the shortfall was self-consistent and invisible: clear 200,
  poll, see a window with nothing unread in it, badge 0. Now that the badge is a
  true total, the same request pair states the contradiction out loud, which also
  raises the severity — a user presses "mark all read" and the badge stays lit.

  **A second, sharper face of the same defect, fixed with it.** That window was
  `created_at desc` over ALL rows, with the `read` filter applied in memory AFTER
  the truncation. An inbox whose newest 200 were already read therefore handed the
  sweep an EMPTY id list and marked **nothing at all**, however much older unread
  sat behind it. That is also why "loop the pages until one comes back empty" is
  not the fix: it exits on exactly that empty first page.

  **What it does now.** It reads the unread SET rather than a page of the list, in
  a FIXED two reads whatever the inbox size — the same one-column, unwindowed
  projection of `sys_inbox_message` that #6363's `countUnreadTotal` already issues
  to answer the badge, joined against the receipt spine `listInbox` already reads
  unbounded. No loop and no page count to bound; nothing is asked of the data
  layer that the bell's poll does not already ask on every saturated page. The
  write stays one receipt per unread notification — that is the receipt model
  itself (ADR-0030) — and `markRead`'s check-then-act upsert, its unique-conflict
  convergence and its "no receipt row yet" insert are untouched.

  `readCount` now reports the number of **distinct notifications this call flipped
  to `read`** (it reported "the unread ones inside the newest 200 rows"). Two
  consequences: a notification materialized by several inbox rows counts once, and
  an inbox row carrying no `notification_id` is skipped rather than counted —
  read-state is keyed by the event id, so the receipt the old code wrote for those
  (keyed by the inbox ROW id) was one the join could never read back.

  Unchanged: the list window (default 50, cap 200, newest first), `unreadCount`,
  `markRead`, and an inbox smaller than the old window — which does the same
  writes it always did, and no extra ones.

- 17d0954: fix(services): `unreadCount` counts the TOTAL unread, not the returned window (#6363)

  `ListNotificationsResponseSchema.unreadCount` is published into the API
  reference as **"Total number of unread notifications"** — a `.describe()`, so it
  is the documentation shipped to every consumer of
  `GET /api/v1/notifications`. It was counted inside `rows.map(...)` in
  `MessagingService.listInbox`, i.e. over the rows that `limit` had already
  truncated, so the badge saturated at the window size forever.

  Measured on a real stack (sqlite-wasm + ObjectQL + service-messaging + hono +
  dispatcher) with 60 unread messages:

  | request     | `notifications[]` | `unreadCount` (before) | `unreadCount` (after) |
  | :---------- | ----------------: | ---------------------: | --------------------: |
  | no `limit`  |                50 |                 **50** |                **60** |
  | `?limit=10` |                10 |                 **10** |                **60** |

  The declaration was right and the implementation was wrong, so the
  implementation moved (maintainer ruling, 2026-08-07). Every consumer that
  renders `unreadCount` as a bell badge now gets the number it asked for; nothing
  had to learn an implementation detail to read the field correctly.

  **The list itself is unchanged.** `notifications[]` is still the window —
  `limit` rows, default 50, hard cap 200, newest first. The two bounds were
  conflated, not shared.

  Read-state lives on `sys_notification_receipt`, not on the inbox row
  (ADR-0030), so the total is a reverse join rather than a `count()`. It is
  computed only when the window came back **saturated** (`rows.length === limit`)
  — a short window is already the whole matching set, so the common inbox costs
  exactly what it cost before. When the window does saturate, the extra work is
  one projection read of a single column (`notification_id`) under the same
  `where`, no `orderBy` and no `limit`: the same order as the receipt scan
  `listInbox` already performs unconditionally, and exact under a `type` filter
  and for rows carrying no `notification_id`.

  Two related behaviours are unchanged and now pinned: a `read` filter narrows
  the list and never the badge (asking for the read half does not mean zero
  unread), and a `type` filter narrows both (the count answers the query that was
  asked).

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
- Updated dependencies [91cefb8]
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
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6

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

### Minor Changes

- 9c90ea0: feat(sms): 短信全局日发送配额 —— 成本总量闸 (#2814)

  #2780 给 OTP 端点落了**按号码**的防滥用（60s 冷却 + 每号码 5 条/小时）。那挡住的是「一个号码花多少钱」，挡不住「这套部署一天花多少钱」：攻击者轮换上万个不同号码时，每个号码都稳稳待在自己的预算里，而日累计账单没有任何上限——这正是 SMS pumping / toll fraud 的典型打法。更要紧的是，按号码那道闸住在 better-auth 的 `hooks.before` 里，只看得见 auth 端点：`notify(channels:['sms'])` 与邀请短信从旁边直接走过去，一条都不计数。

  本次新增一道**总量**闸，扣减点放在所有出站短信本来就必经的那一处 —— `SmsService.send()`。OTP、邀请、messaging `sms` channel 三条路无论从哪扇门进来，都记在同一本账上。

  ## 新增设置项

  `sms` 命名空间新增 `daily_quota`（Daily send limit，number，默认 `0` = 不限）：这套部署每个 **UTC 自然日**允许发出的短信总条数。超出后拒发，直到 00:00 UTC。env 覆盖沿用既有的每键机制，无需额外接线：`OS_SMS_DAILY_QUOTA=2500`。

  `0` 是出厂姿态，所以升级本身不改变任何现有部署的发送行为——闸门要由运营者显式配置才会闭合。

  ## Observable behaviour change

  **配置配额后，发送可能被拒**，两条路径的表现分别是：

  - OTP / 邀请路径 —— `SendSmsResult.status='failed'`，`error` 为 `TOO_MANY_REQUESTS: daily SMS quota exhausted`。刻意与按号码闸抛出的 `TOO_MANY_REQUESTS` 用同一个码，且**不带任何剩余额度细节**：从外面看，两道墙必须长得一样，攻击者不该能试探出自己撞的是哪一道。
    ⚠️ 但这个码**目前到不了 HTTP 调用方**：`AuthManager.deliverPhoneOtp` 把它重抛成普通 `Error`，而 better-call 对非 `APIError` 一律回 500（实测，见 #6039）。也就是说 OTP 端点上，按号码闸回 429、总量闸回 500。补齐要动 plugin-auth，已单独立案。
  - messaging `sms` channel —— `SendResult.ok=false`，且 `classifyError` 返回 `'rate_limited'`（此前一律 `'retryable'`）。投递落进 outbox 走退避重试 / 死信，不会被静默丢弃；`rate_limited` 与 `retryable` 走同一条重试阶梯，但把「额度用尽」与「网关抖动」在投递记录上区分开。

  ## 计数落在哪里

  复用仓内唯一那份定窗计数（`incrementFixedWindow`）与它的惰性存储解析（`createLazyCounterStore`，#4772/#4790），不写第三份：

  - 有 kernel `cache` 服务时计在共享 cache（集群共享与否取决于 cache 本身）；
  - 解析不到时降级为有界的进程内计数，并由解析器**点名**打一条 warn，说明降级的代价（N 节点部署最多可花 N× 配额）；
  - 解析在**计数被消费时**发生，而非插件 init —— 后注册的 cache 也能在下一次发送时被接上（#4772 的坑）。

  窗口是 UTC 自然日，且由两个机制同时保证：计数键带 UTC 日期（`sms-daily-sends:2026-08-06`），窗口开启时的 TTL 恰为距下一个 UTC 午夜的秒数。任一机制单独也能翻窗，合起来则不可能互相矛盾。

  ## 两条刻意的姿态

  - **fail-open**：计数存储读不到时，闸门**放行**并打一次 warn。短信成本闸不能把登录拖下水（#2814 诉求 4）。
  - **配额值的钳制在消费侧**：manifest 上的 `min: 0` 今天并不被 `validatePatch` 执行（#5932），所以负值 / `NaN` / `Infinity` / 非数字都会原样抵达读取方。这些一律降级为 `0`（不限）并**点名**打 warn，而不是拒发、也不是替运营者编一个别的默认值——一个设置表单里的手误不该变成手机登录的全站故障，而编一个没人声明过的上限只会把手误藏进看似合理的行为里。

  ## 不在本次范围

  诉求中的**每租户日配额**（`daily_quota_per_tenant`）未实现：`SendSmsInput`（`@objectstack/spec/contracts`）不携带任何租户标识，而在 service 侧另造一个只此一家的拼法就是 Prime Directive #12 明令禁止的影子契约。租户维度要么落在 spec 契约上，要么不落——详见 #2814 上的讨论。

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

### Minor Changes

- 0848bea: feat(spec)!: retire the overloaded `managedBy: 'system'` bucket — the residue becomes `system-data` (#3355)

  **FROM → TO: `managedBy: 'system'` → `managedBy: 'system-data'`.** One-line fix:
  rename the value. Nothing else about the object changes. `os migrate meta --from 16`
  rewrites it for you; stored metadata is CONVERTED by the ADR-0087 entry
  `object-managed-by-system-to-system-data`, never silently reinterpreted.

  ADR-0103 split the overloaded `system` bucket in v16, and it split it
  **additively**: the 20 engine-owned objects moved to the new explicit
  `engine-owned`, while the 8 admin/user-writable ones — the RBAC link tables
  (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`),
  `sys_user_preference`, `sys_approval_delegation`, and the three messaging config
  grids — stayed behind on `system`. That was the right move for a v16 that could
  not break authors, but it left the enum in a state where the surviving value
  names the half that had already moved out: `system` sitting on precisely the
  objects a user writes.

  That is not a cosmetic complaint. An author choosing between `system` and
  `engine-owned` had nothing in the vocabulary to choose _on_, so the bucket was
  re-overloadable by anyone reading the name in good faith — a model author most
  of all, since "system table" reads as "the engine owns this" in every other
  codebase. `system-data` states both boundaries explicitly: the **schema** is the
  platform's (versus `platform`, which is tenant-modelled), the **data** is the
  admin's or the user's (versus `engine-owned`, where the engine owns both).

  Because v16 already drained the engine side, the conversion is a **one-to-one
  mechanical value rename** with no judgement call — by construction every
  remaining `system` declaration is writable platform data.

  **One deliberate consequence — the affordance default flips.** `system` defaulted
  LOCKED and each of the 8 objects re-opened its writes with a
  `userActions: { create: true, edit: true, delete: true }` block. `system-data`
  defaults **WRITABLE** (full CRUD), because a bucket that exists to say "the data
  is yours" should not make every member ask for it back. Those blocks are now
  redundant and have been deleted from the 8 platform objects; keep `userActions`
  only to **NARROW**. If you converted an object that carried no `userActions`, it
  gains the generic affordances — the honest reading of the bucket it moved into.

  **No enforcement moves.** The engine write guard, the `DelegatedAdminGate`, RLS
  and permission sets all adjudicate off resolved affordances and the principal,
  never off the bucket name. `system-data` simply joins `platform` / `config` as a
  bucket the fail-closed guard does not cover, because a writable default has
  nothing to close on. The 8 objects passed that guard before (via `userActions`)
  and pass it now (via the bucket default), for the same resolved-affordance
  reason.

  `'system'` is **retired from the load path**: the enum rejects it with a
  prescription naming `system-data` and the one-line fix. Absorbing it silently at
  load would leave every author still writing the name this rename exists to
  unteach.

### Patch Changes

- 040ecd2: fix(service-messaging): stop the SQL outboxes from writing `updated_at` on UPDATE — `pnpm dev` no longer floods the console

  An idle dev server printed the same warning 48 times a second, forever:

  ```
  WARN Field 'updated_at' is read-only — ignoring incoming change (#2948)
  ```

  `SqlNotificationOutbox.claim()` / `.claimDigest()` and `SqlHttpOutbox.claim()`
  open with an unconditional "reap stale in_flight" UPDATE — visibility-timeout
  recovery that runs on every dispatcher tick whether or not any row is actually
  stale — and every one of those payloads carried `updated_at`. That column is
  `readonly` and owned by ObjectQL's builtin `sys_stamp_audit_update` hook, so the
  value was stripped by `stripReadonlyFields` and re-stamped by the platform: a
  no-op write that cost one warning per call. Three claim paths × 8 partitions ×
  the dispatcher's 500 ms tick = 48 identical lines a second, which buried every
  real warning and error in the dev log.

  `updated_at` is now gone from every UPDATE payload in both outboxes (`claim`,
  `claimDigest`, `ack`, `redeliver`); the platform hook keeps stamping it, so
  stored rows are unchanged. INSERT still writes both audit columns, as `Date`s —
  `created_at` is caller-owned there, and a native `TIMESTAMP` column rejects a
  bare epoch-ms number on Postgres.

  That last point was also a latent bug this removes: `enqueue()` correctly used
  `new Date()`, but the UPDATE paths passed epoch-ms numbers. Nothing broke only
  because the strip discarded them before they reached the driver.

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

### Minor Changes

- f5a4ef0: refactor!: ADR-0112 batch 2 — sweep the lowercase error-code emitters (#4003)

  Continues #3841 per ADR-0112. Batch 1 (#3988) settled the vocabulary and closed
  the set; this batch moves the emitters that still spoke lowercase `snake_case`
  onto it.

  **Wire-visible change.** Error codes on these surfaces change spelling. Generic
  conditions collapse onto the standard catalog rather than keeping a synonym:
  `unauthorized`/`unauthenticated` → `UNAUTHENTICATED`, `forbidden` →
  `PERMISSION_DENIED`, `not_found` → `RESOURCE_NOT_FOUND`, `internal` →
  `INTERNAL_ERROR`, `unavailable` → `SERVICE_UNAVAILABLE`, `not_supported` →
  `NOT_IMPLEMENTED`, `bad_request` → `INVALID_REQUEST`. Domain conditions get codes
  registered in `ERROR_CODE_LEDGER` (`MARKETPLACE_STORAGE_FAILED`,
  `PLUGIN_MANIFEST_INVALID`, `ITEM_LOCKED`, `DELIVERY_NOT_ELIGIBLE`, …). Swept:
  `cloud-connection`, `plugin-auth`, `hono`, `metadata-protocol`, `rest`,
  `service-messaging`, `service-automation`, `trigger-api`.

  Branch on `error.code` values rather than pattern-matching their case: the
  console's fix for the same rename (objectui#2977) reads codes case-insensitively
  for exactly this reason, and that is the pattern to copy in your own consumers if
  you support servers on both sides of the change.

  **Four routes stop putting a code in the message slot.** The webhook redeliver
  route, the API-trigger webhook, and two `rest` routes answered
  `{ success: false, error: '<code>', message }` — the code occupying `error`, the
  declared object envelope nowhere. They now emit `error: { code, message }`, and
  three API-trigger branches gained a message they never had. Clients reading
  `body.error` as a string on those routes must read `body.error.code`.

  **`ConnectorErrorCategory` / `ConnectorRetryStrategy`** (ADR-0112 D9a):
  `@objectstack/spec` exported two mutually incompatible `ErrorCategory` types and
  two `RetryStrategy` types. The connector-side pair is renamed; importers of the
  `integration` subpath update the name. Side effect: the api-side `ErrorCategory`
  and `RetryStrategy` now appear in the generated API reference at all — the name
  collision had been silently dropping them.

  **`OAUTH_REGISTER_FAILED` replaces an unbounded code source.** The OAuth client
  registration route put better-auth's arbitrary `body.error` string straight into
  `error.code`. The code is now ours and the upstream discriminator moved to
  `details.upstreamError`.

  **Not swept, deliberately.** `sys_metadata_audit.code` keeps its lowercase values
  (ADR-0112 D6b): it is persisted audit history, and the same column holds
  non-error outcomes (`ok`, `lock_override`). Diagnostics records that ship inside a
  200 keep theirs (D6c), as do field-level codes (D6, #3977) and the CLI's
  `--json` output contract.

  A `check:error-code-casing` CI guard now fails on a new lowercase literal in a
  code position, since the ledger's casing rule can only police codes that someone
  registers.

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

- a8dcc37: fix(service-messaging,plugin-audit): the service that writes `sys_notification` is the one that declares it (#4154)

  `MessagingService.emit()` writes `sys_notification` on every call — it is the
  pipeline's single ingress (ADR-0030 L2). But the object was contributed to the
  manifest by **`AuditPlugin`**, parked there with a comment saying it would stay
  "until that [ADR-0030] migration lands". The migration landed; the parking did
  not move.

  That left a real deployment hole, because `AuditPlugin` is an **optional** pair
  in the CLI's plugin table. Install messaging without audit and nothing registers
  the object, so the engine has no schema to issue DDL from and every `notify()`
  fails with `no such table: sys_notification`. AuditPlugin never wrote the row
  itself — it deliberately routes through this service's `emit()` ingress
  (`getMessaging()` in `audit-writers.ts`), and its own exclusion list already
  annotates the object as "messaging-owned (ADR-0030)".

  The contribution now lives with the writer, matching how every other
  service-owned platform object is handled in this repo — `service-job` imports
  `SysJob`/`SysJobRun`, `service-queue` imports `SysJobQueue`, `rest` imports
  `SysImportJob`. Ownership of the _definition_ is unchanged: the object stays in
  `@objectstack/platform-objects` and in `PLATFORM_OBJECTS_BY_PACKAGE`, because
  owning a definition and contributing it to a running kernel are different
  things. It is also added to the service's `provisionSystemTables`, so the table
  is created with the rest of the pipeline it heads rather than lazily on the
  first write.

  Found while migrating `notifications.hono.integration.test.ts` to in-memory
  SQLite in #4065: that suite had to register the object itself to boot, which was
  the deployment bug in miniature. The workaround is deleted in this change — the
  suite now boots messaging alone and passes, which is the proof the product
  declares what it writes.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

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
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0

## 16.0.0

### Patch Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

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
  - @objectstack/core@16.0.0

## 16.0.0-rc.1

### Patch Changes

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
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
  - @objectstack/core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1

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
  - @objectstack/spec@15.1.0
  - @objectstack/core@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0

## 14.8.0

### Minor Changes

- bb71321: i18n: translate the system account/messaging surfaces end to end.

  - **spec**: `ObjectTranslationDataSchema` / `ObjectTranslationNodeSchema` now
    accept `_views.<view>.emptyState.{title,message}` so list-view empty states
    are translatable (contract-first for the extractor below).
  - **cli**: `os i18n extract` emits `_views.<view>.emptyState` keys when a view
    declares an empty state.
  - **platform-objects**: fill every missing zh-CN/ja-JP/es-ES translation for
    `sys_user`, `sys_organization` and `sys_business_unit` (fields, options,
    views, actions); replace the hardcoded English tab/section/action labels in
    the `sys_user`, `sys_organization` and `sys_position` detail pages with
    inline i18n label objects, and route the user Security tab through
    `record:quick_actions` so object action labels localize.
  - **service-messaging**: new ADR-0029 D8 translation bundle
    (`MessagingTranslations`) covering the seven `sys_*` messaging objects
    (inbox message, receipts, deliveries, preferences, subscriptions, templates,
    HTTP deliveries), registered on `kernel:ready`; zh-CN is fully translated
    and ja-JP/es-ES cover `sys_inbox_message` (incl. the `mine` view empty
    state).

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0

## 14.5.0

### Minor Changes

- 526805e: ADR-0057 data-lifecycle follow-ups (#2834): the per-plugin retention sweepers are retired, telemetry separation goes live in dev, and the lifecycle contract reaches the Studio.

  - **BREAKING (ships as minor per the launch-window convention)**: `JobRunRetention` / `NotificationRetention` and the `retentionDays` / `retentionSweepMs` options on `JobServicePlugin` / `MessagingServicePlugin` are removed. The platform LifecycleService enforces the same windows from the `lifecycle` declarations (`sys_job_run` 30d, notification pipeline 90d); tune them at runtime via the `lifecycle` settings namespace (`retention_overrides`, tenant-scoped).
  - **Fix**: `sys_automation_run` no longer declares a blanket 30d lifecycle retention — that table interleaves live SUSPENDED runs (an approval may stay paused for months) with terminal history, and a blanket age reap could strand in-flight approvals. Bounding stays with the automation store's terminal-only sweep.
  - **CLI**: `objectstack dev` now provisions a dedicated `telemetry` datasource (`<primary>.telemetry.db`) for file-backed SQLite primaries, so lifecycle-classed system data stops sharing the business dev DB (`OS_TELEMETRY_DB=0` opts out; `OS_TELEMETRY_DB=<path>` opts in anywhere). New `os db clean` runs the one-time `VACUUM` that lets legacy files adopt `auto_vacuum=INCREMENTAL` and reports reclaimed bytes.
  - **Studio**: the object metadata form exposes the `lifecycle` block (class + retention/TTL/rotation/archive/reclaim); metadata-forms i18n bundles regenerated with curated zh-CN translations.

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0

## 14.4.0

### Minor Changes

- 7953832: ADR-0057 data lifecycle P1–P4 (#2786): platform-generated data is now bounded by construction.

  - **P1 — contract**: new `lifecycle` object property (`class: record | audit | telemetry | transient | event` + `retention` / `ttl` / `storage(rotation)` / `archive` / `reclaim`), enforced by the platform-owned **LifecycleService** registered by `ObjectQLPlugin` (default-on; disable via `OS_LIFECYCLE_DISABLED=1` or plugin `lifecycle.enabled=false`). The Reaper batch-deletes rows past `retention.maxAge` / `ttl` under a system context and reclaims space (`SqlDriver.reclaimSpace()` → SQLite `PRAGMA incremental_vacuum`). Non-`record` classes must declare a bounding policy (parse-time invariant + spec-liveness gate + dogfood storage-growth gate).
  - **P2 — rotation**: `storage: { strategy: 'rotation', shards, unit }` physically time-shards the table on SQLite — writes land in the current shard, reads go through a UNION-ALL view under the base name, expiry is an O(1) `DROP` of shards past the window. A legacy table is adopted as the first shard on upgrade. Other dialects fall back to an equivalent age-based reap.
  - **P3 — separation + Archiver**: registering a datasource named `telemetry` routes telemetry/event/audit objects to it (opt-in by existence; `transient` deliberately stays on the primary). Audit objects with `archive` declared get retain → archive → delete once the archive datasource exists; without it rows are retained, never dropped unarchived.
  - **P4 — governance**: new `lifecycle` settings namespace — runtime enable switch, per-object retention overrides (tenant-scoped: regulated tenants set years, dev sets days), per-object/per-class row quotas and growth alerts (observe-and-alert only).

  **Behavior change**: 11 platform objects now carry lifecycle declarations and their telemetry is bounded by default — `sys_activity` 14d (rotated), `sys_audit_log` 90d hot → archive (retained forever until an `archive` datasource is registered), `sys_metadata_audit` 365d → archive, `sys_job_run` / `sys_automation_run` / `sys_http_delivery` 30d, notification pipeline (`sys_notification`, delivery, receipt, inbox) 90d, `sys_device_code` expires_at + 1d. Extend windows per environment/tenant via the `lifecycle.retention_overrides` setting.

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Minor Changes

- c1064f1: feat(messaging/auth): SMS infrastructure + phone-number OTP first-login/reset (#2780)

  #2766 shipped phone+password sign-in but no OTP — the platform had no SMS
  delivery capability. This adds the missing infrastructure end to end:

  - **New `@objectstack/plugin-sms`** — `ISmsService`/`ISmsTransport` contracts
    (spec) with Aliyun SMS (ACS3-HMAC-SHA256, template-based) and Twilio
    transports plus a dev log fallback. Configured through the new `sms`
    settings namespace (live provider rebind, encrypted secrets, send-test
    action; `OS_SMS_*` env keys win at the resolver). Deliberately NO message
    persistence and NO body logging — SMS bodies carry OTP codes.
  - **Messaging `sms` channel** — registered at kernel:ready when an `sms`
    service is present; `notify(channels:['sms'])` resolves
    `sys_user.phone_number`, renders `(topic,'sms',locale)` templates, and
    inherits outbox retry/dead-letter.
  - **Phone OTP flows open** — the phoneNumber plugin's `sendOTP` /
    `sendPasswordResetOTP` now deliver via SMS, enabling
    `/phone-number/send-otp` + `/verify` (OTP sign-in/verification) and
    `/phone-number/request-password-reset` + `/reset-password` (self-service
    reset). Without a deliverable SMS service they keep failing loudly
    (NOT_SUPPORTED); `features.phoneNumberOtp` advertises real availability.
    Shipped with the abuse hardening: explicit `allowedAttempts: 3`, always-on
    per-number cooldown (60s) + rolling-hour cap (5, secondaryStorage-shared
    across nodes), `/phone-number/*` in the settings-bound per-IP rate-limit
    rules, and OTP codes never reach logs or error messages.
  - **Import SMS invites** — `/admin/import-users`'s `invite` policy now
    supports phone-only rows: a credential-free invitation SMS points the
    employee at phone-OTP first sign-in followed by self-set password; mixed
    files validate the reachable channel per row.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
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
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0

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

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/core@12.0.0

## 11.10.0

### Patch Changes

- 6a9397e: Retire the deprecated `compactLayout` alias for `highlightFields` (framework#2536, closes the ADR-0085 deprecation window).

  - `ObjectSchema` no longer declares `compactLayout`: `create()` rejects it like any unknown key; lenient `parse()` strips it (no silent aliasing).
  - The parse-time alias AND the `highlightFields → compactLayout` back-fill transition mirror are removed from `normalizeSemanticRoleAliases`. Served metadata now carries the canonical key only.
  - All remaining first-party authors (27 system objects across plugin-audit / approvals / security / sharing / webhooks / service-storage / automation / messaging / realtime — missed by the #2521 sweep, caught by the type gate) renamed to `highlightFields`.
  - The downstream smoke pin moves to hotcrm v1.2.2 (hotcrm#424: same rename + deps ^11.7.0).
  - Consumers were switched in objectui#2168 and shipped via the console pin bump (#2526); this closes the window scheduled there. The dogfood mirror assertion (#2528) flips to `compactLayout: undefined` in this same change, per the plan it carried.

  Version note: minor, not major — the key was deprecated-with-alias for a full release window, all first-party consumers/authors are migrated, and the spec api-surface gate reports no export changes (same documented-exception path as the ADR-0085 removals in 11.7.0). External metadata still authoring `compactLayout` will now fail `create()` loudly with the standard unknown-key error naming the key.

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Patch Changes

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
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- 6d3bf54: fix(messaging): store outbox audit timestamps as datetime so Postgres retention works

  `created_at`/`updated_at` are builtin audit columns that the SQL driver always
  provisions as native `TIMESTAMP` columns, regardless of the declared field type.
  The notification and HTTP outboxes declared them as `Field.number` and wrote
  epoch-ms via `Date.now()`, so on Postgres both the `enqueue` insert and the
  retention sweep failed with `date/time field value out of range` (a bigint
  compared to a timestamp column). SQLite's lenient column affinity hid the bug
  until the multi-node Postgres E2E.

  The outbox objects now declare these as `Field.datetime` and write `Date`s; the
  retention sweep uses one ISO-8601 cutoff for every target (dropping the
  `format: 'epoch'` special case); `toRecord` normalises read-back to epoch ms so
  the record contract is unchanged. `sys_job_run` retention was already ISO.

  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
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

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1

## 9.9.0

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

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1

## 9.5.0

### Minor Changes

- f19caef: feat(P1-2): messaging retention default-on; automation log cap configurable

  Closes the remaining two P1-2 unbounded-growth items (launch-readiness):

  - **service-messaging** — notification-pipeline retention is now **default-on**.
    `MessagingServicePlugin`'s `retentionDays` defaults to
    `DEFAULT_NOTIFICATION_RETENTION_DAYS` (90) instead of `0`; the
    already-built/tested sweeper now prunes `sys_notification` (+ delivery / inbox /
    receipt) older than 90 days by default. **Behaviour change:** notification
    history auto-prunes at 90d — set `retentionDays: 0` to keep it forever.
  - **service-automation** — the in-memory execution-log ring buffer (already
    bounded; no OOM risk) gets a tunable window via
    `AutomationServicePluginOptions.maxLogSize`, defaulting to
    `DEFAULT_MAX_EXECUTION_LOG_SIZE` (1000, unchanged). Durable
    `sys_automation_run`-style persistence remains a post-GA HA item.

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
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

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1

## 8.0.0

### Minor Changes

- 9f311f8: feat(messaging): digest batching for notifications (ADR-0030 P3b-2)

  Recipients can now batch a topic into a `daily` / `weekly` **digest** instead of
  receiving every notification immediately. Builds on P3b-1's deferral seam:

  - `PreferenceResolver` consumes the `digest` preference field and `digestDeferral()`
    defers a batched recipient to the next window (local midnight / Monday 00:00),
    tagging the target with a stable `window`. Digest takes precedence over
    quiet-hours; `critical` and mandatory topics bypass it.
  - `sys_notification_delivery` gains a `digest_key` (`recipient|channel|window`).
    Batched rows partition by that key so a window's rows co-locate, and the normal
    outbox `claim()` skips them while the new `claimDigest()` drains a window whole.
  - The dispatcher's digest pass collapses each `(recipient, channel, window)` group
    into one `renderDigest()` message under the existing per-partition cluster lock,
    then acks every row in the group with that single outcome.

  Additive: non-digest notifications are unchanged. Timezone-from-`sys_user`,
  configurable send-hour, and MJML digest emails are deferred follow-ups.

### Patch Changes

- c70eec1: fix(messaging): converge mark-read receipt on unique-index race

  `markRead`'s `upsertReadReceipt` did `findOne`-then-`insert` (check-then-act), so
  a concurrent mark-read — or the best-effort `delivered` receipt write still in
  flight — could win the `UNIQUE(notification_id, user_id, channel)` index between
  the read and the write. Clicking a notification then threw
  `UNIQUE constraint failed: sys_notification_receipt...`. The insert now catches a
  unique violation and falls back to flipping the now-present row to `read`, with a
  cross-driver `isUniqueViolation` helper (SQLite / Postgres `23505` /
  MySQL `ER_DUP_ENTRY`).

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

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Minor Changes

- 955d4c8: ADR-0018 M3: unified `http` / `notify` executors backed by a generic HTTP outbox.

  Promotes a reliable outbound-HTTP delivery outbox into `service-messaging` (the
  raw-callout counterpart to the notification outbox) and routes the Flow `http`
  node through it — closing the "`http_request` is a bare `fetch()` with no retry"
  gap. The five divergent outbound verbs collapse onto canonical `http` / `notify`.

  **`@objectstack/service-messaging` (additive):**

  - `IHttpOutbox` / `HttpDelivery` generic raw-callout shape
    (`source` / `refId` / `dedupKey` / `label` / `signingSecret`), `SqlHttpOutbox`
    over a new `sys_http_delivery` object, `MemoryHttpOutbox`, `HttpDispatcher`
    (per-partition cluster lock, claim/ack/retry/dead-letter), and a shared
    `sendOnce` + 7-step jittered retry schedule.
  - `MessagingService` gains `setHttpOutbox()` / `isHttpDeliveryReady()` /
    `enqueueHttp()`; the plugin wires the outbox + dispatcher at `kernel:ready`.

  **`@objectstack/service-automation`:**

  - Canonical `http` executor — `durable: true` enqueues onto the messaging HTTP
    outbox (retry/dead-letter); otherwise an inline `fetch()` preserving
    `http_request`'s request/response semantics.
  - `engine.registerNodeAlias()` — registers a delegating executor + a
    `deprecated` / `aliasOf` descriptor. `http_request` / `http_call` / `webhook`
    are now deprecated aliases of `http`; existing flows keep running.
  - `notify` descriptor marked `needsOutbox` (its delivery is outbox-backed).

  **`@objectstack/spec`:** `flow.zod` adds `http` to the builtin node-type seed set.

  `plugin-webhooks` cut-over to the shared outbox is a deliberate follow-up.

- 11905fa: ADR-0018 M3 (Phase 5): `plugin-webhooks` now delivers through the shared
  `service-messaging` HTTP outbox instead of its own.

  The webhook delivery substrate — durable outbox, cluster-coordinated dispatcher,
  retry/backoff/dead-letter, retention — is removed from `plugin-webhooks` and
  replaced by the generic `sys_http_delivery` outbox + `HttpDispatcher` in
  `@objectstack/service-messaging`. Webhooks keep only their domain concerns: the
  `sys_webhook` config object, the `AutoEnqueuer` (now enqueues `source: 'webhook'`
  rows via `messaging.enqueueHttp`), and the redeliver admin endpoint (now backed
  by `messaging.redeliverHttp`).

  **`@objectstack/service-messaging`:** `MessagingService` gains `redeliverHttp(id)`
  and `listHttp(filter)` over the HTTP outbox.

  **`@objectstack/plugin-webhooks` — BREAKING:**

  - Now **requires** `MessagingServicePlugin` (declared as a plugin dependency).
  - Removed exports: `WebhookDispatcher`, `MemoryWebhookOutbox`, `SqlWebhookOutbox`
    (and the `./sql` subpath), `DeliveryRetentionSweeper`, `hashPartition`,
    `sendOnce` / `classifyAttempt` / `nextRetryDelayMs`, and the `IWebhookOutbox` /
    `WebhookDelivery` / `EnqueueInput` / `AckResult` / `RedeliverError` types.
  - Removed the `sys_webhook_delivery` object — webhook deliveries are now rows in
    `sys_http_delivery` (`source = 'webhook'`). The Setup nav points there.
  - `AutoEnqueuer`'s constructor takes an `HttpEnqueueFn` instead of an
    `IWebhookOutbox`.
  - `WebhookOutboxPluginOptions` reduced to `{ autoEnqueue }` (dispatcher / outbox /
    retention / nodeId options removed — those now live on `MessagingServicePlugin`).

- 8e539cc: Implement the `/api/v1/notifications` REST surface (ADR-0030)

  The notification REST routes (`GET /notifications`, `POST /notifications/read`,
  `POST /notifications/read/all`) were declared in the spec but never had a
  server-side handler — no plugin registered the `notification` core service, so
  the routes were never advertised in discovery and `client.notifications.*`
  calls 404'd. (The Console bell works today only because it bypasses these
  endpoints and reads the inbox via the generic data API.)

  This wires the surface end-to-end against the ADR-0030 L5 model:

  - **`MessagingService`** gains an inbox read API: `listInbox(userId, opts)`
    reads `sys_inbox_message` joined with `sys_notification_receipt` for
    read-state (a message is unread until its event has a `read`/`clicked`/
    `dismissed` receipt); `markRead(userId, ids)` and `markAllRead(userId)`
    upsert the receipt to `read`, keyed `(notification_id, user_id,
channel:'inbox')` — updating the existing `delivered` receipt in place,
    inserting only when absent. No reliance on the re-modeled `sys_notification`
    L2 event (which carries no recipient/read columns).
  - **`MessagingServicePlugin`** now also registers the messaging service under
    the `notification` core service slot, so the dispatcher resolves + advertises
    the routes. The legacy `INotificationService.send()` abstraction is unused and
    unconsumed.
  - **`HttpDispatcher`** gains `handleNotification` + a `/notifications` dispatch
    branch: it takes the authenticated user from the execution context and maps
    list / mark-read / mark-all-read to the service. Responses match the spec
    schemas (`{ notifications, unreadCount }`, `{ success, readCount }`).

  Pairs with the objectui SDK consumer repoint (`useClientNotifications` →
  `markRead`/`registerDevice` signatures). Device registration and preference
  endpoints remain out of scope (unimplemented as before).

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Minor Changes

- 13632b1: ADR-0030 P0 (framework) — converge notifications onto a single ingress and the
  layered model. Every producer now publishes through
  `NotificationService.emit(EmitInput)`; the in-app inbox is a materialization of
  delivery, not a row producers write.

  **Single ingress (`@objectstack/service-messaging`) — breaking**

  - `MessagingService.emit` takes the new `EmitInput` contract (`topic` /
    `audience` / `payload` / `severity` / `dedupKey` / `source` / `actorId` /
    `organizationId` / `channels`) instead of the flat `Notification` shape. It
    writes the L2 `sys_notification` event (idempotent on `dedupKey`), resolves the
    audience, then fans out; it returns `{ notificationId, deduped, deliveries,
delivered, failed }`.
  - New `sys_notification_receipt` object — the read-state spine
    (`delivered|read|clicked|dismissed`), keyed `(notification_id, user_id,
channel)`. The inbox channel writes a `delivered` receipt on materialization.
  - `sys_inbox_message`: adds `notification_id` / `delivery_id`, **drops `read`**
    (read-state moved to the receipt), adds the user `mine` list view.

  **Event re-model (`@objectstack/platform-objects`) — breaking**

  - `sys_notification` is re-modeled from a per-user inbox into the L2 **event**
    (`topic`, `payload`, `severity`, `dedup_key`, `source_*`, `actor_id`). Removes
    `recipient_id` / `is_read` / `read_at` / `type` / `title` / `body` / `url` /
    `actor_name` and the inbox actions/views. App-nav: the account inbox points at
    `sys_inbox_message`; Setup shows the notification event log.

  **Producers routed through `emit()`**

  - `@objectstack/service-automation`: the `notify` node maps its config to
    `EmitInput`.
  - `@objectstack/plugin-audit`: collaboration `@mention` → `collab.mention` and
    assignment → `collab.assignment` (both with a `dedupKey`); no more direct
    `sys_notification` writes. Collaboration notifications now require
    `MessagingServicePlugin` (they degrade to a warn otherwise).

  **Migration (`@objectstack/metadata`)**

  - Idempotent `migrateSysNotificationToEvent` splits legacy `sys_notification`
    inbox rows into `sys_inbox_message` + receipts and rewrites the event row.

  **Startup (`@objectstack/cli`, `@objectstack/runtime`)**

  - `messaging` is now a foundational capability. On `objectstack serve` it is
    added to `ALWAYS_ON_CAPABILITIES` (every non-`minimal` preset starts it); on
    cloud per-project kernels the capability loader expands `requires` to add
    `messaging` whenever `audit` is present. This keeps collaboration `@mention` /
    assignment notifications (which now flow through the pipeline) working out of
    the box on both paths. `--preset minimal` opts out.

  The Console bell repoint (objectui) and phases P1–P3 are tracked in
  `docs/handoff/adr-0030-notification-convergence.md`.

- a40d010: ADR-0030 P2 — subscription + preference. Adds the Layer-3 preference filter so
  users can mute notification topics/channels, with admin-global defaults and
  mandatory-topic bypass.

  - **`sys_notification_preference`** — per `(user_id, topic, channel)` toggle
    (`enabled`, plus `digest`/`quiet_hours` for P3). `user_id='*'` rows are the
    admin-global default; a real-user row overrides it; `topic`/`channel` support
    `*` wildcards. Unique `(user_id, topic, channel)`.
  - **`sys_notification_subscription`** — standing subscription of a principal
    (`role:`/`team:`/`user:`/id) to a topic (the opt-in counterpart to explicit
    audience; object + schema land now, subscription-driven fan-out is a follow-up).
  - **`PreferenceResolver`** — wired into `MessagingService.emit()` between
    recipient resolution and fan-out/enqueue. Most-specific-wins resolution
    (user→`*`, topic→`*`, channel→`*`; default ON). Two safety rules: **mandatory
    topics bypass** (configurable via `mandatoryTopics`, exact or `prefix.`), and
    **fail-open** (no data engine or a lookup error delivers all, never silently
    drops). `emit()` now filters the `(recipient × channel)` matrix per user.
  - Both objects are registered by `MessagingServicePlugin` and contributed to the
    Setup app's Configuration nav slot (ADR-0029 D7), so they appear in
    REST/Studio only when messaging is installed.

  Acceptance: a user muting a topic/channel stops receiving it on that channel;
  mandatory topics still deliver. service-messaging suite: 66 passing
  (adds `preference-resolver.test.ts` + an emit-level mute/bypass test).

- f3424fc: ADR-0030 P3a — email channel + notification templates. The same `emit()` now
  reaches inbox **and** email per the user's preferences, rendered from a
  template.

  - **`email` channel** (`createEmailChannel`) — a thin `MessagingChannel` that
    delegates transport to the existing `email` service (ADR-0022: channel adds
    messaging semantics, the email sub-system stays the transport). It resolves the
    recipient user id → address (`sys_user.email`, or an email-shaped recipient
    verbatim), renders, and sends. Retry/backoff/dead-letter come free from the P1
    outbox dispatcher. Registered at `kernel:ready` only when an `email` service is
    present; absent ⇒ no channel (an explicit `channels:['email']` then reports
    "not registered" rather than silently no-opping). No-ops gracefully like the
    inbox channel when the capability isn't installed.
  - **`sys_notification_template`** (topic × channel × locale) + a renderer:
    declarative `{{ payload.x }}` interpolation (no logic — auditable metadata),
    HTML/markdown/text bodies, locale fallback (`en-US` → `en` → default), and a
    **generic fallback to `payload.title`/`body`** when no template matches (so
    templates are purely additive). Contributed to the Setup → Configuration nav.
  - Channels are now keyed per recipient (from P2), so a notification reaches each
    user on exactly the channels they accept, rendered by that channel's template.

  Scope note (ADR-0022): **Slack stays a connector** (`connector-slack` already
  ships the raw API path); a Slack _notification channel_ needs per-user identity
  mapping + OAuth and is enterprise-tier — deferred. push/webhook channels and the
  digest / quiet-hours middleware (P3b) are follow-ups on the same seam.

  Tests: service-messaging **85 passing** — adds `template-renderer.test.ts` and
  `email-channel.test.ts` (address resolution, template vs fallback rendering,
  no-service no-op, unresolved-address failure, transport-failure retry).

- c8753ef: ADR-0030 P3b-1 — quiet-hours. A notification that lands inside a recipient's
  quiet-hours window is **deferred to the window's end** instead of disturbing
  them; it then delivers normally.

  - Implemented as a **deferred dispatch** on the P1 outbox — no parallel
    scheduler: `EnqueueDeliveryInput.notBefore` sets the delivery row's initial
    `nextAttemptAt`, and the existing dispatcher already skips pending rows whose
    `nextAttemptAt` is in the future. One delivery spine, reusing claim/retry/
    observability.
  - `PreferenceResolver` reads `quiet_hours` (`{ tz, start, end }`, P2's field) off
    a channel-wildcard preference row (quiet hours are a per-person, channel-
    agnostic setting), computes the deferral with `quietHoursDeferral()` (HH:MM in
    the row's `tz`, default UTC; supports overnight windows that wrap midnight),
    and stamps `notBefore` on the target. `emit()` passes it through to the outbox.
  - **critical** severity bypasses quiet hours (delivers immediately), like
    mandatory topics bypass muting. Honored on the durable outbox path; inline
    best-effort fan-out ignores it.

  Tests: service-messaging **92 passing** — adds `quietHoursDeferral` unit cases
  (same-day / overnight / outside / degenerate) and resolver cases (notBefore
  stamped, critical bypass, JSON-string `quiet_hours`).

  Follow-up: **P3b-2 — digest** (batch same-`(user, channel, window)` deliveries
  into one) builds on this same deferral foundation, adding the window collapse.

- 406fda5: ADR-0030 P1 — reliable delivery + RecipientResolver.

  **RecipientResolver** — the single home for audience → user-id expansion, wired
  into `MessagingService.emit()`. Queries the same identity/membership model
  `plugin-sharing` uses (directly via the data engine, no backward plugin
  dependency):

  - `role:<name>` → `sys_member` rows (tenant-scoped)
  - `team:<id>` → `sys_team_member` rows
  - `owner_of:<obj>:<id>` / `{ ownerOf }` → the record's owner/assignee field
  - `<email>` → `sys_user` (verbatim fallback on miss); `user:<id>` / bare id → id

  Best-effort: a failed directory lookup yields 0 recipients for that spec rather
  than throwing. The inbox channel's email→id fallback moved here — the channel
  now keys rows by the already-resolved recipient.

  **Reliable delivery outbox + dispatcher** (mirrors `plugin-webhooks`):

  - New `sys_notification_delivery` outbox object (L4) — one row per
    `(event × recipient × channel)`; `pending|in_flight|success|failed|dead|suppressed`
    state machine; unique `(notification_id, recipient_id, channel)` enqueue dedup.
  - `INotificationOutbox` with `SqlNotificationOutbox` + `MemoryNotificationOutbox`
    backends; atomic claim (`pending → in_flight`) + stale-in_flight reaping.
  - `NotificationDispatcher` — interval loop over partitions, each guarded by a
    per-partition cluster lock (single-node always-grant fallback when no cluster
    service); sends via the channel and acks with exponential backoff + jitter;
    dead-letters once the retry budget is exhausted.
  - `emit()` enqueues `pending` deliveries when an outbox is attached; otherwise it
    fans out inline (the P0 behavior). `MessagingServicePlugin` wires the outbox +
    dispatcher at `kernel:ready` and registers the new object.

  A failed channel send now retries and is observable on the delivery row;
  duplicate enqueue is idempotent. Backoff/classification and clocks are injectable
  for deterministic tests.

- 394d34f: Messaging + triggers capability tokens, and notify-by-email recipient resolution.

  Make the `notify` flow node and auto-firing flows usable from a plain
  `defineStack({ requires: [...] })` — no hand-wired plugin instances.

  - **CLI / runtime — new capability tokens.** `messaging` →
    `MessagingServicePlugin` (the `notify` node delivers to the inbox channel
    instead of degrading to a logged no-op); `triggers` →
    `RecordChangeTriggerPlugin` + `ScheduleTriggerPlugin` (autolaunched / schedule
    flows actually fire — pair `triggers` with `job` for cron/interval). Wired
    identically in the CLI `CAPABILITY_PROVIDERS` table and the runtime
    `capability-loader`.
  - **Inbox channel — notify-by-email.** Flows commonly address recipients by
    email (e.g. `{record.assignee}`), but `sys_inbox_message` is keyed by user id.
    The inbox channel now resolves an email-shaped recipient to its `sys_user.id`
    (configurable via `InboxChannelOptions.userObject`), with a verbatim fallback
    when the recipient is not email-shaped, no user matches, or the lookup fails —
    so a failed resolution can never drop the row.

- 3a45780: Synthesize the inbox `action_url` from the event `source` (ADR-0030 L5).

  The Console bell reads `sys_inbox_message` (the L5 in-app materialization),
  which carries only `action_url` — not the L2 `sys_notification` event's
  `source_object`/`source_id`. Producers that pass a `source` but no explicit
  `payload.url` (collaboration `@mention`, record assignment) therefore
  materialized inbox rows with no navigable link, so the bell entry couldn't
  deep-link to the originating record.

  `emit()` now synthesizes an app-relative `/{object}/{id}` link from `source`
  when no explicit `payload.url`/`payload.actionUrl` is supplied — in both the
  inline fan-out and the durable-outbox enqueue paths (`actionUrlFor()`).
  Precedence: explicit url → source-derived link → `undefined`. Keeps the L5
  materialization self-sufficient for navigation (the objectui bell consumes
  `action_url`).

  Tests: 3 new `messaging-service.test.ts` cases (source→link, explicit-url
  precedence, neither→undefined); all 95 service-messaging tests green.

- c381977: Harden the notification pipeline: race-safe dedup + opt-in retention (ADR-0030).

  **Race-safe dedup.** `sys_notification.dedup_key` is now declared a **UNIQUE**
  index (was a plain index), and `emit()` **converges on a unique-key conflict**:
  the pre-insert `dedup_key` check is a fast-path, but if a concurrent `emit`
  raced past it and inserted first, our insert hits the violation — we catch it
  and converge to the winner's event (a dedup hit) instead of throwing or
  double-emitting. This mirrors the delivery outbox's enqueue convergence and
  stops a record-change storm from producing duplicate bell notifications. SQL
  treats NULLs as distinct, so the common events with no `dedup_key` are
  unconstrained. (Enforcement is per-driver: where declared indexes are
  materialized the conflict path activates; drivers that don't materialize them
  fall back to the best-effort fast-path — the catch is simply never taken. Note
  the SQL driver currently doesn't sync declared object indexes, which already
  affects the delivery/receipt unique indexes — tracked separately.)

  **Opt-in retention.** New `NotificationRetention` sweeper + plugin options
  `retentionDays` / `retentionSweepMs`. Every `emit()` writes a `sys_notification`
  event (plus delivery/materialization/receipt rows), so a high-frequency
  periodic flow grows the tables unbounded. When `retentionDays > 0`, a
  low-frequency sweep (default hourly, timer `unref`'d) bulk-deletes events,
  deliveries, inbox messages and receipts older than the cutoff — a notification
  ages out wholesale, keeping the model consistent (no dangling `notification_id`)
  and the bell (recent-only) unaffected. The delivery row's epoch-ms `created_at`
  vs the others' ISO `created_at` is handled per target. **Default off** — no
  notification data is deleted without explicit operator policy. Each target is
  isolated (one object's failure doesn't abort the sweep), and the sweep runs
  under a system context (retention is a cross-tenant operator policy).

  Tests: +7 `service-messaging` cases (converge-on-conflict, non-conflict
  rethrow, retention cutoff-formatting per target, no-engine / non-positive
  no-ops, failure isolation, missing-count) — 102 passing.

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
