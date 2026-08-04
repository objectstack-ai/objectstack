---
"@objectstack/runtime": minor
---

端点链接线:声明式 `apis:` 端点的派发步现在跑完整条链 —— 匹配 → 策略(`authRequired` / `rateLimit` / `cacheTtl`)→ 目标执行(`object_operation` 走 `/data` 同一个 `callData`,`flow` 走 automation 服务)。

兜底器(`dispatcher-plugin`)补齐三根一直缺的线:把完整的 `EndpointPolicyContext`(请求头、`remoteAddress`、与 server 级限流器同一个会话查询、每端点限流注册表、`trustProxy`)喂给派发步;把 `answer.headers` **写到线上**(此前 429 的 `Retry-After` 会被丢掉,客户端拿到一个不知道何时重试的 429);并在匹配前解析本请求的环境 / 身份(与 `dispatch()` 同一个 `HttpDispatcher.resolveRequestScope`),使委派调用带着调用方的 `ExecutionContext` 运行,而不是以 system 身份绕过 RLS。

`cacheTtl` 的 `Cache-Control` 只挂在**成功**答复上,任何错误答复都不带它。多租户 host 若无法把请求解析到某个环境,该步**弃权**(不写任何东西,保留传输层原本的 404),而不是拿默认 kernel 的数据来回答。

现网行为零变更:publish / validate 对非空 `apis:` 仍然硬拒(#5040 E7 前不撤),因此本链结构性不可达。
