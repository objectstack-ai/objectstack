---
"@objectstack/runtime": minor
---

声明式端点的策略键接线:`authRequired` / `rateLimit` / `cacheTtl`(#5040 E4)

新增 `packages/runtime/src/endpoint-policy.ts` —— `ApiEndpointSchema` 三个策略键的唯一读取方,并接入端点派发步(匹配命中 → 策略链 → 答复)。三个键全部复用既有原语,零发明:

- `authRequired`:复用 `shouldDenyAnonymous` 与 `ANONYMOUS_DENY_*` 常量,未认证得到与 `/meta`、`/ai`、`/security` 完全相同的 401 包络。默认值由 schema 物化(缺省即 `true`),执行器读不到「未声明」这个中间态;`authRequired: false` 是唯一的开门方式,且在 diff 中可见。
- `rateLimit`:复用 #5006 的 `deriveBucketConfig` / `resolveRateLimitKey` / `SharedTokenBucketLimiter`,桶键为 `apiep:<端点名>:<主体或 IP>` —— 与 server 级预算各自独立计量,互不侵蚀。超限答与 server 级限流器逐字节一致的 429 + `Retry-After`。
- `cacheTtl`:仅响应头语义(不实现服务端缓存,#5091 已裁)。正值 → `Cache-Control: private, max-age=<ttl>`(`private` 是安全规则:任何响应都可能是按主体裁剪过的);`0`/负值 → `no-store`;缺省 → 不发头;非 GET → 不发头并 warn 点名。

链序按 #5040 §3:**先限流、后鉴权**、再算缓存头 —— 凭据爆破本就是匿名流量,先答 401 会让扫号者完全绕开计量。

**结构性不可达、零现网行为变更**:非空 `apis:` 在 publish/validate 仍被硬拒(E7 翻转前),且派发步在未获得策略上下文时的答复与此前逐字节相同。
