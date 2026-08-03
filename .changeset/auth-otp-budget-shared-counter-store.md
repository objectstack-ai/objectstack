---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): 每号码 OTP 发送预算改用惰性解析的共享计数存储 —— 多节点下不再按节点数倍增 (#4790)

#2780 的「每号码 OTP 发送预算」（60s 冷却 + 每小时 5 条）此前**只有宿主显式提供
better-auth `secondaryStorage` 时才跨节点共享**：`AuthManager.getOtpSendGuard()` 唯一的
存储来源就是 `AuthManagerOptions.secondaryStorage`，而标准 `serve` 组合里没有任何一处
提供它（#4788 之后 `AuthPlugin` 也明确不再从 cache 服务派生它）。于是预算落在**每个进程
一份**：N 个节点的部署，一个号码实际能收到的是声明值的 N 倍，而且**没有任何信号**告诉你
它没兑现（ADR-0049 声明 ≠ 强制）。这里的计价单位是**真金白银的短信**。

这是 #4772 那条限流洞的同类，但是独立的一处：#4788 修的是 better-auth 自己的 `rateLimit`
计数器（走 `rateLimit.customStorage`），OTP 预算是 ObjectStack 在 `AuthManager` 里自己实现
的另一套计数，行为未被 #4788 改变。

**修法：复用 #4788 建好的那条路径，而不是再写一份。** `rate-limit-storage.ts` 中把「惰性
解析 → 绑定即宣告 → 解析不到就降级到有界的进程内存储并响亮告警」抽成
`createLazyCounterStore()`（`createLazyCacheRateLimitStorage()` 现在就是它的一层薄封装），
OTP 预算经由新的 `AuthManagerOptions.sharedCounterStore` 接同一条路径：

- **存储在每次发送校验时才解析**，因此 `CacheServicePlugin` 晚于 `AuthPlugin` 注册也照样
  绑定得上（插件启动顺序不再决定任何事）—— 这正是 #4772 冻结结论造成的那个洞；
- 配了 cache 的多节点部署，每号码预算**现在真的是一份**，换节点不会重新获得冷却额度；
- 没有 cache 服务的部署**仍然限额**，只是降级为进程内计数，并在第一次真正计数时打一条
  点名代价的 warn（「an N-node deployment can send up to N× the configured number of PAID
  SMS to one number」）—— 降级不是关闭，两种情况在日志里可区分（绑定打 info，降级打 warn）。

**刻意不引入 `secondaryStorage` 来修它**（#4785）：那会把会话的记录之处搬进缓存，静默废掉
ADR-0069 D4 的三个会话管控。宿主自己提供的 `secondaryStorage` 对这个预算仍然优先且行为不变。

冷却与滚动小时窗的语义**未做任何改动**：计数依旧是按号码的时间戳滚动窗口，只是换了它所在的
存储。（固定窗口计数器无法表达「距上一次发送满 N 秒」，把它改成定窗会在窗口边界放行两倍突发
——用一种倍增换另一种倍增。）

对使用者的影响：

- 新增 `AuthManagerOptions.sharedCounterStore`，`AuthPlugin` 自动填充，一般宿主无需感知；
- 新增导出 `createLazyCounterStore()` 与 `counterStoreFromKv()`；
- `OtpSendGuard` 新增 `resolveStore` 选项，原有的 `storage`（字符串 KV）选项保持可用。
