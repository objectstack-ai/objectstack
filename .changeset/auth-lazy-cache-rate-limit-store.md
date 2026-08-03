---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): 限流计数器改为惰性解析 kernel cache —— 修掉误报的告警，也修掉「共享限流从未生效」的功能洞 (#4772)

`pnpm dev`（showcase）每次冷启都会打一条：

```
WARN [auth] no cache service registered — rate-limit counters use a per-process in-memory
     store; a multi-node deployment needs a shared cache (Redis) to enforce limits globally
```

而 `CacheServicePlugin` 就在 **21ms 后**注册好了，它本来就在已加载插件列表里。这条告警把运维引向「你需要 Redis」，接完 Redis 还是同一条告警 —— 因为缺的不是 Redis。

**这不只是日志误报。** `AuthPlugin.init()` 里那次 `getServiceAsync('cache')`
探测的结论会被**冻结整个进程生命周期**：better-auth 实例是懒创建的，但它读的是 init
时定下的 config。所以标准组合下 auth 这一侧永远拿着「没有 cache」这个结论，限流计数器
**从未**用上共享存储 —— 多节点部署的限额从来没有被全局强制过，每个节点各算各的，轮换
节点即可绕过。ADR-0069 D2 声明的能力与运行时不一致。

**修法：把「取 cache 服务」放回真正用到它的那一刻。** 新增
`createLazyCacheRateLimitStorage()`，实现 better-auth 的 `rateLimit.customStorage`：
计数器被消费时才解析 `cache` 服务（这一刻必然在 `kernel:ready` 之后，因此与插件启动
顺序无关），解析到就一直用它。告警保留，但只在**计数器真的要用共享存储、而此刻确实
一个 cache 服务都没有**时才打一次 —— 那时它才是真信号，「加一个共享缓存」也才是对的
建议。真没有 cache 的部署仍然限流，只是退化成进程内计数（降级，不是关闭）。

**刻意走 `rateLimit.customStorage` 而不是 `secondaryStorage`。** 后者会连带把**会话
的记录之处**搬进缓存：better-auth 的 `createSession` 不再写 `sys_session` 行，
`findSession` 直接从缓存快照作答、根本不查库；而 ADR-0069 D4 的空闲超时 / 绝对时长
上限 / 并发上限**全部靠写那一行来撤销会话**。所以自动把 cache 绑成 `secondaryStorage`
会静默废掉 D4 的三个管控。本次因此不再从 cache 服务自动派生 `secondaryStorage`：
它回归「宿主显式提供才生效」，`cacheSecondaryStorage()` 改为从包根导出，供知情的宿主
自行选用。会话到底该存哪，是一个需要维护者裁定的架构问题，记录在 #4785。

对使用者的影响：

- 配了 cache 插件的部署不再出现那条 warn，改为一条 info（计数器已绑定到 cache 服务）；
- 多节点 + Redis cache 的部署，限流计数**现在真的**是全局的；
- 新增 `AuthManagerOptions.rateLimitStorage`（counters-only，不迁移会话）；宿主自己
  提供的 `secondaryStorage` 行为不变，仍然优先并继续走
  `rateLimit.storage: 'secondary-storage'`。
