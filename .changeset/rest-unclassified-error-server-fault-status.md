---
"@objectstack/rest": patch
---

fix(rest): an unclassified route error answers a sanitised 500, not a 400 (#5489)

**升级须知 — 状态码行为变化。** `@objectstack/rest` 的错误映射 `mapDataError`
在所有分类分支都不匹配时,原先的终局兜底是
`{ status: 400, body: { error: <原始 message> } }`。这一支现在改为一个消毒过的
服务端故障信封:

```
500 {"error":"Internal server error","code":"INTERNAL_ERROR"}
```

**为什么。** 400 的语义是「你请求错了」——SDK、fetch 封装、代理和重试策略都据此
判定「不要重试,调用方得改点什么」。而真正落到这一支的错误恰恰相反:元数据存储
读不到时 `matchEndpoint` 按契约抛错(它抛就是为了让 outage 不伪装成「没有声明
任何 endpoint」,ADR-0110 D3),或者干脆是处理器自身的 `TypeError`。两者调用方都
修不了,且都**应该**重试。实测:`GET /api/v1/meta/api` 对着一个抛
`Error('metadata store unreachable')` 的存储,返回 HTTP 400。

同时,原始 message 是逐字下发的——而这偏偏是全文件里最没有证据表明可以下发的一
条路径:走到这里的前提就是 `looksLikeInternalErrorLeak` 什么都没匹配上,而
#5462 已经记过「关键词启发式沉默不等于安全」。实测到的一例:一个声明了
`status: 502`、message 为 `connect ECONNREFUSED 10.0.0.5:5432 (internal pool)`
的错误,经由数据路由直接调用 `mapDataError` 时,以 400 携带主机与端口下发。
沿用 #5464 的纪律:原文进服务端日志,不进客户端(500 不在
`isExpectedDataStatus` 内,`handleRouteError` 会打印完整错误对象)。

**真正的客户端错误一个都没有改变。** 改动前先做了测绘:给这一支加桩,跑完
`@objectstack/rest` 全套(48 文件 / 719 用例),落到这一支的只有 6 个错误——本单
的存储 outage、两个 502 的 ECONNREFUSED、三个 `TypeError`,没有一个是客户端
错误。历史上唯一骑在这条兜底上的客户端错误家族(driver-sql 无法编译的 filter
拒绝)已由 #4436 在**生产者侧**声明 `status: 400` + `INVALID_FILTER` 迁走。
validation / permission / unknown object / unknown field / not-null 漂移 /
unique 冲突 / 沙箱业务拒绝等全部仍由各自分支给出原本的 4xx。

**`INTERNAL_ERROR` 而非 `DATABASE_ERROR`。** #5462 的 `DATA_STORE_FAULT`
(`500 DATABASE_ERROR`)用在证据**指名**了存储故障的地方(驱动的 missing-relation
措辞、`looksLikeInternalErrorLeak` 命中);而这一支的定义性事实是「没有任何证据」,
把处理器的 `TypeError` 报成 `DATABASE_ERROR` 会把运维指向一个其实健康的数据库。
`INTERNAL_ERROR` 是 `standardErrorCodeForHttpStatus(500)` 的取值
(`@objectstack/spec` 的 `HttpStatusErrorCodeMap`)——目录自己为「500 且无更具体
code」定义的下限,不是第三套措辞;message 复用的也是
`resolveErrorResponse` 声明式 5xx 分支已在用的 `INTERNAL_ERROR_MESSAGE`。

**如果你的客户端把这条兜底当 400 处理过**:它现在是 5xx,可以重试;若你有生产者
依赖「不声明 status 即可把 message 原文送达调用方」,请改为在抛出点声明
`status` 与 `code`(契约优先),那是唯一仍会把措辞交给调用方的路径。
