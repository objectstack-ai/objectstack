---
"@objectstack/service-sms": minor
"@objectstack/service-settings": minor
"@objectstack/service-messaging": minor
---

feat(sms): 短信全局日发送配额 —— 成本总量闸 (#2814)

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
