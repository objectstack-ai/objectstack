---
"@objectstack/rest": minor
"@objectstack/runtime": patch
---

**声明式端点进 OpenAPI 文档;`/openapi.json` 的影子属主摘除(#5040 E6,并入 #5078)**

`GET {basePath}/openapi.json` 只有一个属主,而且实测坐实是 `packages/rest`(#5078:真实 boot 拿到 355KB 的 OpenAPI 3.1 文档,`servers[0]` 按 Host 注入、`{object}` 展开出 199 条 paths、两条 `x-template` —— 三个指纹全部是 rest-server 的行为)。因此 `apis:` 端点的文档面加入 **rest-server 既有的 enrichment 管线**(与 `{object}` 展开同根、同一次请求、同样 best-effort),而**不是**在某个 metadata service 上实现 `generateOpenApi` —— 那会造出 ADR-0076 第 1 条明令禁止的第二属主。E1 的契约成员因此已剔除。

每条声明贡献一个 path 条目:`path` 原样、`method` 小写作为 Operation 键、`operationId` = `name`,以及词表**真正带有**的两个文档字段 `summary` / `description`(缺省即缺省,不生成替身)。除此之外只写「执行器会怎么对待这条声明」的事实,逐条注明出处:`object_operation` 的 `get`/`update`/`delete` 记录 id 取 `query.id`(词表无路径模板语法)、`create` 答 201 其余 200、`script` / `proxy` 与缺 `objectParams` 的 `object_operation` 答 **501**。不编造任何 request/response schema —— 出厂文档的 `components.schemas` 是空的,凭空写 `$ref` 只会得到悬空引用。

`authRequired` 由 schema parse 物化(缺省即 `true`),为 true 的条目引用**从文档自身读出**的 security 方案(不在 rest 里硬写方案名,否则就是第二处需要保持正确的地方),为 false 的条目写显式 `security: []` —— 这是 review 时一眼能看见的那个形状。不满足 `ApiEndpointSchema` 的存量条目**响亮跳过**并点名(与端点匹配器的装载门同一姿态);同 `method+path` 撞车时按「`name` 字典序在前者胜」裁决,与匹配器**同一条规则**,否则文档会指认一个运行时并不执行的端点;撞上内建路径时内建保留,声明被略过并报错。

同时摘除 `http-dispatcher.ts` 里的 `generateOpenApi` 探测死分支:该方法在本仓与两个兄弟仓**零实现**,且 boot 实测**没有任何路由**把 `/openapi.json` 送进 `dispatch()` —— 双重死。`route-ledger.ts` 里对应的行与 `LEGACY_CHAIN_PREFIXES` 条目一并移除(原注记「falls through when metadata service lacks a generator」把「从来没有」写成了「有时没有」,正是 #5078 立单的失准点;把 prefix 留在一张自述为「if-chain 分支」的清单里,会在同一个 PR 里再造一次同样的谎)。该路由的唯一台账行在 `packages/rest/src/rest-route-ledger.ts`,一直是准的。

**现网行为零变更**:publish / validate 对非空 `apis:` 仍然硬拒(E7 前不撤),所以今天枚举出的是空集,enrichment 原样返回同一个文档对象 —— 服务出去的字节与本次改动前逐字节相同,并有测试钉住。
