# @objectstack/service-settings

## 17.0.0-rc.6

### Patch Changes

- eb1b231: Remove `step: 0.1` from the `ai.temperature` specifier (#6550). Since #6199 a declared `step` binds as a value constraint on both doors, and temperature's true domain is continuous on [0, 2]: the 0.1 grid refused legal values — `PUT /api/settings/ai` with `temperature: 0.15` was rejected and `OS_AI_TEMPERATURE=0.15` was loudly ignored. Both now work; `min: 0` / `max: 2` stay and keep binding (out-of-window values are still refused in the min/max vocabulary). #6199's grid machinery is untouched and still enforces any key that declares `step`.
- 0b63b56: `company.country` adopts the `iso_3166_alpha2` value domain (#6579), the fourth case of the hole #5712 closed on localization: `pattern: '^[A-Za-z]{2}$'` constrains shape only, so `ZZ` (assigned to nobody) and `UK` (a CLDR alias, not an ISO 3166-1 code) passed the write door while the description promised ISO 3166-1. Both doors now judge membership against the explicit 249-code list (`invalid_value` with `constraint: { valueDomain: 'iso_3166_alpha2' }` on save; loud ignore on `OS_COMPANY_COUNTRY`). The pattern stays — a shape breach still speaks first as `invalid_format`. Deliberate tightening, same as #5712: membership is exact uppercase, so lowercase spellings like `us` are now refused.
- 861ee32: The settings env door now enforces declared `pattern` constraints (#6580). An
  `OS_*` override whose value the specifier's `pattern` rejects is loudly
  reported (`error` log, once per var+value) and ignored — the key resolves from
  the next cascade layer and is not locked — exactly the #5204 contract the
  option-table, value-window/step and valueDomain families already honor. The
  write gate's judgment is hoisted into shared helpers (`declaredPattern` /
  `firstPatternMiss`) called by both doors, so `PUT /api/settings/:ns` behavior
  is unchanged byte-for-byte (same `invalid_format` envelope, same tolerance for
  uncompilable pattern declarations) and the two doors can no longer drift.
  Family ordering agrees between doors: options → pattern → valueDomain → bounds.
- babddf6: fix(service-settings): localization's declared standards are the enforcement boundary — `valueDomain` enforced on both doors (#5712)

  `localization.timezone` promised "IANA zone" and `localization.currency` promised
  "ISO 4217 code", but since #5131 the write path treated their curated 17/9-entry
  `options` tables as exhaustive, and since #5204 the env path agreed — so
  `PUT /api/settings/localization` with `timezone: 'Europe/Zurich'` (or
  `currency: 'CHF'`) was refused with `invalid_option`, and
  `OS_LOCALIZATION_TIMEZONE=Europe/Zurich` was ignored, despite both being values
  every `Intl`-based consumer downstream handles. Maintainer ruling (2026-08-06,
  reading 1): the curated tables are UI convenience lists; the boundary is the
  standard's membership.

  The manifest now declares the merged spec vocabulary (#5933 / `SpecifierValueDomainSchema`)
  on the three keys that promised a standard all along — `timezone: 'iana_time_zone'`,
  `currency: 'iso_4217_currency'`, and `default_country: 'iso_3166_alpha2'` (third
  case of the same hole: `^[A-Za-z]{2}$` admits `ZZ`) — and `SettingsService`
  enforces a declared domain at the one decision point per door:

  - **Write door** (`validatePatch`): a domain-bearing specifier skips the
    exhaustive-options check and judges the standard's membership instead, after
    `pattern` (shape and membership narrow independently; the shape breach is the
    coarser fact and speaks first). A breach is `invalid_value` with
    `constraint: { valueDomain }` — no `FieldErrorCode` member names a
    standard-domain breach, and `invalid_option` would misname the set that was
    consulted.
  - **Env door** (`effectiveEnvOverride`): the same membership judgment, so a
    garbage override is loudly reported and ignored (falls back down the cascade,
    pins nothing — #5204's contract, unchanged) while a legal one wins the cascade
    and locks the key.

  Membership definitions follow the spec's pinned TSDoc: `iana_time_zone` is the
  `Intl.DateTimeFormat` probe (NOT `Intl.supportedValuesOf('timeZone')`, whose
  CLDR subset omits `UTC`, `Asia/Kolkata` and `Europe/Kyiv`); `iso_4217_currency`
  is `Intl.supportedValuesOf('currency')`; `iso_3166_alpha2` is an explicit list
  of the 249 officially assigned codes (no standard-library oracle exists —
  `Intl.DisplayNames` names `ZZ` and `UK`).

  A specifier that declares no `valueDomain` is byte-for-byte unchanged: #5131's
  exhaustive-options semantics stay in force for registry-backed tables such as
  `mail.provider` / `sms.provider`, pinned by regression tests on both doors.

- 4afdd3e: fix(service-settings): 写入路径与 env 路径执行 settings 声明的 `step` 网格 (#6199)

  `step` 是 `SpecifierSchema` 五个值约束里的**第五个**,也是最后一个只声明不执行的。
  #5932(PR #6201)补齐 `min`/`max`/`minLength`/`maxLength` 之后,`step` 在
  `packages/services/service-settings/src/` 里仍是**零读取点**:superRefine 不校验它,
  写入路径不读它,env 路径不读它。

  **为什么判定为「值约束」而不是「纯 UI 提示」。** issue 提了两种读法,定论取自 schema
  自己的写法:`step` 与 `min`/`max` 声明在**同一段** `/** number / slider: numeric
bounds and step. */` 注释之下,即它是按「界」被作者写下的,而 #5932 的裁决(声明了
  的界就必须绑定)随之传递。另一种读法(它只是 `input[type=number]` 上下箭头的步进,
  从不表达「其他值非法」)经核查不成立:落地时 `step` 在本仓库与 `objectui` 中**没有
  任何消费者**——没有渲染器读它。按那种读法,这个键就是在为一个并不存在的渲染器表达
  「呈现」,那正是 ADR-0049 的洞,而不是 UI affordance。

  **修法与 #5932 同形,是同一族的第五个成员:**

  - `step` 挂进 `DeclaredBounds` 与 `firstRangeViolation`,因此它按构造同时到达两扇门
    ——写入路径(`validatePatch`)与 env 路径(`effectiveEnvOverride` 这**一个**判定点)
    ——不可能成为「只在一侧执行」的下一个键。
  - 越界发码表里现有的 `invalid_value`(ADR-0114:「rejected for a reason no other
    member names」)。码表里没有任何成员命名「网格」,而码表是刻意封闭的;
    `rest-server.ts` 早已把 Zod 的 `not_multiple_of` 映射到同一个成员,即同一条件从另一
    个方向到达时的同一裁决。⛔ `packages/spec` 未改动。
  - 沿用 #5131 / #5932 的 **TOUCH 闸门**:只校验本次 patch 触及的键。网格在产品生命
    周期里会被**放粗**(0.05 的滑杆改声明成 0.1),持有旧值的工作区必须仍能编辑无关设置。

  **锚点(anchor)约定:** 值须落在 `min + k * step` 上;未声明 `min` 时锚点取 `0`。
  这是 HTML step-base 约定,也是声明读起来的唯一自洽含义 —— `min: 1, step: 2` 指的是
  **奇数**,而不是偶数;一律锚 0 会把这个 specifier 整个反转。`constraint` 同时带
  `step` 与(声明了的话)`min`,客户端据此自行重建网格。

  **容差规则:** 网格判定为 `|value - nearest| <= max(|value|, |anchor|, |step|) * 1e-9`,
  其中 `nearest = anchor + round((value - anchor) / step) * step`。精确取模是错的 ——
  二进制浮点下 `0.7 / 0.1` 是 `6.999999999999999`、`1.2 / 0.1` 是 `11.999999999999998`,
  而这两个都是控制台滑杆自己会发出的值。容差取**相对**而非绝对:绝对量随操作数变化,
  `1e-9` 在 `step: 1e-6` 上会宽到三分之一步长,在 `max: 1048576` 上又比一个 ULP 还紧。
  `1e-9` 落在两类误差之间:double 的相对精度约 `2.2e-16`,几步算术累积约 `1e-15`,比这
  个界低六个数量级;而真正的越格差一小截步长(`0.15` 在 `0.1` 网格上差 `0.05`,相对
  `3e-1`),比它高八个数量级。比较在**值域**而非倍数域进行,以免容差的含义随网格粗细改变。
  剩余存疑的方向也是刻意的:本闸门是对「昨天什么都收」的收紧,所以在算术确实分辨不出时
  (量级大到网格比 double 自身间距还细)判**收**。

  **非正的 `step` 声明不构成网格。** `step: 0`(`anchor + k * 0` 是一个点)、负值、
  非有限值一律**不记录网格**,与「option-bearing specifier 没有 options 表」同一处置:
  无可执行者,行为不变,永不拒写。这与 #5204 的注册期姿态一致 —— 注册**报告**、从不
  拒绝 —— 而这里没有可报告的:声明了不可能网格的 manifest 既不拒写也不误配部署,它只是
  没有约束住,和其余没声明 `step` 的 specifier 处境完全相同。

  **已知后果,裁决时已接受:** 全仓库唯一的 `step` 声明是 `ai.manifest.ts` 的
  `temperature`(`min: 0, max: 2, step: 0.1`)。执行之后 `0.15` 被拒。这是该声明按其
  字面绑定,而不是本闸门的缺陷;这份声明本身是否该改(若 `0.15` 应当合法,则该 manifest
  应声明更细的 `step` 或不声明),属于 manifest 属主的问题。

- 9566c38: fix(service-settings): 写入路径与 env 路径执行 settings 声明的 min / max / minLength / maxLength (#5932)

  `SpecifierSchema` 从存在起就声明了五类值约束 —— `pattern` / `min` / `max` /
  `minLength` / `maxLength` —— 而 `SettingsService.validatePatch` 只读其中一类。
  另外四个在整个写入路径上**没有任何读取点**:已发布的 manifest 里 42 个
  specifier 声明了取值窗口,每一个都只是装饰。

  落点最重的是 `auth.password_min_length`。它声明 `min: 6`,控制台的数字框也按这个
  下限渲染,而 `PUT /api/settings/auth` 会接受 `1`(以及负数)并存下来,better-auth
  的口令策略随后照这个值执行。也就是说,声明是唯一一个宣称「存在下限」的东西,却没有
  任何一层在守它 —— 正是 Prime Directive #10 的正面形状。`ai.manifest.ts` 的六项
  (temperature / max_tokens / timeout 等)同理。

  **修法与 #5131(options 表)同形,是同一族的第三个成员:**

  - `validatePatch` 补一个取值窗口分支,发既有码表里的 `FieldError`(ADR-0114 D2):
    `min_value` / `max_value` / `min_length` / `max_length` —— 与
    `record-validator.ts` 对同一类越界发出的码一致。`constraint` 带**完整窗口**
    (`{ min, max }`,长度类再带 `actual`),客户端据此自行组织文案,不必解析我方
    英文句子。⛔ `packages/spec` 未改动:约束早已声明,码表现有即够用。
  - 沿用 #5131 的 **TOUCH 闸门**:只校验本次 patch 触及的键。取值窗口在产品生命周期里
    会被**收紧**(口令下限从 6 提到 8),窗口下方的老工作区必须仍能编辑它无关的设置,
    只在重写该键时才被告知。
  - env 侧走 `effectiveEnvOverride` 这**一个**判定点,与 options 表同处,复用同一组
    比较函数 —— #5204 的成因就是同一比较有两份实现并各自漂移。因此
    `OS_AUTH_PASSWORD_MIN_LENGTH=1` 与写入路径得到同一个裁决:该 override 不生效、
    不贡献 cascade 条目、不锁定该键,并在注册时打出一条(且仅一条)`error` 日志。

  **刻意不做的判断:** 取值窗口只裁决**可比较的值** —— `min`/`max` 只看数字(含经
  JSON / 表单往返变成字符串的数字),`minLength`/`maxLength` 只看字符串。布尔、数组、
  对象不做强制转换(`Number(true)` 是 1、`Number([])` 是 0):值的**形状**是
  `invalid_type`,属于另一个约束、另一个负责人,在这里发明裁决会拒掉本检查从未被要求
  过问的写入。空值仍归 `required` 管。

  约束的读取以**声明**为准,而不是以 specifier 的 `type` 为准 —— 与旁边按类型收口的
  options 检查不同,这个差异是 spec 定的:`SpecifierSchema` 的 superRefine 把 options
  表**绑定**到 `select`/`radio`/`multiselect` 三型,却没有把四个窗口键绑定到任何类型。
  在这里自拟一份类型清单,正是 options 注释警告的「第三份会漂移的清单」,并且会把本
  issue 原样复制到下一层:窗口键声明在清单外的类型上,照样解析、照样渲染、照样不执行。

- d538647: fix(service-settings): refuse a save whose `visible` predicate cannot be evaluated, instead of silently skipping the field's `required` gate (#7169)

  **Before:** a settings specifier whose `visible` predicate the save-time
  evaluator could not parse was skipped entirely — `validatePatch` answered the
  parse failure with `catch { continue }`. Because `visible` is the gate every
  other check hangs off, that `continue` switched off `required`, `options`,
  `pattern`, `valueDomain` **and** the value window on that key at once, silently
  and permanently, with no diagnostic anywhere. A half-filled provider form saved
  clean.

  **After:** the write is refused. `setMany` throws `SettingsValidationError`
  (`SETTINGS_VALIDATION`, HTTP 400) carrying one `FieldError` per offending
  specifier — `code: 'invalid_value'`, the parse reason in `message`, and the
  predicate itself under `constraint.visible`, so a client can name which
  expression refused without parsing prose. Refusal is **unconditional**, not
  gated on the patch touching the key: the console posts only its dirty keys, so a
  touch gate would never fire on the incident this fixes. All-null patches
  (namespace reset) still return before the check, so a namespace whose manifest
  is broken can always be cleared.

  This is the interim stop-the-bleed half of the maintainer's 2026-08-10 ruling on
  #7169. The declaration/implementation gap it stems from is still open:
  `packages/spec` types both settings `visible` slots as `ExpressionInputSchema`,
  which labels their contents **CEL**, while this service evaluates a hand-rolled
  JS-ish subset. Measured over the 94 `visible` predicates in the bundled
  manifests, wiring CEL into evaluation would break 93 of them and narrowing the
  declared type would break 1 — see the PR for the numbers. Narrowing is
  recommended and lands separately in `packages/spec`.

  **Also fixed, and load-bearing for the above:** the evaluator now supports the
  relational operators `>`, `>=`, `<`, `<=`, with the same JS semantics the
  console's client-side evaluator applies to the same strings. The auth manifest
  already shipped `visible: '${data.lockout_threshold > 0}'`, which this grammar
  refused — so on the old fail-open path `auth.lockout_duration_minutes` accepted
  `-5` and `99999` against its declared `min: 1, max: 1440`. That window is
  enforced again.

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
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

- 586d6f7: feat(auth): `membership_policy` is a platform setting, and sign-up and backfill read one source (#5152)

  **What a new user joins is now configurable at runtime.** ADR-0093's
  `membershipPolicy` decides whether a freshly created user is auto-bound to the
  deployment's default organization (`auto`) or gets membership only from an
  explicit act — creating a workspace, accepting an invitation, an admin adding
  them, SSO just-in-time provisioning (`invite-only`). Until now it was settable
  **only** as an `AuthPlugin` constructor option, and the AuthPlugin a self-hosted
  stack gets is injected by the CLI, which passes no such option and has no env
  fallback. Every self-hosted deployment therefore ran `auto`, with no way to say
  otherwise. `invite-only` was, in practice, unreachable outside a custom host.

  It is now `auth.membership_policy` in the platform settings — a two-value select
  (`auto` / `invite-only`, default `auto`) alongside `signup_enabled`, which it
  pairs with: one says whether people may self-register, the other says what they
  join when they do. Set it in Setup → Authentication → Membership, or pin it
  per-deployment with `OS_AUTH_MEMBERSHIP_POLICY`. It applies **without a
  restart** — the existing `settings.subscribe('auth', …)` re-application seam
  carries it, the same one the password-policy keys ride.

  **No behaviour changes unless you set it.** Only an _explicit_ value applies;
  the manifest's `auto` default is a UI default and never masks a deployment that
  configured the policy in code. A stack that sets nothing keeps today's
  auto-binding exactly.

  **Bug fix — the two membership paths read one source.** Sign-up (the reconciler
  in better-auth's `user.create.after`) read the AuthManager's live config, while
  the ADR-0093 D6 backfill of pre-existing member-less users read the plugin's
  **constructor options**. Wiring a setting to the first and not the second would
  have produced "sign-up honours the new policy, backfill still runs the old one"
  — and the backfill binds in **bulk**, so it is the more dangerous half. Both now
  resolve the policy through the new `AuthManager.getMembershipPolicy()`, and the
  backfill waits for the settings namespace to bind before its first pass (the two
  `kernel:ready` hooks fire in registration order, which was the wrong order).

  **An invalid value is rejected, not coerced.** `PUT /api/settings/auth` refuses
  a policy outside the declared option table (`invalid_option`, naming the allowed
  set). A value arriving from `OS_AUTH_MEMBERSHIP_POLICY` — which bypasses that
  validation — is logged at `error` and **ignored**, leaving the deployment's
  current policy in force; it is never silently read as `auto`, because that would
  leave an operator believing a wall is up while every sign-up is auto-bound.

  New public API on `@objectstack/plugin-auth`: `AuthManager.getMembershipPolicy()`,
  plus `MEMBERSHIP_POLICIES` and `isMembershipPolicy()` from `reconcile-membership`.

- 9c4f174: feat(plugin-email): durable email delivery through `sys_job_queue`, opt-in (#5160)

  `IEmailService.send()` has always delivered **inline**: the SMTP session ran
  inside the caller's `await`, and `EmailService`'s retry loop lived in the same
  process — so a crash between the attempt and the retry dropped the message with
  no trace beyond a `sys_email` row stuck at `queued`. The pieces for a durable
  path all existed (`sys_job_queue`, the `DbQueueAdapter`, an `email.send.async`
  subscriber) but nothing in the repo ever published to that topic.

  **New: `queueDelivery`.** With it on, `send()` persists the `sys_email` row,
  publishes an `email.send.async` job **referencing that row**, and returns
  `{ status: 'queued' }` immediately. A worker delivers the row and finalizes it
  in place (`sent` + `message_id`, or `failed` + `error`); the queue retries with
  exponential backoff (1s → 5min cap) and dead-letters the job when the attempts
  run out, so a restart resumes delivery instead of losing it. The `'queued'`
  status was already in `EmailDeliveryStatus` — no spec change.

  Three ways to turn it on, all default-off:

  - `new EmailServicePlugin({ queueDelivery: true })`
  - `OS_EMAIL_QUEUE_ENABLED=true` (or `config.email.queueDelivery`) on `os serve`
  - Settings → Mail → **Durable queue delivery**, hot-applied without a restart

  **One retry budget, not two.** `retries` keeps its meaning — total attempts are
  `retries + 1` in both modes. Inline it drives the in-process loop; queued it
  becomes the queue's `maxAttempts` and the per-row loop is pinned to one attempt
  per delivery. Turning the toggle on changes _where_ a retry happens (durable,
  backed off) and never _how many_ happen, so the two layers cannot multiply.

  **Fixed in the same change: the `email.send.async` subscriber inserted a new
  `sys_email` row per delivery.** It called `send()` with the message, so a job
  the queue retried five times left five rows — four permanently `failed`, none
  carrying the real attempt count. It now delivers the referenced row via
  `deliverPersistedRow`, so one message is one row and `attempt_count`
  accumulates on it. Messages published in the old shape (a bare `SendEmailInput`)
  are still accepted and delivered inline for a migration window.

  Boundaries worth knowing before you switch it on:

  - **"Send test email" always sends inline**, in every mode — the button has to
    report the provider's own answer (`535 …`), and "queued" is exactly the
    non-answer #5087 removed from it.
  - **Messages with attachments or custom headers are delivered inline**, because
    `sys_email` has no columns for them and a queued copy would arrive stripped.
    Queueing them is tracked separately; this ships the loss-free behaviour.
  - **A declaration that cannot be honoured fails the boot.** `queueDelivery: true`
    from the constructor or `OS_EMAIL_QUEUE_ENABLED` with no durable queue
    registered (or with `persist: false`) throws on `kernel:ready`, naming the
    fix — the #5132 judgement, applied to durability. The **settings toggle** is
    the opposite trade: it logs at `error` and keeps sending inline, because one
    save must not stop the mail.
  - The kernel's built-in in-memory `queue` fallback does **not** count as a
    durable queue: it delivers synchronously with no retry or DLQ, so publishing
    to it would report `queued` for a message nothing could ever recover. Mount
    `@objectstack/service-queue` over an ObjectQL engine (the `queue` capability
    does this on `os serve`) to get the `sys_job_queue`-backed adapter.

  Leaving `queueDelivery` unset keeps today's behaviour byte for byte.

- 8597a7d: fix(service-settings,plugin-email): the mail provider dropdown lists only providers that actually deliver (#5094)

  **Settings → Mail → Provider** offered `SMTP | SendGrid | Amazon SES | Postmark`.
  `@objectstack/plugin-email` has never carried a SendGrid or an SES transport —
  `makeTransport` knows `log` / `resend` / `postmark` / `smtp` and nothing else. So
  selecting either of the two validated, saved, showed a success toast, and then
  delivered no mail at all: the same declared-but-not-delivered gap #5087 closed
  for SMTP, one field to the left.

  The same field broke the invariant in the other direction at the same time:
  **`resend` has shipped a working transport all along and was not on the list**,
  so nobody could pick the one HTTP provider that worked.

  **The dropdown is now `SMTP | Resend | Postmark | None (log only — no real
delivery)` — exactly the set `makeTransport` can build.** No email capability was
  removed with SendGrid and SES. Both publish SMTP endpoints, and #5087 shipped a
  real `SmtpTransport`, so both are configured today as `smtp`:

  | provider   | host                                | port | credentials                                                                        |
  | :--------- | :---------------------------------- | :--- | :--------------------------------------------------------------------------------- |
  | SendGrid   | `smtp.sendgrid.net`                 | 587  | username `apikey`, password = your API key                                         |
  | Amazon SES | `email-smtp.<region>.amazonaws.com` | 587  | SES **SMTP credentials** (generated in the SES console — not your AWS access keys) |

  The provider field's own description says this, so the migration is in front of
  whoever goes looking for the option that disappeared.

  `log` is listed rather than hidden. It is the one option that does not deliver —
  but it does not pretend to: the label says so, `LogTransport` still records every
  message to `sys_email`, and "Send test email" answers `ok: false` for it. That
  gives an operator the deliberate, visible opt-out AGENTS.md asks a degradation to
  be, instead of expressing "no outbound mail" as a half-filled SMTP form. It is
  also what makes _offered_ and _deliverable_ the same set rather than merely
  overlapping — which is the property a test can hold.

  **Already saved `sendgrid` or `ses`? Nothing breaks and nothing goes quiet.** The
  stored value outlives the dropdown, so `applyMailSettings` now recognises it
  explicitly: the previous transport is kept (a settings row written by an older
  release must never fail a boot), and the server logs at `error` with both halves
  AGENTS.md requires — the consequence (_no mail is delivered through it_) and the
  fix (the SMTP settings above), not a bare "unknown provider". It is checked
  _before_ the API-key check, because "set an API key" is the wrong instruction for
  a provider that has nothing to hand a key to. "Send test email" refuses the same
  way and sends nothing. Switching the provider to `smtp` and saving recovers the
  transport without a restart.

  Two smaller corrections in the same field:

  - `api_key` is now shown and required for exactly `resend` and `postmark`
    (`provider === 'resend' || provider === 'postmark'`). It was `provider !==
'smtp'`, which only worked because every non-SMTP option happened to be an
    HTTP API; `required` is enforced server-side wherever the field is visible, so
    that expression would have refused to save "None (log only)" until an API key
    it never reads had been typed in.
  - The built-in `mail/test` fallback (the one that runs when no email plugin is
    mounted) rejects any `provider` outside the manifest's own option list instead
    of answering "the form is well-formed".

  **Held by a test, in both directions.** `EMAIL_TRANSPORT_PROVIDERS` is now a
  runtime array (the `EmailTransportProvider` union is derived from it), and
  `plugin-email`'s `mail-manifest-providers.contract.test.ts` asserts set equality
  between it and the manifest's option values, then builds a real transport for
  each. Adding an option without a transport fails; adding a transport without an
  option fails. `RETIRED_EMAIL_PROVIDERS` / `isEmailTransportProvider` /
  `unsupportedProviderFix` are exported alongside it for hosts that surface the
  same guidance.

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

- 4022b78: Settings: an `OS_*` env override is now checked against the specifier's declared `options` table (#5204)

  A manifest's `options` table has been enforced on the write path since #5131, but
  `SettingsService.get()` produced an effective value by a second route that never
  consulted it: an `OS_*` override was reshaped by the default's type and returned
  straight from the top of the cascade with `locked: true`. So the providers #5094 and
  #5133 retired from `mail.provider` could walk back in through the one door with no
  gate on it — `OS_MAIL_PROVIDER=sendgrid` reached the mail plugin unchallenged — and a
  plain typo such as `OS_BRANDING_THEME_MODE=drak` was served to every consumer as a
  normal value with normal-looking provenance, each consumer left to improvise.

  An override whose value the table does not declare is now **ignored** rather than
  repaired: the value falls through to the next layer of the cascade (a stored
  global/tenant/user value, else the manifest default), and the read API reports that
  layer honestly instead of claiming `source: 'env'` for a value not in force. The
  rejection is logged once at `error`, naming the variable, the rejected value, the legal
  value set and the consequence. The same audit runs at `registerManifest`, so a
  misconfigured deployment learns at boot rather than whenever somebody first opens the
  settings page.

  Registration **reports but never refuses**: option tables move, a pin that was legal
  the day it was written must not turn an upgrade into a crash-on-start.

  Two behaviour notes for anyone relying on the old shape:

  - Keys with no declared option table are untouched — text, boolean, number and
    password overrides behave exactly as before. The check applies only to
    `select`/`radio`/`multiselect` specifiers that declare a non-empty table.
  - A **rejected** override no longer pins its key against writes. `setMany` used to
    refuse on the mere presence of the variable; judged by presence, an ignored value
    would have left the key configurable by nothing at all — env value discarded, UI
    refused with `SETTINGS_LOCKED`, and `get()` reporting `locked: false` to a settings
    page whose save would then fail. An override that _is_ in force still locks the key,
    unchanged.

- 82a06af: fix(service-settings): a settings `select` now rejects values outside its declared `options` (#5131)

  `SettingsService.validatePatch` enforced two of the constraints a settings
  manifest declares — `required` and `pattern` — and skipped the third. A
  specifier's `options` table never took part in save-time validation, so any
  string at all could be written into a dropdown field:

  ```ts
  await svc.setMany("mail", { provider: "sendgrid", from_email: "a@b.com" }); // stored
  ```

  Going through the console this was unreachable: the dropdown only ever emits a
  value from the table. But `PUT /api/settings/:ns` is an authorizable public
  surface, and scripts, migration tools and AI-authored bootstrap code write it
  directly — where the bad value was accepted, persisted and read back **in
  silence**, leaving every consumer to improvise its own answer for an
  enumeration member that does not exist. It was not `mail`-specific:
  `storage.adapter`, `sms.provider`, `ai.provider`, `localization.date_format` and
  every other `select` behaved the same way.

  This is the API-side gate that #5094 was missing. That change retired
  `sendgrid` / `ses` from the `mail` provider table because this server cannot
  deliver through them — with no write-side enforcement, the values it had just
  retired could be written straight back in the same afternoon.

  **Now:** a `select` / `radio` / `multiselect` value that is not a member of the
  declared table is rejected with a `FieldError` whose `code` is `invalid_option`
  and whose `constraint` carries the allowed set (`{ allowed: 'smtp, resend,
postmark, log' }`), so a client composes its own message instead of parsing
  ours. The enforced set is the spec's own: `SpecifierSchema` already _requires_ a
  non-empty `options` on exactly those three types, so declared and enforced name
  one list rather than two that can drift.

  Two deliberate limits keep this from breaking workspaces that already carry
  drift:

  - **The check is gated on TOUCH**, like `required` and `pattern` before it. A
    value that pre-dates the current option table only fails the patch that
    writes that key — editing `from_name` is not rejected because a stale
    `provider` sits in the store. The opposite rule would lock every workspace
    with historical drift out of its own settings page entirely, which is worse
    than the gap being closed. Resets (all-null patches) are never blocked.
  - **A specifier that declares no option table is left alone.** It cannot say
    what is legal, so it stays lenient rather than rejecting every write.

  Values are compared in string form, so an option declared `value: 30` still
  matches after a round trip through JSON or a form post. There is no opt-out: a
  manifest that needs to accept custom values would declare that explicitly in
  the spec, not rely on a tolerant consumer.

- 41c3b48: feat(plugin-email): real SMTP delivery — `SmtpTransport`, settings hot-swap, and a `mail/test` that actually sends (#5087)

  The **Mail Delivery** settings page has always defaulted to SMTP and offered a
  full host / port / TLS / username / password form. Nothing behind it delivered:
  `applyMailSettings` treated `provider: 'smtp'` as a no-op ("transport
  unchanged"), `mail/test` answered `ok: true, "Configuration looks valid … Wire
@objectstack/plugin-mail for actual delivery"` — a success toast for a message
  nobody sent, naming a package that has never existed — and the code pointed
  operators at `@objectstack/plugin-mail-smtp`, which is not in this repo or on
  npm. A workspace that selected SMTP got a green form, a green test button, and
  mail that only ever reached the log and the `sys_email` table. For deployments
  in China this left **no** working channel at all: Resend and Postmark are
  overseas HTTPS SaaS with unreliable reach and deliverability to QQ / 163 /
  enterprise mailboxes, where SMTP is the normal path (Aliyun DirectMail, Tencent
  SES, corporate mail servers).

  **`SmtpTransport` now ships in `@objectstack/plugin-email`** (ADR-0012: SMTP in
  core, implemented with `nodemailer`). `nodemailer` is a real dependency but is
  imported **lazily on the first send**, so deployments that never select SMTP —
  and non-Node runtimes — never load `node:net` / `node:tls`.

  Three doors reach it, all sharing one options reader so they cannot drift:

  - **Settings → Mail** (`smtp_host` / `smtp_port` / `smtp_secure` / `smtp_user` /
    `smtp_password`) hot-swaps the live transport on save, no restart.
  - **`os serve`** via `OS_EMAIL_PROVIDER=smtp` plus the new `OS_EMAIL_SMTP_HOST` /
    `_PORT` / `_SECURE` / `_USER` / `_PASSWORD` (or `config.email.options`).
  - **Constructor**: `new EmailServicePlugin({ provider: 'smtp', providerOptions:
{ host, port, secure, user, password } })`.

  TLS is one toggle with the wire behaviour derived from the port, as providers
  document it: on `465` implicit TLS (SMTPS); on any other port a **required**
  STARTTLS upgrade, so a server that refuses to upgrade fails the send instead of
  leaking credentials over a cleartext socket; `secure: false` connects in the
  clear and upgrades only when STARTTLS is offered.

  **Failure is loud everywhere, because a silent fallback is the bug this fixes.**
  On the construction path (CLI / plugin options) a `smtp` provider with no host
  **throws** and the boot fails — it no longer degrades into a LogTransport that
  reports every send as successful. On the settings hot-swap path a save can never
  kill a running server, so the previous transport is kept — but the failure is
  logged at `error` naming the consequence and the fix, and **`mail/test` now
  performs a real delivery** through the settings on screen and reports the SMTP
  server's own words (`535 … authentication failed`) instead of a green toast. The
  built-in fallback `mail/test` handler (used only when no email plugin is
  mounted) answers `ok: false` and says plainly that nothing was sent.

  Nothing to migrate: `log`, `resend` and `postmark` behave exactly as before, and
  a deployment that never selects `smtp` is unaffected.

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
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
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [02dc076]
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
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
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
- Updated dependencies [b25a116]
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
  - @objectstack/types@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- f1f40b4: refactor!: settings error bodies stop hanging undeclared keys beside `code`/`message` (#4224)

  Four `/api/settings/*` error branches spread ad-hoc context as SIBLINGS of `code`
  and `message` inside `error`. `ApiErrorSchema` declares `code`, `message`,
  `category?`, `httpStatus?`, `details?`, `requestId?` — and none of `namespace`,
  `key`, `reason`, `fields`. The bodies passed every gate anyway: `ApiErrorSchema`
  is a plain `z.object`, so unknown keys were **stripped** rather than rejected,
  and `envelopeViolations` inspects only the body's top level. They were conformant
  _by stripping_, not by declaration. The same module already used the declared
  slot correctly one branch over (`SETTINGS_ACTION_FAILED` → `error.details`), so
  this is one file speaking two dialects, not a missing capability.

  **Wire change — FROM → TO.** In every case the values are unchanged; only their
  position moves, into the `details` slot the contract declares:

  | Code                  | HTTP | FROM                                           | TO                                                                     |
  | --------------------- | ---- | ---------------------------------------------- | ---------------------------------------------------------------------- |
  | `SETTINGS_FORBIDDEN`  | 403  | `error.namespace`                              | `error.details.namespace`                                              |
  | `UNKNOWN_KEY`         | 400  | `error.namespace`, `error.key`                 | `error.details.namespace`, `error.details.key`                         |
  | `SETTINGS_LOCKED`     | 409  | `error.namespace`, `error.key`, `error.reason` | `error.details.namespace`, `error.details.key`, `error.details.reason` |
  | `SETTINGS_VALIDATION` | 400  | `error.namespace`, `error.fields`              | `error.details.namespace`, `error.details.fields`                      |

  **One-line fix for a consumer:** read `error.details.<key>` where you read
  `error.<key>`, or `error.details?.<key> ?? error.<key>` if you support servers on
  both sides of the change. The console's own fix (objectui#3078) is the tolerant
  form.

  **`SETTINGS_VALIDATION.fields` also changes shape**, because `fields` is the name
  ADR-0114 (#3977) closed for `FieldError[]` and keeping a map under it would leave
  one spelling meaning two shapes:

  - **FROM** `{ [key]: message }` — a `Record<string, string>`, the constraint named
    only in the prose of the message.
  - **TO** `FieldError[]` — `{ field, code, message, label, constraint? }`, where
    `code` is a member of the closed field-level catalog: `required` for an empty
    required specifier, `invalid_format` for a value that misses its declared
    `pattern` (which travels as `constraint.pattern`).

  A consumer that rendered the map's values reads `f.message` per entry instead;
  one that wants to branch on _why_ a value was rejected can now read `f.code`
  rather than substring-matching English. objectui's `extractFieldErrors` already
  reads `details.fields`, so settings validation failures become renderable
  per-field there with no further change.

  **The exported `SettingsValidationError.fields` changes with it** — same
  `Record<string, string>` → `FieldError[]` mapping — since the route only relays
  what the service throws, and the constraint kind is knowable at the throw site
  and nowhere after it.

  `sendError`'s last parameter is tightened from `extra?: Record<string, unknown>`
  to `ApiError`'s own optional fields, and its `code` from `string` to the closed
  ADR-0112 `ErrorCode` union. That is what keeps this fixed: an undeclared sibling
  is now a compile error at the call site rather than a key that quietly evaporates
  at the schema boundary.

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

- 0931185: fix(rest,service-settings,service-datasource)!: four more route modules emit the declared envelope, and the guard is now shared (#3843)

  #3675 and #3689 moved `service-storage` and `service-i18n` onto the declared
  response envelope (`BaseResponseSchema` + `ApiErrorSchema`). Each scoped itself
  to one service, and neither asked whether the same drift existed elsewhere. It
  did — in four more modules, and in two of them it was the _older_ shape, the one
  #3675 had already declared wrong:

  | Module                                | before                                                         | now           |
  | ------------------------------------- | -------------------------------------------------------------- | ------------- |
  | `service-settings/settings-routes.ts` | nested `error`, no `success` on any of 5 bodies                | full envelope |
  | `service-datasource/admin-routes.ts`  | `{ error: '<string>' }`, `message` a **sibling**               | full envelope |
  | `rest/external-datasource-routes.ts`  | `{ error: '<string>' }` + a private `ok`                       | full envelope |
  | `rest/package-routes.ts`              | 3 of 16 bodies had `success`, 2 failures had no `error` at all | full envelope |

  ## Breaking: where to read things now

  **Success payloads move under `data`.** The keys are unchanged — only their
  depth. `unwrapResponse` in `ObjectStackClient` returns `body.data` when the flag
  is present, so every SDK method (`packages.list()`, `datasources.external.*`)
  resolves to exactly the object it always did. Raw `fetch` callers must add one
  hop:

  ```
  GET  /api/v1/datasources            body.datasources     → body.data.datasources
  GET  /api/v1/datasources/drivers    body.drivers         → body.data.drivers
  GET  /api/v1/datasources/:name      body.datasource      → body.data.datasource
  GET  /api/v1/packages               body.packages        → body.data.packages
  GET  /api/v1/packages/:id           body.package         → body.data.package
  GET  /api/settings                  body.manifests       → body.data.manifests
  GET  /api/settings/:ns              body.manifest/.values → body.data.manifest/.values
  POST /…/external/validate           body.ok, body.results → body.data.ok, body.data.results
  ```

  `SettingsNamespacePayloadSchema` and friends still describe those payloads
  exactly; they now describe the envelope's `data` rather than the whole body.

  **Error bodies stop being a string.** `{ error: 'datasource_admin_error',
message }` → `{ success: false, error: { code: 'datasource_admin_error',
message } }`. Read `body.error.message`, not `body.message`; read
  `body.error.code`, not `body.error`. This is the asymmetry #3675 opened on: a
  caller reading `body.error.message` previously got the real message from the
  dispatcher and `undefined` from these routes.

  **Two failures that never said why now do.** `DELETE /api/v1/packages/:id`
  answered a bare `{ success: false }` and a bare
  `{ success: false, failed, cleanups }`. They are now `PACKAGE_DELETE_FAILED` and
  `PACKAGE_DELETE_PARTIAL`, with the per-item `failed` / `cleanups` arrays under
  `error.details`.

  **Codes follow ADR-0112.** #3841 settled the vocabulary while this was in review:
  `error.code` is SCREAMING_SNAKE and `ApiErrorSchema.code` is now the closed
  `ErrorCode` union, so an unregistered code fails schema parse. Generic conditions
  reuse the STANDARD catalog rather than becoming registered synonyms of it, per the
  ledger's own guidance:

  ```
  datasource_admin_unavailable  → SERVICE_UNAVAILABLE      (standard)
  external_service_unavailable  → SERVICE_UNAVAILABLE      (standard)
  not_found / PACKAGE_NOT_FOUND → RESOURCE_NOT_FOUND       (standard)
  PUBLISH_FIELDS_MISSING        → MISSING_REQUIRED_FIELD   (standard)
  INTERNAL                      → INTERNAL_ERROR           (standard)
  datasource_admin_error        → DATASOURCE_ADMIN_ERROR   (registered)
  external_import_error         → EXTERNAL_IMPORT_ERROR    (registered)
  PUBLISH_MANIFEST_INVALID      → PACKAGE_MANIFEST_INVALID (registered)
  PUBLISH_FAILED                → PACKAGE_PUBLISH_FAILED   (registered)
  PACKAGE_DELETE_PARTIAL / PACKAGE_DELETE_FAILED / SETTINGS_ACTION_FAILED (registered)
  ```

  Which service is unavailable is carried by `message`. The seven registered codes are
  added to `ERROR_CODE_LEDGER` under their owning packages — including a new
  `@objectstack/service-datasource` entry.

  **`POST /external/validate` keeps its `ok`.** Unlike the `{ ok: true, key }`
  #3689 retired from storage — a private second word for `success` — this `ok` is a
  computed verdict over the federated objects (`results.every(r => r.ok)`). The
  request can succeed while the verdict is false, so the two flags are not the same
  field; `ok` moves inside `data` rather than being dropped.

  Consumers were taught both shapes first, so the two repos are not coupled by
  merge order: objectui's `packages` readers were already tolerant
  (`payload?.data ?? payload`), and its datasource page plus the generic
  `type: 'api'` action runner now unwrap the envelope and read `error.message`
  (the latter previously toasted `[object Object]` for any nested error).

  ## The guard is shared now, not copied

  `scripts/check-route-envelope.mjs` + `pnpm check:route-envelope`, wired into
  `lint.yml` alongside the nine sibling `check:*` guards. Its load-bearing assertion
  is structural rather than per-route: **it counts the response write sites per
  module.** When every body goes through the `sendOk` / `sendError` pair that count
  is fixed at two and does not grow with the route list — so a _future_ route that
  hand-rolls a body fails the guard. That is the coverage a driven-body test can
  never give, since it can only drive the routes that existed the day it was
  written.

  This existed three times already as an open-coded regex block (storage error,
  storage success, i18n error). Lifting it did more than deduplicate: a per-package
  scan **structurally cannot notice a module nobody thought to convert**, and going
  repo-wide found two the moment it ran — neither is in #3843's hand-written survey:

  - `plugin-sharing/share-link-routes.ts` — the fifth drifting module. No body
    carries `success`, and one answers `{ ok: true }`, the private second word #3689
    retired from storage. Filed as #3983 and pinned by the guard; converting it is
    breaking for share-link consumers and needs its own sweep.
  - `metadata/routes/hmr-routes.ts` — declared **exempt** with a reason (dev-only
    SSE endpoint, not on the SDK surface), not skipped. Three states, deliberately —
    conformant / ratcheted / exempt — because that is the honest classification
    ADR-0049 asks for. A route module the scan finds but the table does not declare
    is an **error**, never a default: applying `2 / 1 / 1` to an unknown module would
    let a new one pass by coincidence.

  It also drops the regex for the TypeScript AST, fixing two real bugs the copies
  had. They stripped comments with `String.replace`, whose line-comment pattern also
  ate `//` inside string literals and truncated the rest of that line — response
  writes included. And `.json(` does not mean "write a response": `hmr-routes.ts`
  calls `c.req.json()` twice to READ a request body, which a textual count reports as
  two unenveloped responses. Comments and literals are not AST tokens, and
  request-vs-response is a property of the callee, so both disappear. The script
  carries a `--self-test` pinning each case — the nine sibling guards have none, but
  both of these bugs survived a review of the regex version.

  **The i18n ratchet, stated rather than hidden.** `i18n-service-plugin.ts` is
  declared at `responses: 5, ok: 4, err: 1` with a ratchet pointing at #3973. Its
  error half _is_ consolidated (#3675), but each of its four read routes builds
  `{ success: true, data }` inline. Those bodies are correct — that is not envelope
  drift — but an unconsolidated builder is a weaker guard: a fifth read route could
  get the shape wrong and only a driven test would notice. The numbers pin today's
  structure exactly (a new inline body fails) and drop to the conformant `2 / 1 / 1`
  when #3973 lands.

- d5749d7: refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

  `BaseResponseSchema` declares one envelope for every REST body the platform
  emits. It declared it once; the code that _wrote_ it was copied per route
  module. After #3843 and #3983 converted the last drifting one, seven modules
  each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
  shape lived in fourteen places rather than one.

  `pnpm check:route-envelope` proved those seven copies agreed, which is why this
  is a cleanup rather than a bug fix. But a guard proves agreement; it does not
  create it. An eighth module starts by copying the pair again — not
  hypothetically: `share-link-routes.ts` was found already drifting by the
  repo-wide scan, and its drift had broken `client.shareLinks.create()` and
  `.list()` through `unwrapResponse` (#3983).

  ## What moved

  `sendOk` / `sendError` now live once, in `@objectstack/types`
  (`response-envelope.ts`), and all seven modules import them:

  | Module                                |
  | ------------------------------------- |
  | `service-storage/storage-routes.ts`   |
  | `service-settings/settings-routes.ts` |
  | `service-datasource/admin-routes.ts`  |
  | `rest/external-datasource-routes.ts`  |
  | `rest/package-routes.ts`              |
  | `service-i18n/i18n-service-plugin.ts` |
  | `plugin-sharing/share-link-routes.ts` |

  Placement was the open question in #3973, not design. `packages/spec` is
  schemas-only (Prime Directive #2), and the callers span `rest`, four
  `services/*` and one `plugins/*`, which rules out anything depending on them.
  `@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
  can reach it, and it is already where the repo puts a helper the HTTP boundaries
  share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
  same argument first.

  The builders take a structural `{ status(n), json(body) }`, so the package
  imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
  `any`-typed `res` the older modules carry.

  ## `error.code` is now checked by the compiler

  All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
  vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
  invented code was still caught only at runtime, by a conformance suite parsing a
  driven body, i.e. only on routes some test happened to drive.

  The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
  fails to compile, at every call site at once:

  ```ts
  sendError(res, 400, "NOT_A_REGISTERED_CODE", "invented");
  // Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
  ```

  This cost no call-site churn: every code the seven modules emit was already
  registered.

  ## `extra` is closed at the same place

  `sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
  and `message`.

  It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
  `key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
  `ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
  rejected, and `envelopeViolations` inspects only the body's top level —
  conformant _by stripping_ rather than by declaration. #4224 moved that module
  onto `details`, which is what lets the parameter close here. Closing it at the
  shared builder is the part that lasts: an undeclared sibling is now a compile
  error in every module at once, rather than a key that quietly evaporates in
  whichever module reintroduces it.

  ## Nothing changes on the wire

  The seven pairs were identical modulo the optional `status` and `extra`
  parameters this one unions, and each module's driven conformance suite still
  parses its real bodies against the real spec schemas. One internal call site was
  rewritten: `package-routes` passed `details` positionally and now passes
  `{ details }`, producing the same `error.details` it always did.

  ## The guard got stronger

  `scripts/check-route-envelope.mjs` counts response write sites per module. A
  module that routes everything through the shared pair builds **none** itself, so
  the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
  shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
  the surface rather than per-module. What the count asserts is no longer "your two
  builders are the enveloped ones" but "you have no builders" — and a new route
  that hand-rolls a body still moves it off zero and fails.

- 64f8cbe: feat(platform-objects,service-settings,verify): `sys_secret` is platform infrastructure — registered by `PlatformObjectsPlugin`, not by the settings service (#4270)

  The environment's encrypted-secret store (`sys_secret`, ADR-0066 D2/④) was
  registered by `@objectstack/service-settings`, but it has three producer
  classes and only one of them is settings: the settings service's encrypted
  specifiers, the ObjectQL engine's own `secret`-field encryption
  (`encryptSecretFields`/`resolveSecret` — the generic write path of ANY
  business object carrying a `Field.secret()`), and the datasource credential
  binder. Unlike the `sys_migration` precedent (#4243), the failure posture is
  fail-CLOSED: on a kernel composed without settings, every insert/update of an
  object with a secret field threw — with an error message that told the
  operator to "Ensure the platform-objects (sys_secret) are registered", naming
  a package that did not register it.

  The registration now lives in `PlatformObjectsPlugin`
  (`@objectstack/platform-objects/plugin`) — the plugin `os serve` already
  auto-injects into every served kernel — so the store exists with the
  platform, independent of which optional services are composed, and the
  engine's fail-closed error message is true. Definition ownership is unchanged
  (`sys_secret` stays in `@objectstack/platform-objects` and in
  `PLATFORM_OBJECTS_BY_PACKAGE`); the settings service remains a producer and
  consumer through its `sys_secret`-backed secret store.

  Consequences:

  - `@objectstack/service-settings` no longer contributes `sys_secret` to the
    manifest (`settingsObjects` is now `[SysSetting, SysSettingAudit]`). An
    embedder composing `SettingsServicePlugin` on a hand-built kernel that
    relied on it for the `sys_secret` table must compose
    `PlatformObjectsPlugin` (the plugin every supported assembly path already
    includes). The move REPLACES the registration — nothing registers the
    object twice.
  - `@objectstack/verify`'s boot harness now composes `PlatformObjectsPlugin`,
    mirroring `os serve`'s auto-inject — which also means harness kernels now
    carry the `sys_migration` ledger + fresh-datastore attestation (#4243) the
    served assembly always had.

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
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
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
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [39eb01b]
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
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Patch Changes

- a629074: fix(auth): the second factor now obeys the operator's lockout policy instead of better-auth's defaults (#3690)

  `auth-manager.ts` constructed `twoFactor()` with a schema and nothing else, so
  better-auth's built-in `accountLockout` defaults — on, 10 attempts, 15 minutes —
  governed two-factor verification no matter what the admin configured. An operator
  who tightened **Setup → Authentication → Account lockout threshold** to 3 got a
  password stage that locked at 3 and a second factor that still locked at 10: the
  stricter door was the looser one, with nothing in the UI saying so.

  `lockout_threshold` / `lockout_duration_minutes` are now projected onto
  better-auth's own `accountLockout` shape (`enabled` / `maxFailedAttempts` /
  `durationSeconds`, minutes converted to seconds) rather than growing a parallel
  `two_factor_lockout_*` pair — one policy, one mental model, and a future upstream
  field arrives as a new option instead of a conflict. The projection goes through
  `applyConfigPatch`, which resets the cached better-auth instance, so a settings
  change takes effect without a restart.

  Threshold `0` is deliberately **not** forwarded as `enabled: false`. It is the
  password stage's "off", and a deployment may leave that stage unlocked because
  rate limiting or an IdP covers it; the second factor is the last check before a
  session is issued, so it keeps better-auth's default rather than being switched
  off by a setting that never mentioned it.

  The threshold field is also no longer hidden behind `email_password_enabled` —
  two-factor verification exists in passwordless deployments, where the setting was
  previously unreachable.

  The admin **Unlock Account** action now clears both stages. It only ever reset
  `sys_user`, so a user locked at the second factor had no admin escape hatch and
  had to wait the duration out — survivable while that lock needed 10 failures,
  routine once an operator can set the threshold to 3. The second-factor clear is
  best-effort and runs after the primary write, so an account with no enrolment
  still unlocks normally.

  Note the plugin caps attempts at 5 per challenge (`beginAttempt(5)`), which no
  option reaches; a threshold above 5 forces a fresh challenge rather than raising
  that cap.

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
- Updated dependencies [840ee4b]
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
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
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
- Updated dependencies [030125b]
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
  - @objectstack/types@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/types@16.1.0

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
- Updated dependencies [83e8f7d]
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
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
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
  - @objectstack/types@16.0.0

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
  - @objectstack/types@16.0.0-rc.1

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
- Updated dependencies [83e8f7d]
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
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
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
  - @objectstack/types@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1
- @objectstack/platform-objects@15.1.1

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
- Updated dependencies [4109153]
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
  - @objectstack/spec@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0

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
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/platform-objects@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Minor Changes

- c044f08: **Security fix (Critical): the settings HTTP routes no longer trust spoofable identity headers, and writes are now capability-gated.**

  Previously `GET/PUT/POST /api/settings/*` derived the caller's identity from `x-user-id` / `x-tenant-id` / `x-permissions` request headers (the route default), and `setMany` performed **no permission check** — so on a standard `os serve --server` deployment (settings + HTTP server composed by default, routes registered on the raw app with no auth middleware) an **unauthenticated** remote client could write tenant- or platform-scoped settings (including the auth security-policy, localization, and company manifests) and enumerate every namespace.

  Fixes:

  - **Verified identity.** `SettingsServicePlugin` now derives the caller's identity and capabilities from the platform's verified resolution (`resolveAuthzContext` — session cookie / API key / OAuth), never from request headers. The route default is now SECURE: it trusts no identity header and yields an anonymous, denied context.
  - **Capability gates.** Manifest `readPermission` / `writePermission` are enforced for HTTP callers: reads of a protected namespace, writes, and actions require the declared capability (writes default to at least the read capability, never ungated). Enforced via a new `enforced` flag set only at the HTTP boundary — **in-process/boot callers (`kernel.getService('settings')`, seed) are unchanged** and keep full trusted access.
  - Unauthenticated HTTP callers can no longer enumerate protected manifests or write; a `403 SETTINGS_FORBIDDEN` is returned when the capability is missing.

  **`setup.write` capability now real.** Enforcing the manifests' declared `writePermission` surfaced a modeling gap: `setup.write` (the write counterpart to `setup.access`, used by the branding / company / localization / feature-flag manifests) was referenced but never declared or granted — so under enforcement _nobody_, not even an admin, could write those namespaces. It is now a declared platform capability (`PLATFORM_CAPABILITIES`) held by `admin_full_access` and `organization_admin`, alongside `setup.access`.

  **Behaviour change:** a deployment that relied on the old header-trusted default must present a real verified session/API-key/OAuth credential (which the console already does). A custom integration may still inject its own `contextFromRequest`.

  Found by an adversarial security review of the request→ExecutionContext trust boundary.

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
  - @objectstack/types@14.5.0

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
  - @objectstack/types@14.4.0

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
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/platform-objects@14.1.0
  - @objectstack/types@14.1.0

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
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/platform-objects@13.0.0
  - @objectstack/types@13.0.0

## 12.6.0

### Minor Changes

- c4fd39f: Localization: drop the hard-coded `USD` platform default for the workspace **Default currency** setting.

  Previously the `localization.currency` setting defaulted to `'USD'`, and that value was applied to any `currency`-typed field that omits its own code — so every code-less amount surfaced a `$`/`US$` symbol even when nothing (field, measure, or workspace) actually named a currency. The setting now has **no platform default**: a code-less currency amount renders as a plain number unless the workspace explicitly picks a default currency (or the field declares its own).

  Migration: a workspace that relied on the implicit USD default and wants to keep showing `$` should set **Settings → Localization → Default currency** to `USD` explicitly. Fields/measures that declare their own currency code are unaffected.

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/platform-objects@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/platform-objects@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/platform-objects@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/platform-objects@12.3.0
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
  - @objectstack/core@12.2.0
  - @objectstack/platform-objects@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/platform-objects@12.1.0
  - @objectstack/types@12.1.0

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
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/platform-objects@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/platform-objects@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/types@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/platform-objects@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/platform-objects@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/platform-objects@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/platform-objects@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Minor Changes

- ce0b4f6: Auth: password expiry — the session-validation gate (ADR-0069 D1, P1)

  Builds the **authentication-policy session gate** ADR-0069 needs and uses it for password expiry. When `password_expiry_days` (new `auth` setting, 0 = off) is exceeded, an authenticated user is blocked from protected REST resources with `403 PASSWORD_EXPIRED` until they change their password — while auth + remediation paths stay reachable.

  - **core**: new pure `evaluateAuthGate` / `isAuthGateAllowlisted` helper (`@objectstack/core/security`) — single source of truth for the allow-list (auth endpoints, change-password, health, UI-bootstrap reads).
  - **plugin-auth**: `customSession` computes the gate posture once and attaches `user.authGate`; `computeAuthGate` reads `sys_user.password_changed_at` vs the configured window; `password_changed_at` is stamped on sign-up / change / reset; `isAuthGateActive()` keeps the gate **zero-overhead** when off.
  - **platform-objects**: new `sys_user.password_changed_at` column.
  - **rest**: `resolveExecCtx` carries `authGate`; `enforceAuth` blocks gated sessions (independent of `requireAuth`) using the core allow-list.
  - **service-settings**: new `password_expiry_days` field.

  Default-off / additive (no upgrade behavior change); a null `password_changed_at` never expires (existing users). Per ADR-0049 the setting ships with its enforcement; timestamps written as `Date` (ADR-0074).

  This gate is the shared seam for **enforced MFA** (ADR-0069 D3), which lands next as a small addition (a second `authGate` branch). The dispatcher/MCP path is a follow-up (tracked in #2375); the REST surface the Console uses is fully gated here.

- 90bce88: Auth: enforced MFA (ADR-0069 D3, P1)

  Completes the session-validation gate: when `mfa_required` (new `auth` setting) is on, an authenticated user without TOTP enrolled is blocked from protected resources with `403 MFA_REQUIRED` once their `mfa_grace_period_days` (default 7) window elapses — while the two-factor enrollment endpoints stay reachable so they can comply. Reuses the `authGate` seam shipped in #2388 (a second posture branch in `computeAuthGate`).

  - New `auth` settings `mfa_required` (toggle) + `mfa_grace_period_days`; enabling `mfa_required` also force-enables the `twoFactor` plugin so `/two-factor/*` enrollment exists.
  - New `sys_user.mfa_required_at` column — the grace clock, stamped lazily the first time a user is seen required-but-unenrolled.
  - `isAuthGateActive()` now also trips on `mfa_required` (still zero-overhead when off).

  Default-off / additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement.

  **Needs an objectui follow-up**: the Console should handle a `403 MFA_REQUIRED` by showing the TOTP-enrollment prompt. Per-org `sys_organization.require_mfa` and the dispatcher/MCP gate remain follow-ups (#2375).

- 3209ec6: Auth: session controls — idle timeout, absolute max lifetime, concurrent cap (ADR-0069 D4, P2)

  Adds three `auth` session-control settings (all 0 = off):

  - `session_idle_timeout_minutes` — sign a user out after inactivity. Enforced in `customSession`: touches `sys_session.last_activity_at` (throttled to once a minute) and, once the idle window is exceeded, revokes the session.
  - `session_absolute_max_hours` — cap total session lifetime regardless of refresh; revoked once `created_at` is older than the cap.
  - `max_concurrent_sessions_per_user` — on sign-in, keep the newest N live sessions and revoke the rest (oldest first).

  Revocation expires the session in place (`expires_at` set to the past + `revoked_at` / `revoke_reason` stamped on new `sys_session` columns), so better-auth returns no session on the next request → the Console's existing 401 → login redirect handles it (no client change). Note: better-auth garbage-collects expired sessions, so the `revoke_reason` audit row is best-effort; the enforcement (session killed) is not.

  Default-off / additive (no upgrade behavior change); per ADR-0049 each setting ships with its enforcement.

- 8c84c97: Auth: IP allow-list — network gating on the auth routes (ADR-0069 D5, P2)

  Adds an `allowed_ip_ranges` auth setting (CIDR ranges or exact IPs; empty = no restriction). A Hono middleware registered ahead of the better-auth handler in the auth-route registration rejects auth requests from a client IP outside the ranges with `403 IP_NOT_ALLOWED`, before they reach better-auth.

  - Client IP is read trust-proxy-aware from `x-forwarded-for` (first hop) / `cf-connecting-ip` / `x-real-ip`.
  - The public render helpers (`/config`, `/bootstrap-status`) are exempt so a blocked client still gets a clean login page + a clear error.
  - **Fails OPEN** when the client IP can't be determined (no proxy header), so a misconfigured proxy is a no-op rather than a lockout — an admin enabling this must ensure forwarded headers are trusted.
  - IPv4 CIDR (`a.b.c.d/n`) + exact IPv4/IPv6 matching.

  Default-off / additive; per ADR-0049 the setting ships with its enforcement.

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
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0

## 11.0.0

### Minor Changes

- 21b3208: Auth: password complexity policy (ADR-0069 D1, P1)

  Adds `password_require_complexity` (toggle, default off) + `password_min_classes` (1–4, default 3) to the `auth` password-policy settings. A custom validator runs in the better-auth `before` hook on `/sign-up/email`, `/reset-password`, and `/change-password`, rejecting passwords that use fewer than `password_min_classes` of the four character classes (upper / lower / digit / symbol) with `PASSWORD_POLICY_VIOLATION` — better-auth natively enforces only min/max length.

  Default-off and additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement. No new identity fields. Continues the ADR-0069 P1 password-policy work alongside the HIBP breached-password reject (#2361).

- 9b5bf3d: Auth: password history / no-reuse (ADR-0069 D1, P1)

  Adds `password_history_count` (0–24, 0 = off) to the `auth` password-policy settings. On `/change-password` and `/reset-password`, a new password that matches the current password or any of the last N hashes is rejected with `PASSWORD_REUSE`. A new bounded `sys_account.previous_password_hashes` column (JSON ring, system-managed, hidden) backs the check; it is maintained by before/after hooks (capture the old hash, append on success).

  Reuses better-auth's native `password.verify` (no bespoke crypto) and resolves the reset-flow user via the same token lookup better-auth uses. Default-off / additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement.

- cb5b393: Auth: account lockout + rate-limit tuning (ADR-0069 D2, P1)

  Second slice of ADR-0069 — per-identity brute-force protection, reusing the setting→enforcement pattern from the HIBP PR.

  - **Account lockout** `[custom][field]`: new `sys_user.failed_login_count` / `sys_user.locked_until` columns; `auth` settings `lockout_threshold` (0 = off) + `lockout_duration_minutes`. Enforced in the `/sign-in/email` before/after hooks — failures increment the counter, crossing the threshold stamps `locked_until`, and a locked account is rejected **even with the correct password** (survives IP rotation, unlike rate limiting). A successful sign-in resets both.
  - **Admin Unlock**: new admin-guarded `POST /api/v1/auth/admin/unlock-user` route + an `unlock_user` action on `sys_user`.
  - **Rate-limit tuning** `[native]`: `auth` settings `rate_limit_max` / `rate_limit_window_seconds` wire better-auth's core `rateLimit` with stricter `customRules` for `/sign-in/email`, `/sign-up/email`, `/request-password-reset`, `/reset-password`.

  All settings default off / to safe values; additive (no upgrade behavior change). Per ADR-0049 each setting ships with its enforcement. Timestamps are written as `Date` (never epoch-ms) per ADR-0074.

- ab5718a: Auth: reject breached passwords via Have I Been Pwned (ADR-0069 D1, P1)

  First slice of ADR-0069 (enterprise authentication hardening) and the enforcement-wired pattern template the rest of the ADR follows. Adds a `password_reject_breached` auth setting (default **off**) bound end-to-end to better-auth's native `haveibeenpwned` plugin — a k-anonymity range check on sign-up / change-password / reset-password (the plaintext password never leaves the process).

  - **spec**: new `passwordRejectBreached` flag on `AuthPluginConfigSchema`.
  - **service-settings**: new "Reject breached passwords" toggle in the `auth` manifest's password-policy group (`global` scope, `manage_platform_settings`).
  - **plugin-auth**: `bindAuthSettings` maps the setting into the plugin config; `buildPluginList` gates and mounts the `haveIBeenPwned` plugin (env `OS_AUTH_PASSWORD_REJECT_BREACHED` wins over config, mirroring `OS_AUTH_TWO_FACTOR`).
  - **cli**: surface the knob in the `serve` boot config alongside `twoFactor`.

  Default-off and additive — no behavior change on upgrade. Per ADR-0049 the toggle ships with its enforcement (no false surface). No new identity fields (the `[custom]` D1 items — complexity / expiry / history — land in follow-up PRs).

### Patch Changes

- a619a3a: fix(setup): first-run admin polish — pin Company/Localization, gate dashboard widgets by `requiresService`, i18n + settings PUT envelope

  Dogfooding the Setup app as a brand-new system administrator surfaced a cluster of small first-run gaps, now fixed:

  - **platform-objects**: pin **Localization** and **Company** in the Setup sidebar's Configuration group — both are registered `service-settings` manifests (the two lowest-`order` Workspace settings) but were reachable only via the "All Settings" hub. Translate the previously-English nav labels Cloud Connection (云连接), Datasources (数据源) and Capabilities (能力). Tag the System Overview `widget_organizations` KPI with `requiresService: 'org-scoping'`.
  - **rest**: extend the ADR-0057 D10 server-side visibility gate to **dashboard widgets** — strip widgets whose `requiresService` names an unregistered kernel service (mirrors the existing app-nav gate; `resolveRegisteredServices` now also discovers gates declared on widgets). In a single-tenant runtime this removes the orphan "Organizations" KPI, matching the already-hidden org nav entries.
  - **service-settings**: add the missing zh `help` strings for the Localization manifest (number/currency/first-day-of-week/fiscal-year fields), and accept the `{ values: { … } }` envelope on `PUT /api/settings/:ns` symmetrically with what `GET` returns.

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
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- c121d73: fix(cli): let single-node `os start` auto-mint a crypto key

  `os start` forces `NODE_ENV=production`, which made `LocalCryptoProvider` refuse
  to boot without `OS_SECRET_KEY` — breaking the documented zero-config quickstart
  (`npm i -g @objectstack/cli && os start`) on a clean machine.

  `LocalCryptoProvider` now honours an `OS_CRYPTO_AUTOKEY` opt-in in production: it
  mints AND persists a key to `~/.objectstack/dev-crypto-key`. The ephemeral
  fallback stays forbidden, so a non-writable / ephemeral filesystem still fails
  loud rather than running under a key that won't survive a restart. `os start`
  sets the flag only for single-node deployments (no `OS_CLUSTER_DRIVER`, no
  `OS_SECRET_KEY`); multi-node still fails loud until `OS_SECRET_KEY` is provided.

  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0
  - @objectstack/types@10.3.0
  - @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/platform-objects@10.2.0
  - @objectstack/types@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/platform-objects@10.1.0
  - @objectstack/types@10.1.0

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
  - @objectstack/core@9.11.0
  - @objectstack/platform-objects@9.11.0
  - @objectstack/types@9.11.0

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
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1
- @objectstack/platform-objects@9.9.1

## 9.9.0

### Minor Changes

- 0d4e3f3: feat(auth): password-policy & session settings — live, enforced (P0 security)

  Extends the existing `auth` settings manifest (global scope) with the security policy keys that are **genuinely enforced today**, rather than standing up a new `security` namespace full of non-functional toggles (which would be false surface):

  - **Password policy** — `password_min_length` (default 8), `password_max_length` (default 128). Enforced by better-auth on sign-up and password reset.
  - **Sessions** — `session_expiry_days` (default 7, absolute lifetime), `session_refresh_days` (default 1, refresh threshold).

  These ride the existing `AuthPlugin.bindAuthSettings` → `AuthManager.applyConfigPatch` path (read on `kernel:ready`, re-applied live via `settings.subscribe('auth')`, which invalidates the cached better-auth instance). Days are converted to seconds for better-auth's `session.{expiresIn,updateAge}`; unset (`source: 'default'`) and malformed/non-positive values are ignored so the provider default holds. Ships en + zh-CN translations.

  Deliberately **out of scope** (no enforcement exists, so they're not declared as settings): MFA-required, IP allowlist, SSO/SAML, SCIM, API rate limits, password complexity/rotation/history. These are real features to be built, not settings toggles.

- 8e5a3b5: feat(settings): `company` settings — legal organization identity

  Adds a `company` SettingsManifest for the workspace's **legal entity** identity, distinct from `branding` (public name/logo/theme). Organization-level (`tenant` scope), all keys optional for v1.

  Grouped Identity / Registered address / Contact: `legal_name`, `registration_number`, `tax_id`, `address_line1`/`address_line2`/`city`/`state`/`postal_code`/`country`, `phone`, `website`, `primary_contact_name`, `primary_contact_email`. Benchmarked against Salesforce "Company Information" and Stripe's business profile.

  These feed invoices/receipts, email footers (CAN-SPAM requires a physical postal address), contracts, and compliance exports. Ships with en + zh-CN translations and a manifest test.

- 9afeb2d: feat(settings): `localization` settings — platform default timezone, language & formats (ADR-0053 Phase 2)

  Adds a `localization` SettingsManifest, the missing keystone that makes the Phase 2 reference-timezone actually configurable end-to-end. One declaration gives the full settings stack for free: platform built-in default → `global` → `tenant` cascade, a permission-gated settings page, and i18n.

  **Keys** (organization-level; per-user overrides intentionally out of scope for v1): `timezone` (UTC), `locale` (en-US), `default_country`, `date_format`, `time_format`, `number_format`, `first_day_of_week`, `currency` (USD), `fiscal_year_start`. Benchmarked against Salesforce/Workday "Company Information + Locale".

  **Resolver 收编** — `resolveExecutionContext` now resolves `timezone` **and** `locale` from the `localization` settings via the `settings` service (canonical 4-tier cascade), falling back to a direct tenant-scoped `sys_setting` read, then `UTC` / `en-US`. This replaces the hand-rolled `sys_user_preference` + tenant-only `sys_setting` path from #1978 (which bypassed the settings abstraction and is dropped along with the per-user tier). New `ExecutionContext.locale`.

  **Consumer wiring** — analytics date bucketing now picks up the resolved org timezone: `DatasetExecutor` threads `ExecutionContext.timezone` into the query (precedence: explicit selection tz → request tz → UTC), so #1982's tz-aware buckets fire for a configured org without callers passing a zone. Formula `today()`/`datetime` were already wired (#1979/#1980).

  Email `datetime` rendering (`SendTemplateInput.timezone`, shipped in #1981) is intentionally **not** wired here: the only current `sendTemplate` callers are pre-session auth emails with no org context; business-notification callers can pass the zone when they appear.

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
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/platform-objects@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/types@9.7.0
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
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/platform-objects@9.5.1
  - @objectstack/types@9.5.1

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
  - @objectstack/types@9.5.0

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
  - @objectstack/types@9.4.0

## 9.3.0

### Minor Changes

- d100707: AI provider misconfiguration is now visible, rejected at save time, and recoverable from the UI. Background: a half-saved `ai` settings row (provider=cloudflare, empty key) silently overrode env auto-detection and the only symptom was a bare "Bad Request" in chat.

  - `GET /api/v1/ai/status` — active adapter provenance: `source` (explicit/env/settings/fallback), provider, model, plus `settingsError` explaining why saved settings were NOT applied. `AIServicePlugin` tracks this through boot detection, settings rebuilds, and resets.
  - Save-time validation in `SettingsService.setMany` (fulfilling the spec promise that `required` is enforced server-side): visible+required fields and `pattern` mismatches reject the whole batch with field-level errors (`400 SETTINGS_VALIDATION`). Visibility expressions (`${data.provider === '…'}`) are evaluated server-side by a restricted-grammar parser; unparseable expressions and all-null patches (resets) stay lenient. `gateway_model` / `cloudflare_model` gain `provider/model` patterns.
  - Built-in `reset` settings action for every namespace (`SettingsService.resetNamespace`), overridden for `ai` to also re-run env adapter detection immediately; the AI manifest ships a "Reset to environment defaults" button — no more hand-editing `sys_setting`.
  - Chat/agent/assistant stream errors are enriched with the active adapter description and actionable hints (400 → model-id format, 401/403 → credential, 404 → unknown model, 429 → rate limit) instead of a bare HTTP status.

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
  - @objectstack/types@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/platform-objects@9.2.0
  - @objectstack/types@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/platform-objects@9.1.0
  - @objectstack/types@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/platform-objects@9.0.1
  - @objectstack/types@9.0.1

## 9.0.0

### Major Changes

- f533f42: Settings namespace environment overrides now use the canonical ObjectStack
  `OS_<NAMESPACE>_<KEY>` form, with no unprefixed aliases. For example,
  `ai.openai_base_url` is now `OS_AI_OPENAI_BASE_URL`, and
  `feature_flags.ai_enabled` is now `OS_FEATURE_FLAGS_AI_ENABLED`.

  The AI service now treats a stored or env-locked `provider=memory` setting as
  an explicit override, while the manifest default still leaves boot-time
  provider auto-detection intact.

  The auth plugin now binds the `auth` settings namespace to better-auth runtime
  configuration, exposes an extension hook for provider packages, and includes a
  basic Google sign-in implementation configured either in Setup → Authentication
  or by deployment-level `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/platform-objects@9.0.0
  - @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/types@8.0.1
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
  - @objectstack/types@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/types@7.9.0
- @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/platform-objects@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/types@7.7.0

## 7.6.0

### Minor Changes

- 55866f5: Fail loud instead of silently minting an ephemeral encryption key; ship a persistent env-master-key provider as the default (#1507).

  The default `ICryptoProvider` backs every secret-at-rest in the platform —
  encrypted settings (`sys_setting.value_enc`), ObjectQL `secret` fields, and
  runtime datasource credentials. Its key resolution previously fell back,
  **silently**, to a fresh per-process `randomBytes(32)` key (or auto-minted a
  new on-disk key on every boot) when no stable key was available. In an
  ephemeral-FS container or a multi-node cluster, each restart / each node then
  encrypts under a different key, and every previously-written `sys_secret` value
  becomes undecryptable. The failure was invisible at encrypt and boot time and
  only surfaced later as "all my saved passwords / API keys / DB credentials
  fail to decrypt".

  - **Renamed `InMemoryCryptoProvider` → `LocalCryptoProvider`.** The old name
    implied an ephemeral key when the provider in fact persists one.
    `InMemoryCryptoProvider` stays as a deprecated alias for backward
    compatibility.
  - **Added `OS_SECRET_KEY`** as the canonical production master key (32-byte
    hex or base64), the documented production default. `OS_DEV_CRYPTO_KEY`
    remains the dev convenience key.
  - **Fail-loud in production.** When `NODE_ENV=production` and no stable key
    source (env var or a pre-existing persisted file) is available, the provider
    now throws an actionable error at construction instead of generating a key —
    turning silent data-loss into a config error at boot. It never auto-mints a
    key in production. Development and test keep the ergonomic fallback
    (persisted dev key / ephemeral test key).
  - `serve` surfaces the production-key error verbatim and refuses to wire an
    unstable provider for `secret` fields.

  KMS / Vault providers (managed custody, per-tenant keys, automatic rotation)
  remain future/enterprise plug-ins behind the same `ICryptoProvider` seam;
  "your stored secret is still there after a reboot" stays open-source.

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
  - @objectstack/types@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1
- @objectstack/platform-objects@7.4.1

## 7.4.0

### Patch Changes

- 82eb6cf: Fix system-metadata translations: locale fallback, app/dashboard localization, and coverage gaps.

  Switching the UI language left many surfaces in English. Three root causes
  are addressed:

  - **Locale fallback (server).** The metadata translation resolver
    (`@objectstack/spec` `i18n-resolver`) now resolves a requested locale
    against the locales actually present in the bundle (exact →
    case-insensitive → base-language → variant), so a request for `zh`
    correctly hits the `zh-CN` bundle instead of falling back to English.
    This mirrors `resolveLocale` in `@objectstack/core` and benefits every
    resolver (objects, views, actions, settings, metadata forms).

  - **App & dashboard localization (server).** Added `translateApp` and
    `translateDashboard` resolvers and wired `app`/`dashboard` into the REST
    `/meta` translation path. App labels, sidebar/navigation group labels,
    and dashboard titles/widgets were previously never localized at the API
    boundary even though the translation data existed.

  - **Coverage & quality (data).** Added translations for the previously
    untranslated platform objects `sys_share_link`, `sys_view_definition`,
    and `sys_metadata_audit` (and registered them in the i18n-extract config
    so future extractions keep them). Replaced English placeholder strings
    left in the `zh-CN` / `ja-JP` / `es-ES` object and metadata-form bundles
    (notably action `confirmText` / `successMessage` prompts). Added the
    missing `es-ES` built-in Settings bundle in `@objectstack/service-settings`.

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
  - @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/platform-objects@7.3.0
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

### Minor Changes

- e9bacda: Auto-generate concise titles for AI conversations.

  `AIService` now exposes `summarizeConversation(id)` and fires it
  once per conversation after the first assistant turn lands. The
  generated title (≤ 16 chars by default) is PATCHed onto the
  `ai_conversations` row so the sidebar shows a meaningful label
  instead of "New conversation". Failures are silently swallowed —
  title generation is purely cosmetic and never blocks chat.

  Plumbing:

  - New AI settings (in the `ai` Settings namespace):
    - `title_generation_enabled` (toggle, default on for non-memory providers)
    - `title_max_length` (number, 8–80, default 16)
  - `AIService.setTitleGenerationConfig({ enabled, maxLength })` —
    called by `AIServicePlugin.bindSettings()` whenever the `ai`
    namespace changes, so admins can toggle the feature live from
    Setup without a restart.
  - `AIService` calls `summarizeConversation()` fire-and-forget at
    the natural end of `chatWithTools` and `streamChatWithTools`.
    Idempotent per service instance — a single titling attempt per
    conversation per process.

  Defaults are conservative: memory provider stays untouched
  (no LLM call is made), and any per-test `AIService` that doesn't
  explicitly call `setTitleGenerationConfig({ enabled: true })`
  behaves exactly as before.

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

- 0a40bd1: Make the Settings UI survive crypto key changes and dev restarts.

  Two related fixes to stop a single bad encrypted row (e.g. an AI API key
  encrypted before a server restart) from 500-ing the entire
  `GET /api/settings/:namespace` endpoint with `Unsupported state or
unable to authenticate data`:

  - **`InMemoryCryptoProvider`** now honours the `OBJECTSTACK_DEV_CRYPTO_KEY`
    env var (32 bytes, hex or base64) as a stable AES-256-GCM data key.
    When the env var is unset, the provider still generates an ephemeral
    key but now logs the generated key once as base64 so dev operators
    can paste it into `.env` and survive subsequent `pnpm dev` restarts.
    Production behaviour (KMS-backed providers) is unchanged.

  - **`SettingsService.materialiseRow`** now catches decrypt failures,
    logs a single warning naming the offending `namespace.key`, and
    returns `null` instead of throwing. The field renders as empty and
    remains editable, so operators can re-enter the secret in place
    rather than being locked out of the settings page entirely.

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

### Minor Changes

- 4f9e9d4: Setup App: complete the Configuration settings pages.

  **Setup App navigation**

  The Configuration group now lists every built-in settings namespace
  (previously Storage was missing entirely, and Knowledge had no entry):

  - Branding · Email · **File Storage** · **AI & Embedder** · **Knowledge** · Feature Flags

  Order in the left-nav now matches `builtinSettingsManifests` so the
  "All Settings" index and the left-nav stay aligned.

  **AI manifest — embedder section**

  `ai.manifest.ts` now ships an Embedder section in addition to the
  existing chat-LLM section. Knobs:

  - `embedder_provider` — `none` (default) / `openai` / `azure` /
    `dashscope` (阿里通义) / `zhipu` (智谱) / `siliconflow` (硅基流动) /
    `doubao` (火山引擎) / `minimax` / `ollama` / `custom`. Preset list
    mirrors `@objectstack/embedder-openai`'s `OPENAI_COMPATIBLE_PRESETS`.
  - `embedder_api_key` — encrypted password.
  - `embedder_model` — free text with documented examples per provider.
  - `embedder_base_url` — visible for `custom` / `azure` only.
  - `embedder_dimensions` — optional Matryoshka override.
  - `embedder_batch_size` — `embed()` chunk batch size.
  - Test action wired to `POST /api/settings/ai/test_embedder` — fallback
    validates form completeness; real probe lives in `service-ai` /
    `service-knowledge`.

  **New `knowledge` settings manifest**

  `knowledge.manifest.ts` is the canonical surface for RAG infrastructure:

  - `adapter` — `memory` / `turso` / `ragflow`.
  - Turso group — `turso_url` (libsql://, file:, :memory:) + encrypted
    `turso_auth_token`. Leaving URL blank means "reuse the tenant's
    primary libSQL connection" — the recommended cloud setup.
  - RAGFlow group — base URL + encrypted API key + default dataset id.
  - Indexing defaults — `chunk_target`, `chunk_overlap`, `over_fetch`.
  - Permissions — `enforce_rls` defaults to `true` (security-critical;
    toggling off skips the platform's unique RLS re-check on every hit).
  - Test action wired to `POST /api/settings/knowledge/test`.

  **Translations**

  Full `ai` and `knowledge` translation blocks added to both `en.ts` and
  `zh-CN.ts`. Storage block had translations already.

  **Tests**

  - `ai.manifest.test.ts`: +5 cases covering embedder select, encryption,
    test action wiring, and embedder handler validation across 5 provider
    shapes (none / ollama / OpenAI-compatible cloud / custom / azure).
  - `knowledge.manifest.test.ts`: 20 new cases covering manifest shape,
    adapter selection, secret encryption, default `enforce_rls=true`,
    test handler validation across all 3 adapters and payload merging.

  78/78 tests pass in `@objectstack/service-settings`.

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

### Minor Changes

- 97efe3b: `InMemoryCryptoProvider` now auto-detects WebContainer (StackBlitz) and swaps `node:crypto`'s AES-256-GCM for a pure-JS implementation from `@noble/ciphers/aes.js`.

  **Why:** WebContainer's `node:crypto` ships `createCipheriv`/`createDecipheriv` stubs that throw `TypeError: y.run is not a function` when called with `'aes-256-gcm'`. Any code path that persists an encrypted setting through `sys_secret` would crash on StackBlitz.

  **How it works:**

  - Detection: `process.versions.webcontainer` / `SHELL=jsh` / `STACKBLITZ` env.
  - The ciphertext layout `iv(12) || tag(16) || cipher` is preserved, so handles written on one runtime decrypt cleanly on the other.
  - AAD binding (`namespace|key`) and `digest()` are unchanged.
  - In non-WebContainer runtimes the code path is identical to before.

  If `@noble/ciphers` cannot be loaded for any reason, the provider falls back to `node:crypto` and lets it throw, surfacing the misconfiguration clearly.

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

## 0.1.1

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0
