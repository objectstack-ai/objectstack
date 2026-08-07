# @objectstack/rest

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
  - @objectstack/observability@17.0.0-rc.5
  - @objectstack/platform-objects@17.0.0-rc.5
  - @objectstack/service-package@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Major Changes

- d9cac60: **BREAKING** — `GET /meta/:type/:name` now answers exactly one body shape: the
  `GetMetaItemResponseSchema` envelope `{ type, name, item, … }` that
  `packages/spec` has always declared for it. On the default configuration this
  endpoint used to answer the **bare metadata document** instead (#5563).

  ### What changed, and why it is breaking

  The route had two mutually exclusive branches with different response
  structures. The cached branch — reached whenever `metadata.enableCache` is on,
  which is the **default** (`enableCache: z.boolean().default(true)`) — served
  `getMetaItemCached`'s `result.data`, and that value has the envelope already
  stripped. The uncached branch served `getMetaItem`'s envelope. So the one shape
  the spec declared was the one a default deployment could not obtain, and the
  envelope surfaced only when the cache was off or when the read structurally
  bypassed it (`app`, `doc`, `book`, `?state=draft`, `?preview=draft`,
  `?package=`). Consumers had no correct static type — they sniffed at runtime or
  reached for `as any` (#5545 was blocked on exactly this).

  The dispatcher's `/meta` domain had the same split one layer down: the protocol
  resolver answered the envelope while the ObjectQL-registry and MetadataService
  fallbacks answered bare documents. Both fallbacks now wrap what they found,
  taking `type`/`name` from the request.

  ### Migration

  `GET /api/v1/meta/object/customer`, default configuration:

  ```jsonc
  // before — the bare document
  { "name": "customer", "label": "Customer", "fields": { /* … */ } }

  // after — the declared envelope; the document is verbatim under `item`
  {
    "type": "object",
    "name": "customer",
    "item": { "name": "customer", "label": "Customer", "fields": { /* … */ } }
  }
  ```

  - **Reading the body directly** (`fetch`, `client.meta.getItem`,
    `client.meta.getCached().data`): read the document at `.item`. Nothing inside
    it changed. `type` is the canonical singular metadata type name, so
    `/meta/objects/customer` and `/meta/object/customer` answer the same `type`.
  - **`useObject` / `useFields` (`@objectstack/client-react`)**: `useObject().data`
    is now the envelope — `data.item.label`, `data.item.fields`, where it used to
    be `data.label` / `data.fields`. `useFields()` is unchanged (it already
    returns the flattened field list) and is the shorter path when fields are all
    you need.
  - **`isMetaEnvelope`, exported from `@objectstack/rest`, is REMOVED.** It
    existed only to tell the two shapes apart. There is one shape now, so the
    replacement for `isMetaEnvelope(r) ? r.item : r` is `r.item`.
  - **Not converged, deliberately**: `?layers=true` still answers the layered
    diagnostic projection `{ type, name, code, overlay, overlayScope, effective,
validation }`. Collapsing three layers into one `item` would delete the
    diagnostic. Unaffected unless you pass that flag.

### Minor Changes

- 96d3d4d: The two machine-readable endpoint surfaces announce only the declarations the runtime actually serves

  `GET {basePath}/meta/api` and `GET {basePath}/openapi.json` enumerated declared `api` items
  through the metadata protocol (ObjectQL SchemaRegistry + `sys_metadata`). Whether a declared
  route is SERVED is decided by a different reader — `IMetadataService.matchEndpoint` and the
  endpoint matcher behind it, which sees the metadata manager's registry and its registered
  loaders. A real boot measured the two disagreeing: an `api` row written through
  `PUT /meta/api/{name}` was enumerated by both surfaces — the OpenAPI document publishing it as
  a path with `security: []`, i.e. as needing no credentials — while every request to it answered 404.

  Both surfaces now ask the matcher, per declaration, and announce only what comes back. An
  `/openapi.json` is what SDKs, codegen and AI clients generate from, so an endpoint advertised
  there that does not exist propagates into everything built on top of it.

  **What changes for you:** an `api` declaration that this runtime will not serve disappears from
  both surfaces. That covers a row created by a runtime/Studio metadata write rather than
  published from a stack artifact, and one excluded at load by the ADR-0121 publish gates (for
  example `authRequired: false` with no armed `rateLimit`). If a declaration you expected has
  vanished, it was already answering 404 — the surface has stopped mis-reporting it, and the
  server log now names each omitted declaration, its route, and why. Publish it through a gated
  path (a stack artifact, or `publishPackage` with the package's `manifest.namespace`) to make it
  real. Endpoints declared in a stack artifact are unaffected: they are served, so they are still
  listed and still documented in full.

  Two surfaces deliberately keep their previous behaviour: `GET /meta/api?preview=draft` answers
  "what is pending", which is by construction not the served set, and the single-item
  `GET|PUT|DELETE /meta/api/{name}` routes stay reachable so an unserved declaration can still be
  inspected and removed.

  Hosts that embed `RestServer` directly get a new optional final constructor argument,
  `metadataServiceProvider`, resolving the `metadata` service. `rest-api-plugin` wires it; a host
  that does not pass it keeps the old enumerate-everything behaviour and logs, once, that the
  surfaces can no longer promise they describe only served routes.

- 75f82f3: **`/openapi.json` 的 built-in 路由段改由 rest 按自身路由事实产出(#5588,维护者裁定 C 第一棒)**

  发布出去的 `GET {apiPath}/openapi.json` 里,built-in 路由那一段**一条都不存在**:真实 boot 逐条探测,7 条 path / 10 个 operation **0/10 命中**。段落由 `packages/spec/scripts/build-openapi.ts` 按字面量 `basePath = '/api'` 手写,于是路径全部缺 `/v1`(CRUD 还缺 `/data`);`PUT {object}/{id}` 写错动词,服务器对 `PUT` 明确回 405;`/api/meta/types` 全仓无此路由;`/api/.well-known/objectstack` 是 runtime dispatcher 的路由、服务在**根路径**上而非 API base 下。照这份文档生成客户端,每一个数据调用都 404。

  这个座位上也不可能写对:`apiPath` 是部署级配置(`api.apiPath ?? api.basePath + '/' + api.version`),随包发布的静态 JSON 无法为所有部署拼对前缀。

  **改法**:built-in 段的属主是**挂载这些路由的包**(ADR-0076 一路由一属主;本文档的属主由 #5078 的真实 boot 坐实为 `packages/rest`)。serve 期流水线现在从 `routeManager.getAll()`——路由器自己用来匹配请求的那张表,请求时读取——产出该段,并**丢弃**静态产物里带来的 `paths` 而不是与之合并(合并等于把错误的段再发布一次;spec 侧的生成要到第二棒 #5744 才摘除)。同一张表既决定「谁被服务」又决定「谁被描述」,幽灵行因此在结构上不可能存在:四条 bulk 路由只在 protocol 实现了 `batchData` / `createManyData` 时注册,于是也只在那时被描述。

  - 路径前缀跟随实际配置的 `apiPath`,project-scoped 镜像有自己的文档(不再把每条路径写两遍);
  - 动词是注册时的动词(`PATCH` 就是 `PATCH`);
  - 覆盖面:该 base 下经本服务器 `RouteManager` 挂载的**全部**路由(默认 boot 78 条,对比旧段的 10 个 operation),`rest-route-ledger.ts` 中 `source: 'route-manager'` 的各 family 全含,不按 `disposition` 裁剪——`server-only` / `public` 也是被服务的 HTTP 面。**不含**两个 `direct-mount` registrar(`package-routes.ts` / `external-datasource-routes.ts`,9 行):它们绕过 `RouteManager` 直接注册且受服务开关约束,本服务器**不持有**它们本次 boot 是否挂载的事实,而凭空补上正是本单要修的那类缺陷;也不含其它包挂载的路由(dispatcher 根路由、`service-storage`、`service-i18n`);
  - 不编造:请求/响应 schema、状态码、query 参数一律不生成(旧段的 `CreateRequest` / `UpdateRequest` `$ref` 除了挂在 404 的路径上,连线上形状都是错的——`{ data }` 信封 vs 裸记录体,spec 自己的路由目录 `plugin-rest-api.zod.ts` 里已记录这一点)。每个 operation 只写从注册读出的 `summary` / `tags`、从路径机械推导的 `operationId` 与 path 参数,响应写 `default`(成功状态是逐 handler 的事实,写 `200` 对 201/204 的路由就是错的);
  - 逐 operation 的 `security` 只在注册带 `public` 标签时写 `[]`(匿名表单),其余继承文档级要求——对 `/discovery`、`/openapi.json` 这类实际匿名的路由属于**故意少说**:注册没有携带鉴权事实,而「不需要凭据」是写错会漏数据的那个方向。

  `{object}` 展开与声明式端点合并两步原样保留,只是展开的模板终于是真实存在的路由(`/api/v1/data/{object}` 及其同族)。`components.schemas` / `info` / `securitySchemes` 仍来自 `@objectstack/spec` 并原样保留——那是它真正拥有的部分。

- 1203bb2: **声明式端点进 OpenAPI 文档;`/openapi.json` 的影子属主摘除(#5040 E6,并入 #5078)**

  `GET {basePath}/openapi.json` 只有一个属主,而且实测坐实是 `packages/rest`(#5078:真实 boot 拿到 355KB 的 OpenAPI 3.1 文档,`servers[0]` 按 Host 注入、`{object}` 展开出 199 条 paths、两条 `x-template` —— 三个指纹全部是 rest-server 的行为)。因此 `apis:` 端点的文档面加入 **rest-server 既有的 enrichment 管线**(与 `{object}` 展开同根、同一次请求、同样 best-effort),而**不是**在某个 metadata service 上实现 `generateOpenApi` —— 那会造出 ADR-0076 第 1 条明令禁止的第二属主。E1 的契约成员因此已剔除。

  每条声明贡献一个 path 条目:`path` 原样、`method` 小写作为 Operation 键、`operationId` = `name`,以及词表**真正带有**的两个文档字段 `summary` / `description`(缺省即缺省,不生成替身)。除此之外只写「执行器会怎么对待这条声明」的事实,逐条注明出处:`object_operation` 的 `get`/`update`/`delete` 记录 id 取 `query.id`(词表无路径模板语法)、`create` 答 201 其余 200、`script` / `proxy` 与缺 `objectParams` 的 `object_operation` 答 **501**。不编造任何 request/response schema —— 出厂文档的 `components.schemas` 是空的,凭空写 `$ref` 只会得到悬空引用。

  `authRequired` 由 schema parse 物化(缺省即 `true`),为 true 的条目引用**从文档自身读出**的 security 方案(不在 rest 里硬写方案名,否则就是第二处需要保持正确的地方),为 false 的条目写显式 `security: []` —— 这是 review 时一眼能看见的那个形状。不满足 `ApiEndpointSchema` 的存量条目**响亮跳过**并点名(与端点匹配器的装载门同一姿态);同 `method+path` 撞车时按「`name` 字典序在前者胜」裁决,与匹配器**同一条规则**,否则文档会指认一个运行时并不执行的端点;撞上内建路径时内建保留,声明被略过并报错。

  同时摘除 `http-dispatcher.ts` 里的 `generateOpenApi` 探测死分支:该方法在本仓与两个兄弟仓**零实现**,且 boot 实测**没有任何路由**把 `/openapi.json` 送进 `dispatch()` —— 双重死。`route-ledger.ts` 里对应的行与 `LEGACY_CHAIN_PREFIXES` 条目一并移除(原注记「falls through when metadata service lacks a generator」把「从来没有」写成了「有时没有」,正是 #5078 立单的失准点;把 prefix 留在一张自述为「if-chain 分支」的清单里,会在同一个 PR 里再造一次同样的谎)。该路由的唯一台账行在 `packages/rest/src/rest-route-ledger.ts`,一直是准的。

  **现网行为零变更**:publish / validate 对非空 `apis:` 仍然硬拒(E7 前不撤),所以今天枚举出的是空集,enrichment 原样返回同一个文档对象 —— 服务出去的字节与本次改动前逐字节相同,并有测试钉住。

### Patch Changes

- 978fed2: fix(analytics,rest): five dataset refusals declare `DATASET_INVALID` / 400 themselves, and the route's message-sniffing list shrinks to one entry (#5367)

  `POST /analytics/dataset/query` answered `400 DATASET_INVALID` for six error
  families because the route recognised their **prose**, not because the errors
  said anything about themselves. #5352 gave the catch an ADR-0112 envelope branch
  (`error.code` + a 4xx `error.status`, read first) and had to leave a hardcoded
  list of message substrings behind it, since all six producers were still bare
  `throw new Error(…)`:

  ```
  /not declared in the dataset|not backed by a declared relationship|
   not supported by the v1 dataset runtime|read-scope-sql|
   not a selected dimension or measure|is not a subset of the selected dimensions/
  ```

  That made the HTTP status of six families a property of their wording.
  Rephrasing `dataset-compiler`'s "is not declared in the dataset's `include`" —
  no logic change — moved that refusal from 400 to 500, i.e. re-opened #5352 for a
  different family, and no test and no gate would have gone red. Prime Directive
  #12 permits an accommodation like that only while it is declared, loud, tested
  **and removable on a schedule**; #5366 delivered the first three and nothing
  carried the fourth.

  **Five producers now declare their own verdict.** A new
  `dataset-refusal.ts` in `@objectstack/service-analytics` exports
  `datasetInvalidError` — the same shape as that package's existing
  `invalidFilterError` (`INVALID_FILTER` / 400) and `assertDimensionFields`
  (`INVALID_FIELD` / 400) — and five sites throw through it:

  - `dataset-compiler.ts` — a measure whose aggregate the v1 runtime cannot lower;
    a dimension/measure traversing a relationship path the dataset never declared
    in `include`;
  - `dataset-executor.ts` — an `order` key that is not a selected dimension or
    measure; a `totals` grouping that is not a subset of the selected dimensions;
  - `native-sql-strategy.ts` — a join outside the dataset's declared allowlist.

  Their five entries are gone from the route's list, which is now a single
  `read-scope-sql` test.

  **`read-scope-sql` deliberately stays.** Its ten fail-closed refusals are RLS
  read-scope lowering failures whose inputs are an admin-authored policy and a
  compiler-generated join alias — not caller input — so `DATASET_INVALID` ("your
  request is invalid") may well be the wrong verdict and choosing the right one is
  a separate judgement, still tracked by #5367. Deleting the entry before that
  judgement lands would regress those ten from `400 DATASET_INVALID` to 500.

  **No outward behaviour change for the five.** They answered
  `400 DATASET_INVALID` before and answer `400 DATASET_INVALID` now, with the same
  message; what changed is the mechanism, from message-matching to the producer's
  own declaration. The one visible difference is for a bare `Error` that merely
  _resembles_ one of those messages: it is no longer promoted to a 400. That is the
  point — a phrase is no longer a classification.

  `DATASET_INVALID` is registered in `ERROR_CODE_LEDGER` under
  `@objectstack/service-analytics` as well as `@objectstack/rest` (provenance, per
  ADR-0112 D3; the code itself is unchanged and the union does not grow), and the
  constructor types it as `RegisteredErrorCode` so an unregistered code is a
  compile error rather than a body some route rejects at runtime.

  Coverage: `dataset-refusal-envelope.test.ts` (service-analytics) pins each of the
  five refusals against its real producer — the refusal SET first, green before and
  after, then the envelope; `analytics-dataset-refusal-envelope.test.ts` (rest)
  drives all five end-to-end through a real `AnalyticsService` with positive
  controls on both the aggregate and raw-SQL paths; and
  `analytics-filter-refusal-envelope.test.ts` pins the deletion in both directions
  — the five messages answer 400 when enveloped and 500 when bare, so re-adding a
  regex entry turns it red.

- c36abfe: fix(service-analytics,rest): an analytics dimension over a missing field answers 400 INVALID_FIELD, not a driver 500 (#5520)

  #4437 gave a **measure** over a non-existent field a `400 INVALID_FIELD` naming
  the field, because a driver error class must never be the caller's `error.code`
  for a caller-shaped mistake (ADR-0112). It covered the measure half only, so the
  identical typo one request key over still reached the driver as a `GROUP BY`
  column:

  ```
  POST /analytics/query {"cube":"account_metrics","measures":["account_count"],"dimensions":["bogus_dim"]}
  → 500 {"code":"SQLITE_ERROR","message":"Internal server error"}

  # the control group on the same route, already fixed by #4437
  POST /analytics/query {"cube":"account_metrics","measures":["bogus_measure"]}
  → 400 {"code":"INVALID_FIELD","message":"Measure 'bogus_measure' … Valid measures: …"}
  ```

  **The gate.** `ensureCube` now runs `assertDimensionFields` alongside
  `assertMeasureFields` on every path, so a dimension whose source column the
  backing object does not have is refused **before** any SQL is built, with the
  same envelope the measure gate uses: `INVALID_FIELD` / 400 plus
  `field` / `object` / `param`, a message naming the field, the valid dimensions,
  and the object's known field list. `query`, `generateSql` and `queryDataset` are
  all covered, and a rejected query leaves nothing behind in the cube registry.
  `timeDimensions` are covered too — they resolve through the same
  `cube.dimensions` bag and produced the same 500 — with `param` reporting which
  request key carried the bad name.

  **What deliberately did not change:** grouping by a REAL field the cube never
  declared as a dimension (`dimensions: ["phone"]`) still works. The gate asks
  "does the _object_ have this field", never "did the cube declare this
  dimension". A cube whose `sql` is an expression, a dotted relation dimension,
  and a host that wires no field-name probe are all stood down on, exactly as the
  measure gate stands down.

  **The SQL echo, same request.** `POST /analytics/dataset/query` composed its own
  5xx body and echoed the error message verbatim. Knex prefixes the offending
  statement to its message, so the caller received the generated SQL — physical
  table and column names included:

  ```
  500 {"code":"ANALYTICS_QUERY_FAILED",
       "error":"SELECT bogus_dim AS \"bogus_dim\", COUNT(*) AS \"account_count\"
                 FROM \"crm_account\" GROUP BY bogus_dim - no such column: bogus_dim"}
  ```

  The sibling face never leaked it: `/analytics/query` exits through the
  dispatcher, which has applied the shared `looksLikeInternalErrorLeak` predicate
  to every >= 500 message since #3867. That same predicate now guards this route's
  500 body. Classification is untouched — the status stays 500, the code stays
  `ANALYTICS_QUERY_FAILED`, the ADR-0112 envelope branch and the transitional
  message list are unchanged — and the full text still reaches server logs. A 500
  whose message does not look like driver output keeps its prose.

- 2f6516e: fix(analytics,rest): an analytics filter refusal reaches the caller as `400 INVALID_FILTER`, not `500 ANALYTICS_QUERY_FAILED` (#5352)

  Misspell an operator in a dashboard widget's filter and analytics refuses it —
  correctly, and loudly, which is the posture #3948 / #5240 / #5325 / #5334 each
  argued for one refusal at a time: dropping a predicate the compiler cannot
  express does not narrow the query, it **widens** it to rows the author excluded,
  and a chart drawn over the whole dataset looks like a working chart.

  The refusal never reached the author. It landed as `500 ANALYTICS_QUERY_FAILED`
  — read as "the platform is broken" rather than "your filter has a typo", and
  counted by ops alerting as a 5xx. The identical mistake on `find()` has answered
  `400 INVALID_FILTER` since #3948, so one authoring error had two wire shapes,
  chosen by which face happened to catch it.

  **One defect, two halves — either alone leaves it unfixed.**

  - **Producer** (`filter-normalizer.ts`): seven of its nine refusals were bare
    `throw new Error(…)` carrying no `code`/`status`. All nine now go through the
    `invalidFilterError` helper #5334 introduced (`INVALID_FILTER` / 400), which
    becomes the module's only way to refuse.
  - **Consumer** (`rest-server.ts`, `POST /analytics/dataset/query`): the catch
    discarded `error.code` / `error.status` and re-derived the classification from
    a hardcoded list of message substrings — so a producer that took ADR-0112
    seriously was punished for it. It now reads the envelope **first**; the
    substring list is demoted to a fallback for the families that still carry no
    envelope.

  **Observable behaviour change — read this if you alert or retry on status.**
  The same request that returned `500 ANALYTICS_QUERY_FAILED` now returns
  `400 INVALID_FILTER` (and, for two neighbouring conditions whose producers
  already declared an envelope this route was discarding, `400 INVALID_FIELD` for
  a measure over a field the object does not have, `404 CUBE_NOT_FOUND` for an
  unregistered cube). Monitoring that counted these as server faults will see the
  5xx rate drop and a 4xx rate appear; a client that retries on 5xx will stop
  retrying a request that could only ever fail the same way. Both are the intended
  correction — the condition was always the caller's mistake — but they are
  visible, so they are stated rather than buried.

  **Which inputs are refused did not change.** This changes the SHAPE of the
  error and nothing about the judgement that produced it: no refusal condition
  was touched, no input that used to compile now refuses, and no input that used
  to refuse now compiles. That claim is pinned input-by-input (refusals _and_
  accepted inputs with their compiled trees) in
  `filter-refusal-envelope.test.ts`, which is green both before and after the
  change — only the envelope assertions move.

  The message-substring list survives on purpose. All six of its entries were
  re-verified as bare `Error`s (`dataset-compiler.ts`, `native-sql-strategy.ts`,
  `dataset-executor.ts`, `read-scope-sql.ts`), so deleting it would regress those
  families from `400 DATASET_INVALID` to 500. It is a placeholder for their
  enveloping, not a second classification mechanism, and it is now documented as
  such: a new refusal should carry a `code`/`status` and be served by the
  envelope branch for free. The passthrough is deliberately **4xx-only** and
  requires **both** `code` and `status`, so an internal fault can never be
  re-labelled as the caller's fault, and this route never invents a code a
  producer failed to supply.

- 64cd010: fix(runtime,types)!: `/analytics/query` no longer echoes RLS policy field names — the declared-server-fault withhold is shared by both HTTP boundaries (#5811)

  **Observable behaviour change — read this if you read, log, or assert on
  `error.message` from a dispatcher-plugin route.** An error that **declares a
  server fault** in the ADR-0112 envelope (`status >= 500` _and_ a non-empty
  `code`) now leaves `dispatcher-plugin.errorResponseBase` with its message
  replaced by `"Internal server error"`. It previously reached the caller verbatim
  unless it happened to _sound_ like a SQL/driver dump. This applies to every route
  that plugin mounts — `/analytics`, `/packages`, `/i18n`, `/automation`, `/auth`,
  `/notifications`, `/mcp`, … — not only the one that motivated it. Nothing a
  machine reads changed: the producer's `code` still arrives in the response
  (`error.code`, promoted there from `details` by the shared envelope builder,
  #3842), the status is untouched, and the full original text still goes to the
  server log and `errorReporter` via `__obsRecordedError`.

  ## What was wrong

  #5367 (maintainer ruling 2026-08-06) made `read-scope-sql.ts`'s ten fail-closed
  RLS lowering refusals `READ_SCOPE_COMPILE_FAILED` / 500 and taught
  `POST /analytics/dataset/query` to withhold their message, because those messages
  name the field names and comparands of an **administrator's** sharing rule:

  ```
  [read-scope-sql] unsafe field identifier "secret_policy_field" — refusing to
  build read scope (fail-closed).
  ```

  The caller never wrote that field name and must not be able to read it out of an
  error body. But the **sibling** analytics face was never closed.
  `compileScopedFilterToSql` runs on both `NativeSQLStrategy.applyReadScope` and
  `ObjectQLStrategy`'s echoed SQL, both of which serve `POST /analytics/query`,
  which exits through `dispatcher-plugin.errorResponseBase`. That exit's only
  message guard was `looksLikeInternalErrorLeak` — a heuristic over SQL/driver
  _phrasing_ — and all eleven read-scope message shapes return `false` from it.
  Measured at that boundary: **11 of 11 echoed verbatim**, at 500, with the policy
  content in `error.message`. A real reachable disclosure, not a theoretical one.

  ## What changed

  - **`@objectstack/types` gains `declaresServerFault(err)`**, exported from
    `error-leak.ts` beside `looksLikeInternalErrorLeak`. The heuristic asks whether
    a message _sounds_ internal; the declaration asks whether the producer _said
    so_. `error-leak.ts`'s own file header already states the principle — "do not
    ship driver internals to clients" is a property of the HTTP boundary, not of
    one router — and this is the second predicate that principle asks for.
  - **Both boundaries read it.** `dispatcher-plugin.errorResponseBase` gains the
    withhold (the fix); `rest-server.ts`'s `/analytics/dataset/query` catch drops
    its in-line copy of the same test in favour of the shared one. #5808 wrote that
    rule in-line on purpose — promoting a rule with one consumer is a speculative
    surface — and this is the second consumer, so it was promoted rather than
    duplicated (`#3843`/`#3867` paid for the two-implementations shape twice).
    The REST face's verdict is unchanged in every case: same `status >= 500` plus
    non-empty `code` test, over the same two fields.

  ## What deliberately did NOT change

  - ⛔ **This is not "withhold every 5xx".** #5667 kept **undeclared** 5xx errors
    legible on purpose: a bare `Error` from our own code ("no strategy can handle
    query …") is the operator's own bug report, names nothing tenant-sensitive, and
    still falls to `looksLikeInternalErrorLeak` alone. A 5xx carrying only half an
    envelope (a status with no code) is likewise still readable — inventing the
    withhold for it would be the consumer-side leniency Prime Directive #12 removes.
  - **4xx is untouched.** `declaresServerFault` requires `status >= 500`, so a
    deliberate business/validation answer can never be swallowed by it.
  - **`statusCode` is not accepted as a substitute for `status`.** `status` is the
    channel ADR-0112 declares; making a disclosure rule depend on which spelling a
    producer reached for would be the same leniency in a different place.
  - **The heuristic was not taught to recognise `[read-scope-sql]`.** That would be
    more prose sniffing — the mechanism #5352/#5367 exist to remove — and would only
    ever cover the family someone remembered to add.

  Coverage: `analytics-query-read-scope-withhold.test.ts` (runtime) drives six RLS
  policy shapes end-to-end through a **real** `AnalyticsService` on the real
  native-SQL path and the real mounted route, asserting the 500, that the whole
  serialized body contains no policy detail, that `error.code` still carries
  `READ_SCOPE_COMPILE_FAILED`, and that the full text is still on the
  `__obsRecordedError` side-channel — plus a positive control and both sides of the
  declared-vs-undeclared tiering. `error-leak.test.ts` (types) pins the predicate
  directly, including that all eleven read-scope shapes stay invisible to the
  heuristic. The REST face's existing `analytics-read-scope-refusal-envelope.test.ts`
  is green before and after, unchanged, which is the pin on the refactor.

- fb3d99b: fix(analytics,rest)!: an RLS read-scope lowering failure is a `500`, not the caller's `400` — and its policy detail no longer reaches the response (#5367)

  **Observable behaviour change — read this if you alert, retry, or assert on status.**
  A request whose dataset carries an RLS read scope that `read-scope-sql.ts` cannot
  lower used to answer `400 DATASET_INVALID` with the refusal message echoed
  verbatim. It now answers `500 ANALYTICS_QUERY_FAILED` with the message withheld
  (`"Internal server error"`); the full text goes to the server log. Monitoring that
  counted these as client errors will see a 4xx disappear and a 5xx appear, and a
  client retrying on 5xx will now retry a request that cannot succeed until an
  administrator fixes the policy. Both follow from the correction below and are
  stated rather than buried.

  ## What was wrong

  These ten fail-closed refusals were the last family `/analytics/dataset/query`
  classified by **prose** — the final entry of the hardcoded message-substring list
  #5352 introduced, which #5367's first PR had already shrunk from six entries to
  one. Two defects in one verdict:

  - **Misattribution.** `compileScopedFilterToSql(filter, alias)` receives an RLS
    `FilterCondition` the security service compiled from an **administrator's**
    sharing rule / permission set, and a join alias the **dataset compiler**
    generated. Neither is caller input — the caller's own predicate goes through
    `filter-normalizer.ts` and has answered `INVALID_FILTER` / 400 since #5352. So
    what can arrive here is a broken policy, or drift between two of our own
    components (#5557's `$regex` was literally the second case). For this request's
    caller both are a **server** fault; `400` told them to fix a request that was
    never wrong and kept the real fault out of 5xx alerting.
  - **Disclosure.** A 400 echoed the message, so
    `unsafe field identifier "secret_policy_field"` and
    `unsupported operator "$regex" on "owner_email"` handed a tenant the field names
    and comparands of the RLS policy governing them.

  The maintainer ruled on 2026-08-06 (option B on #5367's decision card; option A
  was `READ_SCOPE_INVALID` / 422, rejected because no consumer reads a code on this
  path, a 4xx misreports a condition the client cannot fix, and 422 would have left
  the disclosure question to be re-decided message by message).

  ## What changed

  - `read-scope-sql.ts` gains a module-local `readScopeCompileError` — the twin of
    `filter-normalizer.ts`'s `invalidFilterError`, and likewise **the only way the
    module refuses**. All ten sites carry `READ_SCOPE_COMPILE_FAILED` / **500**.
    `:104`'s alias-vs-field split (option C on the card) collapses under B: both
    branches answer the same verdict, pinned so the collapse is a recorded decision.
  - `rest-server.ts` loses branch ② entirely. **The message-sniffing mechanism is
    fully retired** — nothing in this catch reads prose any more, and #5367's
    Prime-Directive-#12 retirement schedule ("declared, loud, tested AND removable
    on a schedule") is paid off.
  - The route's 5xx branch now withholds the message of any producer that
    **declares** a server fault (`status >= 500` with a `code`). This was needed
    rather than inherited: `looksLikeInternalErrorLeak` (#3867/#5520) is a heuristic
    over SQL/driver _phrasing_, and measured, every read-scope message returns
    `false` from it — so retiring the list alone would have moved the policy content
    from a 400 body into a 500 body instead of out of the response. Teaching that
    heuristic to recognise `[read-scope-sql]` would have been _more_ message
    sniffing, so the rule keys on the ADR-0112 envelope instead. **Undeclared** 5xx
    errors keep #5667's tiering, so a self-authored fault ("no strategy can handle
    query …") stays readable.
  - `READ_SCOPE_COMPILE_FAILED` is registered in `ERROR_CODE_LEDGER` under
    `@objectstack/service-analytics` (ADR-0112 D3) and typed as
    `RegisteredErrorCode` at the constructor, so an unregistered code is a compile
    error. It is legible on the wire through the sibling `/analytics/query` exit,
    which puts a thrown `err.code` in `error.details.code` (#3842).

  **Which inputs are refused did not change.** No refusal condition moved: nothing
  that used to lower now throws, and nothing that used to throw now lowers. That is
  pinned input-by-input — refusals _and_ accepted read scopes with their compiled
  SQL and bind params — in `read-scope-refusal-envelope.test.ts`, which is green both
  before and after; only the envelope assertions move.

  Coverage: `read-scope-refusal-envelope.test.ts` (service-analytics) drives all ten
  sites through the real compiler; `analytics-read-scope-refusal-envelope.test.ts`
  (rest) drives five policy shapes end-to-end through a real `AnalyticsService`,
  asserting the 500, that the body contains no policy detail, and that the withheld
  text is present in the log — plus a positive control and both sides of the
  declared-vs-undeclared withhold.

- c001422: feat(spec): declare `routes.mcp` on `ApiRoutesSchema`, and extend the discovery conformance gate one level down (#5679)

  `/discovery` advertises `routes.mcp`, `objectui` reads it, and
  `ApiRoutesSchema` never declared it. This is #4828's defect one level down —
  with the opposite disposition: `endpoints` was retired because a census found
  no reader, while `mcp` has two real ones (`ConnectAgentWidget.tsx` and
  `AgentConnectSection.tsx` both gate the Integrations connect card on it), and
  it is in fact the only `routes.*` key anything in `objectui` reads. So it is
  declared, not removed.

  Why it was a defect and not tidiness: `ApiRoutesSchema` is a plain `z.object`,
  which **strips** unknown keys. Any consumer parsing `/discovery` through the
  spec dropped `routes.mcp` silently — the connect card would blank with no
  error. Nothing broke yet only because those two readers happen to read raw
  JSON.

  - **`ApiRoutesSchema` declares `mcp: z.string().optional()`**, as measured off
    both producers rather than guessed: a path string (`/api/v1/mcp`), always the
    **unscoped** base — `/mcp` is mounted bare, so a scoped mount advertising
    `/api/v1/environments/env_alpha/data` still advertises `/api/v1/mcp` — and
    `optional`, not `nullable`: the key is absent (rest-server `delete`s it, the
    dispatcher leaves it `undefined`) when MCP is disabled or unserveable.
    Neither producer ever emits `null`.
  - **`@objectstack/rest` drops the two `as any` casts** at the emit site. That is
    type-only — the emitted body is byte-identical — but the cast's disappearance
    is the structural proof: with the key undeclared, removing it produced two
    `TS2339 Property 'mcp' does not exist`; with it declared, `tsc --noEmit`
    returns to its ratcheted baseline.
  - **The #4828 conformance gates now cover `routes` keys**, not just top-level
    ones, in all three producer packages, deriving the allowance from
    `ApiRoutesSchema` the same way the top-level check derives it from the
    protocol schema. Extended one level, not recursed — full recursion stays out
    of scope, and `capabilities` / `services` are `z.record`s whose keys are open
    by design.

  - **`@objectstack/client`'s conventional route table gains an `mcp` row.** That
    table is `Record<keyof ApiRoutes, string>` — total by design — so a newly
    declared route owes a convention, and the public `ApiRouteType` (`keyof
ApiRoutes`) widens by one member. The path is `/api/v1/mcp`, which is what
    both producers emit, so the fallback agrees with the discovered value instead
    of competing with it. Resolution behaviour is unchanged: `getRoute()` still
    prefers the discovered route, and the pre-existing catch-all already produced
    the same string.

  Corrects one detail of the issue's premise: the runtime dispatcher's
  `getDiscoveryInfo()` **does** also emit `routes.mcp` (its routes literal always
  carries the key, holding the path or `undefined`), so both producers were
  affected, not just REST — and the new gate went red on both before the fix.

- aeb9b27: **发布出去的 OpenAPI 文档 `components.schemas` 不再是空的,6 个 `$ref` 不再悬空(#5168)**

  `GET /api/v1/openapi.json` 的 base spec 由 `packages/spec/scripts/build-openapi.ts` 生成,它把九个契约 schema(`CreateRequest` / `ApiError` / `ListRecordResponse` / …)转成 JSON Schema 填进 `components.schemas`。收集判据写的是 `typeof schema === 'object' && '_zod' in schema`,而这九个 schema 全部经 `lazySchema()` 包装 —— 其 Proxy target 是 `function lazyZod() {}`,于是 `typeof` 是 `'function'` 而不是 `'object'`,判据第一段就短路,九个一个都没进去。`paths` 里那 6 个 `$ref` 是手写字面量,不受影响照常写出,结果是**一份 `components.schemas` 为 `{}`、6 个 `$ref` 全部悬空的文档被发布出去**,覆盖 `/api/{object}` 与 `/api/{object}/{id}` 上全部 CRUD 操作的请求体与响应体。

  判据放宽为同时接受 `'object'` 与 `'function'`。`'_zod' in schema` 那一段对 Proxy 本来就是有效的 —— `lazySchema` 专门维护了 `_zod` facade 供 `toJSONSchema` 遍历 —— 所以 `lazySchema` 本身不需要改动。对照实验坐实了唯一变量就是 Proxy:同一份源码下 `npx tsx scripts/build-openapi.ts` 得到 `Components: 0`,而 `OS_EAGER_SCHEMAS=1`(`lazySchema` 自带的绕过 Proxy 应急开关)得到 `Components: 9`。修复后不带任何环境变量即为 `Components: 9`。

  两类消费者直接受益:`GET /api/v1/docs` 的 Scalar viewer 现在有 schema 可渲染;从该文档做客户端代码生成的集成方(openapi-generator / orval / …)不再在解析期撞上 unresolvable reference。

  **同时补上防复发的门禁。** 这个缺陷三个层次同时可见(空 components、悬空 ref、控制台明晃晃的 `Components: 0`)却没有任何一处红 —— `gen:openapi` 是全仓两个完全无门禁的生成器之一。生成器现在在**写盘之前**自检两条,任一不满足即以非零码退出,自恰不了的文档根本不会被写出来:

  1. **每个本地 `$ref` 都必须解析得到。** 按 JSON Pointer 解析而不是按 `#/components/schemas/` 前缀匹配,将来新增的 `#/$defs/…` 引用自动被覆盖;报错逐条点名悬空的 `$ref` 及其在文档中的位置,并把「已定义的 schema 列表」一并打出来 —— 哪一侧是空的是读者最先需要的信息。
  2. **没有 schema 被静默降级。** 九个契约 schema 是一张字面清单,某个名字没产出东西永远是缺陷而不是「这个可选」。原先的循环写成 `if (像 zod) { 收 }` 且没有 `else`,正是这个「静默跳过」的形状让九次跳过发布成了空文档;现在**声明即强制**,漏掉的名字会被点名。`z.toJSONSchema()` 抛错时原先会塞一个 `{type:'object'}` 占位描述冒充契约,这条同样改为响亮失败 —— 当前九个全部干净转换,零占位。

  门禁接在生成器内部而不是单独的 `check:` 脚本,因为 `packages/spec/json-schema/` 是 gitignore 的、每次 `pnpm build` 重新生成,独立检查脚本无论如何都要先跑一次生成器才有东西可查。「产物自恰」这类断言比「产物最新」更便宜,且不需要任何基线快照。

  `packages/rest` 侧无行为改动:声明式端点的 enrichment 仍然只写 `type: object` 而不编造 `$ref` —— 九个契约 schema 是通用 CRUD 信封,不是某个具体对象的 body 形状 —— 但三处以现在时陈述「`components.schemas` 是空的」的注释已按事实更新。

- 39396bd: REST 的显式状态直通:4xx 错误消息超过 500 字符时**截断**,不再整条替换成 `Request failed`

  `mapDataError` 与 `resolveErrorResponse`(`sendError` 的取值端)两处 4xx 直通分支,过去都以 500 字符为界把整条 message 换成字面量 `Request failed` —— `status` 和 `code` 照常落地,正文一个字不剩。这把激励方向弄反了:驱动层那些拒收信息**唯一的存在意义**就是告诉作者哪个操作符/字段写错了、协议是怎么声明的,而 driver-sql 里写得最细的两条(#5158 未降解的 `FilterArray`、#5347 非布尔 `$null` 比较值)恰好都越过 500 字符,于是客户端只收到 `{ "code": "INVALID_FILTER", "error": "Request failed" }`。更反直觉的是:这两条**不带** `status` 时反而能原文直达(走 `mapDataError` 末尾的 `{ status: 400, body: { error: raw } }`),#4436 给它们加 `status: 400` 是为了赋予 ADR-0112 的 wire 身份,却在这一档让可读性变差了。

  现在超长消息按 `message.slice(0, 499) + '…'` 截断,与驱动侧 `safeShapePreview` 同源。这些消息把主句(操作符、字段、path、收到了什么、协议怎么声明)放在最前,被截掉的是尾部的归因和 issue 号 —— 本就该留在日志里而非响应里的部分。上限仍是 500,变的是**到达上限时的处理方式**;短于 500 的消息逐字不变。

  影响面不止过滤器:任何携带 4xx `status` 的领域错误同享此修复,包括 metadata save 校验的 422(实测一条五 issue 的 `INVALID_METADATA` 就在这条线上下)、plugin-sharing 的 record-scope 403 等。

  `sendError` 一侧的直通区间是 400–599,其中 **5xx 的整条替换刻意保持不变**:4xx 的正文是写给调用方的补救说明,5xx 的正文是服务端故障的日志诊断 —— 这与 `mapDataError` 同族分支「deliberately limited to 4xx」的既有取向一致。

- 577cd27: fix(rest): a declared 5xx no longer ships its own message to the client (#5437)

  **Behaviour change — read this if you operate a deployment or parse REST error
  bodies.** An error that carries an explicit `status` of 500 or above now reaches
  the client as `{ "error": "Internal server error", "code": "<the producer's
code>" }`. The status and the code are unchanged; only the free-text message is
  withheld, and the full original text is written to the server log.

  **What was wrong.** `sendError` — the error path of the metadata, UI, discovery
  and batch routes — passed an explicit status straight through for the whole
  400-599 band, so a declared 5xx returned `error.message` verbatim without
  passing through any of the sanitizing heuristics (`isSqlLeak`,
  `looksLikeInternalErrorLeak`, the `Internal data error` envelope). The sibling
  branch in `mapDataError` stops at 4xx on purpose, with the reason written down:
  "5xx messages keep going through the sanitizing heuristics below so
  internal/SQL details never reach the client verbatim". Two opposite verdicts on
  one question, and the routes that report through `sendError` got the permissive
  one.

  That was reachable, not theoretical. `metadata-protocol` interpolates the raw
  driver error into two client-facing 500s — the customization-overlay persist and
  delete failures — so a real driver line such as `SQLITE_ERROR: no such table:
sys_metadata`, `relation "sys_metadata" does not exist`, or a unique-constraint
  payload naming physical columns was returned to whoever made the request. The
  only thing standing in the way was a 500-character bound, and driver errors are
  far shorter than that. Length was never a proxy for leakage; on this side of the
  bound it failed open.

  **Accepted cost.** A 5xx message written _for_ the caller now reaches them as
  the generic sentence plus its code. Two concrete examples: the overlay-persist
  failure's "In-memory registry was updated but will be lost on restart", and the
  atomic-batch refusal's "retry without options.atomic, or probe
  capabilities.transactionalBatch on /discovery first". Both remain fully readable
  in the server log, and the machine-readable `code` (`OVERLAY_PERSISTENCE_FAILED`,
  `NOT_IMPLEMENTED`) still rides on the response, so a client keying on codes is
  unaffected. If you were surfacing 5xx `error` text in an operator console, read
  it from the log instead — `[REST] Unhandled error` for a genuine fault, and a
  new `[REST] 5xx message withheld from client` line for the 502/503 lifecycle
  statuses that the unhandled-error predicate deliberately keeps quiet.

  The message is dropped unconditionally rather than filtered by keyword: a
  predicate would only move the question to "does the heuristic know this
  dialect", which is the failure mode that produced the bug. 4xx behaviour is
  untouched — an over-long client message is still truncated rather than erased
  (#5423 / #5436).

- 5897552: fix(rest): expected 4xx no longer logged as "[REST] Unhandled error" with a stack (#4886)

  Opening Studio flooded the server log with stack traces. The designer probes
  `GET /meta/:type/:name?state=draft` on every panel to decide whether to show
  "unsaved draft" state, and "no draft exists" is the overwhelmingly common
  answer — true of every artifact nobody is currently editing. `getMetaItem`
  throws a structured `{ code: 'NO_DRAFT', status: 404 }`, the client got a clean
  404 and handled it fine, but the route logged it anyway:

  ```
  [REST] Unhandled error: Error: [no_draft] No pending draft exists for app/showcase_app.
      at _ObjectStackProtocolImplementation.getMetaItem (…)  { code: 'NO_DRAFT', status: 404 }
  ```

  **45 of these in one browsing session** — by far the dominant entry in the log,
  which is how a genuine 500 goes unnoticed, and it misreports severity: nothing
  was broken.

  The metadata routes had 29 catch blocks logging unconditionally. The data
  routes already consulted `isExpectedDataStatus` / `isExpectedQueryRejection` —
  but in four different open-coded spellings across 12 sites, and
  `isExpectedQueryRejection`'s docblock records an earlier lap of exactly this
  drift (the filter and sort codes shipped without joining the list, so every
  rejection they produced was logged as unhandled too).

  Both families now decide through one predicate behind one door,
  `handleRouteError(res, error, object?)`: it resolves the response once — the
  same structured-status passthrough or `mapDataError` envelope `sendError`
  already produced — logs only when that resolved response is a genuine fault,
  then sends it. `isExpectedDataStatus` and `isExpectedQueryRejection` have no
  other callers left, so the two families cannot drift apart again.

  Expected now means an explicitly recognised client or lifecycle outcome:
  403/404/409/502/503, the client-caused 400 query-rejection vocabulary, and
  `VALIDATION_FAILED`. It deliberately does **not** mean "any 4xx" —
  `mapDataError` degrades an error it recognised nothing about to an un-coded
  400, and that bucket is where a real handler bug lands, so it stays loud.

  **No wire responses change** — every status and body is byte-for-byte what it
  was; this only decides whether the log line is printed. Two operator-visible
  log deltas beyond the metadata fix:

  - the cross-object transactional batch route judged on `status >= 500` alone,
    which also swallowed that un-coded 400 — a handler `TypeError` inside a batch
    transaction used to vanish, and now prints;
  - `updateMany` / `deleteMany` / clone / global search / the public-form routes
    stop logging normal 404s, 403s and query rejections.

- 91ec1ea: fix(rest): an unclassified route error answers a sanitised 500, not a 400 (#5489)

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

- 2d25303: fix(rest): 联合类型分支里的拒绝理由现在能到达调用方,不再只剩 `Invalid input` (#5014)

  zod 会把一个失配的 `z.union([...])` 折叠成**一条**顶层 `invalid_union` issue,它自己的
  `message` 是裸的 `"Invalid input"`;每个分支真正的抱怨——包括 #4001 那批 `strictObject`
  写下的处方文案——躺在 `issue.errors` 里(每分支一个数组)。`zodIssuesToFields` 过去只映射
  顶层 issue,于是 `POST /api/v1/data/:object/query` 对着
  `{"search": {"fields": ["name"]}}` 只回一条

  ```
  { "field": "query.search", "code": "invalid_shape", "message": "Invalid input" }
  ```

  ——说清「缺的是 `query` 这个键」的那句话被生产出来,然后被丢掉。同一个坑在
  `QuerySchema.groupBy` 的联合分支上一样:`dateGranularity` 写错值,作者拿不到那份
  「可选 day/week/month/quarter/year」的清单。

  现在 `fields[]` 会在联合条目**之后**追加解释它的分支条目,`field` 用分支路径拼上联合自身
  的路径(`query.search.query`),`code` 照常走 ADR-0114 D3 的目录映射——所以缺键报
  `required` 而不是 `invalid_type`(这一判定要走绝对路径去读入参,分支路径是相对的)。

  分支选择策略直接沿用 #4971 给 CLI/spec 侧 `formatZodError` 落的那一套:只报根部
  KIND 不匹配的分支整支丢弃(全部如此则不展开,输出和以前逐字一致);剩下的**报得最少的
  分支胜出**——这条是防止「一个拼错的键被 N 个分支各报一遍」的机制本身;`unrecognized_keys`
  破平局;声明顺序破剩下的;真正并列的分支全部输出(上限 3 条);跨分支重复的相同结论只
  出现一次;嵌套联合按绝对路径递归,深度上限 3。两侧必须给出**同一个判定**,否则同一个错误
  从终端发布和从 API 提交会得到两套说法。

  对 wire 而言这是**纯追加**:原有的每一条 `fields[]` 条目——包括联合自身那条——`field` /
  `code` / `message` 和相对次序都不变,新条目插在它解释的那条之后。信封形状仍与
  `mapDataError` 同形(ADR-0114),数组长度从来不是契约的一部分。

- 1216dcc: fix(rest): sweep the REST composition root's slot lookups — 16 sites typed (#4251 B4)

  Batch B4 of the #4251 sweep: every service-lookup erasure in the REST
  composition root. `rest-api-plugin.ts` (15) and `external-datasource-routes.ts`
  (1) now pass the slot's contract type instead of annotating the result `any`;
  the ratchet baseline drops **159 → 143 sites, 34 → 32 files**, and both files
  leave the grandfather list. No behaviour change.

  **Every contract named here is evidenced by an `implements`.** `email`,
  `sharing`, `sharingRules`, `reports`, `approvals` and `external-datasource` had
  a written `packages/spec` contract all along, and the class each provider
  registers into the slot declares `implements` on it (`EmailService implements
IEmailService`, `ExternalDatasourceService implements IExternalDatasourceService`,
  …). So the compiler verifies the shape on the producer side on every build and
  this file only has to name it — the #4404 discipline that replaced seven
  unchecked local stand-ins with one checked claim. `auth`, `objectql`, `i18n`,
  `analytics`, `security` and `metadata` come from the `ServiceSlotContracts`
  ledger; `objectql` is `IObjectQLEngine`, not `IDataEngine`, because the consumer
  reaches the full engine (the `transaction` probe behind the batch routes).

  **The wrapper return annotations went with them.** Ten of these lookups sit
  inside `async (environmentId?) => Promise<any | undefined>` providers, and
  typing only the lookup would have re-erased the contract one line later — the
  KNOWN RESIDUAL shape the rule documents and cannot see. Each provider now
  returns its slot's contract.

  **Three slots have no contract, and say so three different ways rather than one
  `any`.** `env-registry` is typed as `RestEnvRegistry`, the shape `RestServer`'s
  own constructor declares for that parameter, so the argument is checked rather
  than waved through. `settings` gets a named local surface (`SettingsReadSurface`)
  following B2's decision for this slot — `service-settings` is optional, so the
  REST layer must not depend on it — carrying the one method the platform consumes
  (`get`, through `resolveLocalizationContext`'s cascade) with the public
  `ResolvedSettingValue` as its return type. `default-project` gets a narrow slice
  declaring only the field this file reads. And the service-existence probe, whose
  slot name is a runtime argument, is `unknown`: it asks whether something
  occupies the slot and never touches its shape, which is exactly what `unknown`
  says and `any` does not.

  **No dead probe this batch — reported rather than implied.** Every earlier batch
  in this line found one (#4361's `getMetaItem` on a service that never had it,
  #4321's `registerInMemory`), so each probe the typed consumers make was checked
  against its contract: `emailService.send`, `authService.getApi` /
  `isAuthGateActive`, `svc.queryDataset`, `ql.transaction`, the six approval
  verbs, the five security methods and the five federation methods all name real
  members at real arities. The `external-datasource` route probes are now visibly
  redundant-but-correct — the contract's methods are required, so `svc?.method` is
  truthy whenever the service resolved, and the 503 path is reached only by the
  service being absent, which is what it is for.

  The new pin is a runtime test, deliberately. `packages/rest` excludes its test
  files from `tsconfig.json` and declares no `typecheck` script, so no tsc program
  compiles them and a type-level assertion there would evaluate never — the
  phantom-check shape #5286 / #5449 paid for. What is checkable is the wiring, and
  that is the risk this change actually carries: the providers are positional
  arguments 6..19 of a twenty-argument constructor, all with the same
  `(environmentId?) => Promise<unknown>` shape, so a provider resolving the wrong
  slot is assignable everywhere and invisible to the compiler. The test drives
  each provider and asserts it hands back the instance registered in ITS slot,
  pins the exact set of slot names the boot resolves, and pins the degraded path
  where every optional slot is empty.

- 90fa077: fix(rest): a missing relation is only an unknown OBJECT when it IS the object asked for (#5462)

  `mapDataError`'s unknown-object heuristic asked whether a driver error mentioned
  `no such table` / `relation … does not exist` — never **which** table was
  missing. A business object that was never registered and the metadata plane
  collapsing entirely produce the same two words, so `sys_metadata` becoming
  unreachable came back to the caller as:

  ```
  404 {"error":"Object not found","code":"OBJECT_NOT_FOUND"}
  ```

  The caller was told to check the object name they typed while the real answer
  was "the metadata store is gone". And because 404 is an `isExpectedDataStatus`,
  `handleRouteError` printed no `[REST] Unhandled error` — so a total outage of
  the metadata plane left **not one line** in the server log. Reproduced in
  process on a real `ObjectQL` + `ObjectStackProtocolImplementation` whose driver
  fails every access with `SQLITE_ERROR: no such table: sys_metadata`:
  `PUT /api/v1/meta/object/acct` answered 404 with zero log lines.

  **The rule now: a missing-relation message is an unknown-object verdict only
  when the relation it names is the object the request named.** Attribution takes
  both halves — a request object, and a relation name the phrasing actually
  carries (`no such table: main.acct`, `relation "public.acct" does not exist`;
  the schema qualifier is stripped and the compare is case-insensitive). Prime
  Directive #6 is what makes that comparison sound rather than a guess: the object
  `name` **is** the table name, with no `tableName` mapping to launder it.

  Anything unattributable — a different table than the one asked for, an auxiliary
  table, no request object at all (which is every metadata / UI / discovery route,
  since they call `handleRouteError(res, error)` without one), or a phrasing that
  names no relation — is now the sanitised data-store fault the SQL-leak branch
  has always emitted: `500 { "error": "Internal data error", "code":
"DATABASE_ERROR" }`. 500 sits outside `isExpectedDataStatus`, which is what buys
  back the log line the silent 404 never had; the driver's own words still never
  reach the client.

  Deliberately unchanged:

  - **A genuine unknown object is still a quiet `404 OBJECT_NOT_FOUND`.** Both
    producers still land on one envelope (#3770): the protocol's registry gate,
    and the driver limb when the missing table is the requested object. It still
    logs nothing — an unknown object is a client mistake, not a fault (#4886).
  - **The engine-authored limbs.** `unknown object`, `object not found`,
    `[ObjectQL] No driver available for object '<name>'` and the quoted-name
    catch-all are ObjectStack's own vocabulary about a named object; they mean
    what they say. Only the DATABASE-authored limbs, which cannot know which table
    the caller wanted, needed attribution.
  - **The declared-status band.** #5437/#5464 (a declared 5xx is withheld and
    logged) and #5423/#5436 (a 4xx is truncated, not erased) answer in
    `resolveErrorResponse` before the heuristic is reached at all. That fix
    covered producers that declare `status: 500`; this path never reached it,
    because `saveMetaItem` rethrows the driver's `Error` with no `status` and no
    `code` — which is why the message text was judging it.

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
  - @objectstack/observability@17.0.0-rc.4
  - @objectstack/service-package@17.0.0-rc.4

## 17.0.0-rc.2

### Minor Changes

- 05d8a54: fix(rest)!: 服务端权威闸门现在也过滤 `areas[].navigation` —— area 内导航项的权限/能力闸门不再只是渲染层的礼貌 (#4722)

  `filterAppForUser` 是 `/meta` 上 app 元数据的**服务端权威可见性闸门**,但它此前只走 app
  的顶层 `navigation` 树:读到 `item.navigation` 不存在就原样返回,`item.areas` 从头到尾没被
  读过。后果是,写在 **area 内部**导航项上的 `requiredPermissions` / `requiresService`
  只有客户端 `NavigationRenderer` 会执行 —— 该条目连同它的 `objectName` / `pageName` /
  `componentRef` 指向,照常出现在 `/meta` 响应体里。改一次前端状态、或者直接读 `/meta` 的
  JSON,就能看到本该被 gate 掉的条目。对 areas 型 app 而言,导航项级闸门此前**不是**服务端强制。

  **现在**:同一个 `filterNav` 被复用到每一棵 `areas[].navigation` 上 —— 不是第二份实现,
  所以两棵树对同一个键的语义不可能漂移。列表 `GET /meta/apps` 与单项 `GET /meta/apps/:name`
  两条路径都覆盖(两者都经过这个函数;单项读对 app 类型本就绕过缓存)。

  **响应形状收紧(可能影响消费方)**:无权限用户拿到的 app 元数据里,被 gate 掉的 area 内
  导航项**不再出现**。被闸门滤空的 area 整个剥离 —— 与顶层树对「被滤空的 group」的既有处理
  同形(空壳标签没有消费价值);作者本就写成空的 area 原样返回(过滤只报告调用方看不到什么,
  不负责整理元数据)。任何依赖「服务端会把 area 内条目全量下发、由客户端自己藏」的消费方需要
  改为信任服务端已过滤后的树 —— 这正是本次收紧的目的。

  同一提交修正了 `resolveRegisteredServices` 的探测面:它此前每个节点只取第一个命中的子数组
  (`navigation` / `children` / `widgets` 三选一),不会下钻 `areas`。若不改,只在 area 内被
  引用的服务名不会被探测,而未探测的名字在闸门看来等同于「服务不存在」,会把一个本该存活的
  条目误剥离 —— 探测面必须与过滤面完全一致。

  **明确不做**:`visible`(CEL)在任何层级仍然只在客户端求值 —— 服务端求值需要绑定 `user`
  上下文,不是这个读路径现有的能力,另立单处理。这个不对称写进了代码注释、`packages/spec/liveness/app.json`
  的账本 note,以及 `rest.test.ts` 的 characterisation pin。必须永不到达浏览器的东西,写
  `requiredPermissions`,不要写 `visible`。#4651 退役的 **area 级**键(`areas[].visible` /
  `areas[].requiredPermissions`)未被复活:本次强制的是 area **里面**的项级闸门。

- 8aacf94: feat(rest,runtime,client): `POST /meta/_migrate-stored` — run the stored-metadata migration without a shell (#4327)

  `os migrate meta --stored` (#4327) gave ADR-0087's stored-metadata chain a finish
  line, but only for someone who can reach the deployment's database from a
  terminal. A hosted operator cannot, so on a managed deployment the chain had no
  finish line at all — just the per-read conversion, running forever, with no way
  to assert what protocol the rows are on.

  The same pass is now reachable over HTTP:

  ```ts
  const preview = await client.meta.migrateStored(); // writes nothing
  const result = await client.meta.migrateStored({ apply: true });
  const flows = await client.meta.migrateStored({ types: ["flow"] });
  ```

  It returns the same `StoredMigrationReport` the CLI renders, and takes the same
  posture:

  - **Preview by default.** `apply` must be literally `true`; an empty body, a
    missing body, and `"apply": "yes"` all preview. Nothing is inferred.
  - **Gated on `manage_metadata`.** Unlike the single-item `PUT /meta/:type/:name`
    next door, this rewrites every eligible row in the deployment, so it demands
    the ADR-0066 D1 authoring capability rather than just a session, and answers
    `403` otherwise. The gate runs before the protocol is probed, so an
    unauthorized caller cannot use `403`-vs-`501` to learn which kernels can be
    migrated. `/meta`'s anonymous-deny umbrella still closes it to anonymous
    callers first.
  - **Attributed to the caller.** The `actor` recorded on the history and audit
    rows names the user who fired it — that is the question those rows exist to
    answer.

  **Flows need no extra setup on this path.** The CLI has to boot an inert
  automation engine to hold the executor registry ADR-0078's conflict guard needs;
  a server already has a live one, and the protocol resolves it from the services
  registry itself (#4498), so this route covers flow rows by simply running in the
  process that owns them.

  Registered on both the REST server and the runtime dispatcher's `/meta` domain,
  ledgered in both route ledgers, and mounted before `/:type` so the
  leading-underscore segment is never captured as a metadata type name.

### Patch Changes

- 2826d1e: fix(automation,approvals): an approval decision can no longer succeed while its flow stays parked (#4420)

  A flow paused at an `approval` node, a deploy, then an approver clicking
  Approve: the request row flipped to `approved`, the UI toasted success — and
  the flow never moved. No next-stage request, no error, the record's mirrored
  status frozen mid-workflow. Approval flows pause for days by design, so a
  restart mid-flight is the normal case: every release could quietly zombify
  every in-flight approval, with the approvers none the wiser.

  Durable suspended runs (#1518) had shipped and were not the missing piece. Two
  other things were.

  **The wiring could enable a store over a table nobody had created.** Object
  registration and store activation resolve different services in different
  phases — `manifest` at `init()`, `objectql` at `start()` — and the plugin
  declared no ordering. Composed ahead of ObjectQL, `init()` found no `manifest`,
  warned, and continued; `start()` then attached the DB-backed store anyway. Every
  suspend failed with `no such table: sys_automation_run` into a log line nobody
  read, pauses silently stayed in memory, and the next restart lost them all.
  Now: `AutomationServicePlugin` declares `optionalDependencies:
['com.objectstack.engine.objectql']` (order-if-present, per ADR-0116 — an
  engine-less kernel must still boot); a registration missed at `init()` is
  retried at `start()`, which still lands before ObjectQL's schema sync; the
  store is never attached when registration did not happen, and says so at
  **error** level instead of warning; the table is probed once at boot so a
  broken setup surfaces there rather than one failed write at a time; and a
  failed durable write of a paused run is logged at error — it is data loss in
  waiting, not a warning.

  **A reported resume failure read as success.** `AutomationEngine.resume()`
  answers a lost run by _returning_ `{ success: false }`, never by throwing.
  `ApprovalService` discarded that return value, and `decide()` counted only a
  thrown error as failure — so a decision against a dead run came back
  `resumed: true`, HTTP 200. Resume failures are now classified
  (`RUN_NOT_FOUND`, `STORE_UNAVAILABLE`, `RESUME_IN_PROGRESS`, joining
  `PERMISSION_DENIED` / `INVALID_SIGNAL`), so a run that is gone for good is
  distinguishable from a store that is merely unreachable, and the raw resume
  route maps them to 404 / 503 / 409.

  Approvals acts on them. A new `AutomationEngine.hasSuspendedRun(runId)` — which
  reads the suspension store, unlike `getRun()`, and throws rather than answering
  `false` when the store is unreadable — pre-flights every flow-advancing
  operation (`decide`, `sendBack`, `resubmit`) **before its first write**, so the
  zombie half-state is never created rather than merely reported: the decision
  fails with `RESUME_TARGET_LOST` (HTTP 409) and the request stays actionable. A
  resume that fails after the decision is durable can no longer be undone, but it
  now throws `RESUME_FAILED` (HTTP 500) naming the stranded run instead of
  reporting success. A concurrent duplicate resume stays benign — the engine's
  idempotency guard is doing its job — and reports through the new optional
  `resumeError` field. Recall and revise-window cancellation stay non-fatal by
  design (they abandon the request), but log at error with the reason instead of
  swallowing it. Compositions with no automation engine attached are unaffected.

  Existing zombie requests from affected deployments (already `approved`, run
  stranded) are not repaired by this change — `releaseDeadRunRequests` only
  sweeps requests that are still `pending`.

- be25f97: fix(rest): dataset queries stop rejecting their own read-time annotation

  Every widget on every dataset-bound dashboard failed with

  ```
  Dataset query failed: 400 Bad Request — Invalid dataset definition.
  ```

  The dataset itself was fine. `POST /analytics/dataset/query` resolves a saved
  `datasetName` through `getMetaItems`, and the metadata READ path stamps the
  spec-validation verdict `_diagnostics` onto every document it serves. Since
  #4001 closed the metadata schemas, `DatasetSchema.parse()` rejects unrecognized
  keys instead of dropping them — so the route handed a served document back to
  the very schema that produced it and got `unrecognized_keys: ["_diagnostics"]`
  for its trouble. The 400 blamed the author for a key the server had just added.

  This is the failure mode `stripReadDecorations` exists to prevent, and the one
  `spec/kernel/metadata-read-decorations.ts` already documents from the cold-boot
  flow bind (cloud#971): _a served body is not a valid input to the schema that
  produced it._ The route now strips read decorations before validating.

  Stripped on **both** branches, not only the `datasetName` read: the Studio
  dataset preview posts its draft inline, and that draft is the document the
  designer GET-loaded — decorations and all. A hand-authored draft never carries
  these keys, so the strip is a no-op there. The ADR-0010 provenance envelope
  (`_packageId`, `_provenance`, `_lock`, …) is deliberately _not_ a read
  decoration and still survives the round-trip.

  Regression coverage for the saved-dataset path was the gap that let this ship —
  every existing case passed the dataset inline, so nothing exercised the read.
  The route's tests now cover resolve-by-name, the inline decorated draft, the
  404, and a genuinely malformed saved dataset (still a 400).

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- be90dea: fix(plugin-audit,rest)!: `sys_comment` derives its access from the record its thread names (#4630)

  Attachments derive their visibility from the parent record; comments derived
  nothing. On the _same_ record, with the _same_ user, the two answered
  differently:

  ```
  user: rep2 (does NOT own and cannot read the opportunity)
  GET  /api/v1/data/crm_opportunity?$filter=["id","=","1A7n…"]      → 200, 0 rows
  GET  /api/v1/data/sys_attachment?$filter=["parent_id","=","1A7n…"] → 200, 0 rows
  GET  /api/v1/data/sys_comment?$filter=["thread_id","=","crm_opportunity:1A7n…"]
                                                                     → 200, 1 row
  POST /api/v1/data/sys_comment {"thread_id":"crm_opportunity:", …}  → 201 Created
  ```

  `sys_comment` is public, has no owner column, and hides its parent inside a
  string (`thread_id` = `{object_name}:{record_id}`), so neither OWD/sharing nor
  RLS ever narrowed it. Because `enable.feeds` is opt-OUT (spec default `true`),
  every object in every app carried that org-wide readable, org-wide writable
  side-channel — a deployment that carefully authored OWD, sharing rules and RLS
  on its records still leaked their discussion.

  `AuditPlugin` now installs the same two-part kit `service-storage` installs for
  `sys_attachment`, keyed off `thread_id`'s parent:

  - **read** — a `find`/`findOne`/`count`/`aggregate` middleware intersects every
    query with the threads whose record the caller can actually read (resolved
    through the caller-scoped engine, so the parent's own OWD/sharing/RLS/CRUD
    decide). `count()` is filtered identically to `find()`, so a list `total`
    cannot leak the hidden rows' existence either.
  - **write** — `beforeInsert` requires READ on the record the thread names;
    `beforeUpdate` / `beforeDelete` require the caller to be the comment's AUTHOR
    or to hold EDIT on that record. `author_id` is server-stamped from the
    session, so a client-supplied value never wins.

  Everything fails CLOSED: a `thread_id` that names no record — the dangling
  `"crm_opportunity:"` above, a free-form thread, a thread on `sys_comment`
  itself — is refused on write and excluded on read, and a filter that cannot be
  computed denies all rather than falling open. Refusals answer **403
  `RECORD_NOT_ACCESSIBLE`** (the standard error catalog, per ADR-0112 — a generic
  permission condition takes a catalogued code rather than a new synonym), with
  `error.object` naming the record's object.

  **Breaking for deployments that depended on the gap.** Reads that used to
  return other people's comments now return fewer rows (or none), and writes that
  used to 201 now 403. Specifically:

  - Listing `sys_comment` without being able to read the parent record → the row
    is gone, not merely unlabelled. Panels that render a thread must be reached by
    a principal who can read the record.
  - Threads whose `thread_id` is not `{object_name}:{record_id}` are no longer
    usable at all: creating one is refused, and existing rows become invisible to
    everyone but system context. Migrate free-form threads to a real record
    reference (or keep them under a system-context surface).
  - Deleting or editing another user's comment now requires EDIT on the record.
    Note also that `sys_comment` delete already needed a permission set carrying
    `allowDelete` — the `member_default` baseline has none (ADR-0090 D5).
  - Posting a comment no longer requires the client to send `author_id` (it is
    stamped); a client that sends someone else's is silently corrected rather than
    believed.

  Orthogonal and unchanged: `enable.feeds` (`FEEDS_DISABLED`) still gates whether
  an object has comments at all, and anonymous callers are still refused with 401
  before any of this runs.

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
  - @objectstack/observability@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2
  - @objectstack/service-package@17.0.0-rc.2

## 17.0.0-rc.1

### Major Changes

- 3c628ce: feat(auth)!: retire the `api.requireAuth` opt-out — anonymous access to object data is always denied (#3963)

  `api.requireAuth: false` let a deployment open its ENTIRE data plane with one
  config key. It is removed. Auth is a kernel concern, not a deployment posture:
  anonymous callers are denied on every HTTP surface that reaches object data,
  unconditionally.

  Every surface that legitimately serves a session-less caller already derives its
  own narrow authorization from a DECLARATION, so none of them needed the global
  switch:

  - control plane (`/auth/*`, `/health`, `/ready`, `/discovery`, ADR-0069
    remediation) — the auth-gate allowlist;
  - public form submission — `publicFormGrant` (ADR-0056 Option A);
  - share links — the capability token, validated then read as SYSTEM;
  - a `book.audience: 'public'` read — the ADR-0046 §6.7 audience gate (#3995);
  - MCP — an OAuth token or API key.

  **Breaking changes.**

  - `api.requireAuth` is a retired key. It is tombstoned (`retiredKey`) in both
    `RestApiConfigSchema` and the stack `api` block, so authoring it now fails with
    a fix-it message rather than being silently stripped (the ADR-0104 / #3733
    quiet-failure this whole line of work has been closing). `os migrate meta`
    drops it via the protocol-17 conversion `stack-api-require-auth-removed`.
  - `shouldDenyAnonymous` (@objectstack/core) no longer takes a `requireAuth`
    input; it denies any anonymous, non-system caller outside the control-plane
    allowlist.
  - A stack that mounts **no auth at all** now FAILS AT BOOT when it would serve a
    data API (`objectstack serve`, plugin-dev), instead of getting an explicit
    fail-open. Enable auth (the `auth` tier or AuthPlugin), or run without the data
    API. There is no anonymous-data carve-out any more — publishing a public
    surface is done by declaration (see above).

  **Migration.** Delete `api.requireAuth` from the stack config (or run
  `os migrate meta`). If you were serving data publicly with `requireAuth: false`,
  replace it with the declaration that fits: a public form view, a share link, or
  `book.audience: 'public'`. If you have an auth-less stack that intentionally
  served data, it must now mount auth or stop serving the data API.

### Minor Changes

- c1dcacd: fix(sharing)!: the share-management surface gains the authorization layer it never had (ADR-0111 P0, #3902)

  Record sharing shipped as a data layer with no authorization of its own: every
  `/data/:object/:id/shares` and `/sharing/rules` route authenticated the caller
  and then ran the service under `SYSTEM_CTX` — any signed-in user could revoke
  anyone's share, enumerate who-can-see-what, write self-grants, and define /
  evaluate org-wide sharing rules. ADR-0111's P0 rulings land here:

  - **D1/D2** — `ISharingService.canManageShares(object, recordId, context)`:
    system, the record's owner, or a holder of Modify All Data (probed via the
    new fail-closed `ISecurityService.hasWriteBypass`). Enforced in the SERVICE,
    so every caller is covered; without plugin-security it fails closed to
    owner-only.
  - **D4** — `revoke` is symmetric with grant, validates the share belongs to the
    URL's record (`NOT_FOUND` on mismatch), and refuses non-`manual` rows
    (`CONFLICT` — a rule-materialised grant would be resurrected by the next
    reconcile).
  - **D5** — `listShares` is management-gated (invisible record → `NOT_FOUND`,
    visible-but-not-manager → `PERMISSION_DENIED`), and the open
    `/data/sys_record_share` read surface is self-scoped: non-admin callers see
    only rows naming them as recipient or grantor.
  - **D6** — the whole `/sharing/rules` surface (list/create/get/delete/evaluate)
    requires the new **`manage_sharing`** capability (D9; seeded into
    `admin_full_access`, `manage_platform_settings` honoured as the legacy
    equivalent), enforced in `SharingRuleService`.
  - **D7** — no inert grants: `recipientType` is narrowed to `user` (the only
    type any gate enforces), grants on objects the sharing gates never consult
    (public model, no `owner_id`, bypass, `controlled_by_parent`) fail with
    `SHARING_NOT_ENABLED` (422), and the manual upsert keys on
    `(object, record, recipient, source)` so manual and rule rows coexist.

  **Breaking** for callers that relied on the missing gate: unauthorized share
  management now fails with 403/404/409/422 instead of silently succeeding, and
  `ISharingService.revoke` gained an optional `scope` parameter. The verb
  boundary (edit ≠ delete, ADR-0111 D3) is NOT in this change — it lands as the
  separate P1.

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

- 7d7521f: feat(spec,rest,objectql)!: a closed field-level error catalog, and Zod stops leaking onto the wire (#3977)

  Settles the vocabulary ADR-0112 D6 deferred, per [ADR-0114](https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0114-field-level-error-code-catalog.md).

  **`FieldErrorCode` — a closed, lowercase catalog.** 27 members covering what the
  six emitters already emit. `FieldErrorSchema.code` tightens from `z.string()` to
  this enum, so a validation body's per-field codes are validated for the first time.
  `FieldValidationError.code` (objectql) and `FieldCoerceError.code` (rest) stop
  being a hand-listed union and a bare `string` respectively and reference the
  catalog, so the three cannot drift apart.

  Lowercase is deliberate, not an oversight against ADR-0112's SCREAMING*SNAKE: a
  top-level code names the condition the \_request* hit, while a field-level code
  names the _constraint_ the value violated — and constraints are declared in the
  metadata's own snake_case, so `max_length` the code and `max_length: 50` the
  property are the same word on purpose.

  **Zod issue codes no longer reach the wire (wire-visible).** Routes that validate
  with Zod passed its vocabulary straight through, so `fields[]` spoke a different
  language depending on which route served it, and `too_small` was ambiguous between
  a short string, a small number and a short array. `zodIssuesToFields` now maps
  using Zod's `origin`/`format`:

  | Was                                               | Now                                                |
  | :------------------------------------------------ | :------------------------------------------------- |
  | `too_small`                                       | `min_length` / `min_value` / `min_items`           |
  | `too_big`                                         | `max_length` / `max_value` / `max_items`           |
  | `invalid_format`                                  | `invalid_email` / `invalid_url` / `invalid_format` |
  | `invalid_value`                                   | `invalid_option`                                   |
  | `unrecognized_keys`                               | `unknown_field`                                    |
  | `invalid_union`, `invalid_element`, `invalid_key` | `invalid_shape`                                    |

  **A missing required property now reports `required`, not `invalid_type`.** Zod
  spells "absent" as a type mismatch against `undefined`, so passing it through made
  a form mark a _missing_ input as the wrong _type_. The two are indistinguishable on
  the issue alone, so the mapper takes the parsed input as an optional argument and
  walks the issue path; a caller that cannot supply it keeps `invalid_type` rather
  than guessing.

  **`unknown_param` → `unknown_field`.** `ActionParamIssue.code` references the
  catalog instead of its own literal union; the `param` key beside it already says
  what was addressed.

  **Not changed:** `EnhancedApiErrorSchema.fieldErrors` keeps its name even though
  every producer emits `fields`. Retiring an authorable key needs a tombstone plus a
  migration (ADR-0104's contract guard), so it lands on its own — the property now
  carries a banner saying which name the wire uses.

- 789ad63: fix(spec,rest): the batch-size cap is enforced now, and each bulk endpoint has one Zod source (#3939)

  `max 200` was declared in four places and enforced in one.

  `batch.zod.ts` put `.min(1).max(200)` on `BatchUpdateRequestSchema`,
  `UpdateManyRequestSchema` and `DeleteManyRequestSchema`, and the docs repeated
  it — but no per-object bulk route validated against those schemas, so
  `createMany` / `updateMany` / `deleteMany` / `/data/:object/batch` all accepted
  an unbounded list. The only route that capped anything was the cross-object
  `/batch`, and it checked the _configured_ `maxBatchSize` rather than the
  hardcoded 200 — so even the one enforcement point disagreed with the schema.

  That stopped being cosmetic with #3897, which made `deleteMany` delete per id by
  primary key (so `deleteBehavior` cascades run and every row gets its own
  result). A 10k-id body is now 10k sequential engine round-trips inside a single
  request, where before it was one statement that mostly failed anyway.

  **The cap moved to the routes, and the schemas gave it up.** Batch size is
  deployment policy — `RestServerConfig.batch.maxBatchSize`, 1..1000, default 200
  — so a hardcoded bound in the spec could only ever be a second, wrong answer
  (a deployment raising the limit to 500 would still have been refused at 200).
  All five bulk routes now call one `enforceBatchSize` helper with the configured
  value and answer with one envelope:

  ```json
  {
    "error": "Batch too large: 500 records (max 200)",
    "code": "BATCH_TOO_LARGE",
    "count": 500,
    "max": 200,
    "object": "account"
  }
  ```

  The cross-object route is included: it used to answer with a bare `error` string
  and no `code` for a client to key on.

  **One Zod source per bulk endpoint (Prime Directive #7).** Each of these
  endpoints had _two_ schemas, and they had already drifted into disagreeing about
  more than counts: `UpdateManyRequestSchema` described its rows with
  `BatchRecordSchema`, whose `id` and `data` are optional because the generic
  `/batch` route serves create (no id) and delete (no data) through the same
  shape — so the declared contract accepted `{}` rows that `updateManyData`, which
  reads `record.id` and `record.data` unconditionally, could never process. The
  enforced shape lived in the _other_ copy, in `protocol.zod.ts`.

  The wire body is now the single source (`UpdateManyRequestSchema` /
  `DeleteManyRequestSchema`, with the new `UpdateManyRecordSchema` for a row), and
  the protocol schemas are that plus the `object` the route takes from the URL
  path (#3933) — `UpdateManyRequestSchema.extend({ object })`. The derivation runs
  that direction because `protocol.zod` already imports `batch.zod`; the reverse
  would be a cycle.

  **Behaviour changes.**

  - A bulk request over the configured cap is `400 BATCH_TOO_LARGE` instead of
    being executed. Deployments that were quietly relying on unbounded batches
    should raise `batch.maxBatchSize` (up to 1000) rather than discover the cap in
    production.
  - `.min(1)` is gone with `.max(200)`: an empty batch is a no-op returning
    `total: 0`, which is what these routes already did, rather than a validation
    error the schema claimed but nothing raised.
  - `UpdateManyRequest` now types (and validates) `records` as
    `{ id: string; data: Record<string, unknown> }[]`. Callers already had to send
    that — the route has validated the strict shape since #3933 — but the declared
    type was looser.
  - New export: `UpdateManyRecordSchema` / `UpdateManyRecord`.

- fccec22: fix(rest): bulk writes bind to the object in the path, not the one in the body (#3933)

  `POST /data/:object/updateMany` spread the request body over the value it had
  just taken from the URL:

  ```js
  const result = await p.updateManyData!({
      object: req.params.object,   // trusted, written first
      ...req.body,                 // …and spread over it
      ...
  });
  ```

  The gate on the line above reads the PATH object — `enforceApiAccess` starts
  with `const objectName = req?.params?.object` — so `enable.apiEnabled` /
  `enable.apiMethods` (ADR-0049 / #1889) was enforced on the object in the URL
  while the object named in the body got written. Measured on a stock CRM dev
  deployment: `POST /data/crm_account/updateMany` with
  `{"object":"crm_contact", "records":[…]}` returned `succeeded: 1` and changed
  the `crm_contact` row. Point the URL at any exposed object, name a hidden one in
  the body, and the gate clears the wrong object every time.

  This is not a row-authorization bypass — the engine middleware still evaluates
  RLS/FLS against the object actually written, and `assertObjectRegistered` (#3770)
  still resolves it. What it defeats is the object-level exposure policy, the layer
  ADR-0049 exists to make enforceable rather than advisory.

  The path object is now written LAST, after the body, so the object the gate
  cleared is the object that gets written — a property of the code rather than of
  the caller declining to send that key. The body is parsed against
  `UpdateManyDataRequestSchema` first, which (Zod strips unknown keys) also stops a
  body `context` from becoming the execution context on a deployment where none
  resolves — `requireAuth: false` plus an anonymous caller, the one case where the
  trailing `...(context ? { context } : {})` has nothing to overwrite it with.

  `deleteMany` gets the same ordering: #3897 moved it behind a schema parse, but
  fed that parse `{ object: req.params.object, ...req.body }` — still body-wins.
  `createMany` (`records: req.body || []`) and `batch` (`request: req.body`) never
  splatted the body at the top level and are unaffected.

  **Behaviour change.** A malformed `updateMany` body is now `400
VALIDATION_FAILED` naming the offending path, instead of reaching the protocol
  and failing further in. A body `object` key is ignored rather than honoured.

- f4d7f1d: fix(metadata-protocol,rest): the id list is the only thing deleteMany can select on (#3897)

  `deleteManyData` built the predicate its endpoint is named after and then spread
  the caller's `options` **over** it:

  ```js
  return this.engine.delete(request.object, {
    where: { id: { $in: request.ids } },
    ...request.options, // ← lands after `where`, so it can replace it
  });
  ```

  `request.options` is caller-supplied — `POST /data/:object/deleteMany` splatted
  the whole request body into the protocol request (`{ object, ...req.body }`) —
  so one body key rewrote the operation:

  ```json
  { "ids": ["a"], "options": { "multi": true, "where": {} } }
  ```

  reached `engine.delete` as an unscoped bulk delete. The engine's write
  middleware still composes RLS/sharing predicates onto the AST, so the blast
  radius is not automatically the whole table: it is **everything the caller is
  allowed to delete**. For an ordinary user with delete permission that is the
  difference between the 3 records they asked for and every record they can see;
  measured on a stock CRM dev deployment, that payload against one id removed all
  8 rows in the object and returned the raw driver count (`8`). The same spread
  also accepted `context`, i.e. a forged principal wherever the route is reachable
  without auth.

  **The id set is now authoritative, structurally.** The engine options are built
  from the validated id list and nothing else — caller `options` is a
  `BatchOptions` bag (`atomic` / `returnRecords` / `continueOnError` /
  `validateOnly`) that carries nothing `engine.delete` consumes, so merging it
  could only ever smuggle in engine keys. Ids must be scalars, so an operator
  object (`{"ids":[{"$ne":null}]}`) cannot reach `where.id` either; a malformed
  list is a `400 VALIDATION_FAILED` instead of a wider delete. The REST route
  parses the body against `DeleteManyDataRequestSchema` first, one hop earlier —
  Zod object schemas strip unknown keys, so `options.where`, top-level `where` and
  a body `context` no longer survive the ingress at all.

  **The endpoint also works now.** `deleteManyData` never set `multi`, so a
  correctly-formed `{"ids":[…]}` hit the engine's
  `'Delete requires an ID or options.multi=true'` throw — only the requests that
  triggered the override above ever completed. Deletes now go one id at a time by
  primary key, the same shape `batchData`'s `delete` case uses, which closes two
  gaps behind that: the bulk branch skips `cascadeDeleteRelations`, so
  `deleteBehavior` (`cascade` / `set_null` / `restrict`) was not honoured for the
  rows it removed; and the declared `BatchUpdateResponse` contract (per-record
  `results`, `atomic`, `continueOnError`) was unimplementable from a bulk row
  count. Both are delivered rather than declared.

  **Behaviour change.** The endpoint returns a `BatchUpdateResponse`
  (`{ success, operation, total, succeeded, failed, results }`) where it
  previously returned the driver's raw delete count — on the paths where it
  returned anything at all. The caller's execution context is threaded to every
  delete, so RLS/FLS now run under the caller here as they do on the single-record
  route.

- 507b92a: fix(spec,objectql,rest,runtime): field-validation messages answer in the caller's language, named by the field's label (#3957)

  The write path built every built-in validation message by concatenating the **API
  field name** into a **hardcoded English** template. Those strings are what the
  Console toast, the CSV-import row report, the CLI and any custom client display
  verbatim, so a Chinese-locale user importing a bad row read:

  ```
  第 1 行:penalty_amount must be ≥ 0
  ```

  …for a field declared `label: '处罚金额'` with a full `zh-CN` bundle loaded. The
  form layer localized the _same_ constraint correctly (the browser's native
  `min`), so the language flipped depending on which layer caught the value.

  **Three things changed.**

  1. **The message is rendered in the caller's locale** from a built-in catalog
     (`BUILTIN_VALIDATION_MESSAGES`, `@objectstack/spec/system`) shipping `en`,
     `zh-CN`, `ja-JP`, `es-ES` — the same four locales as the platform bundles.
     The locale comes from `ExecutionContext.locale`, whose contract already read
     "Drives message catalogs"; this is the consumer that makes that true. Both
     HTTP entries (REST server, runtime dispatcher) now resolve it from the
     request's `Accept-Language` / `?locale` first, falling back to the workspace
     `localization.locale` — so a rejection message and the field labels around it
     can no longer disagree.

  2. **The field is named by its label, never the API name**: translation bundle
     (`objects.<obj>.fields.<f>.label`) → declared `label` → API name as the last
     resort. `FieldValidationError.field` still carries the API name so a form can
     focus the right input.

  3. **The constraint is exposed as data**, so a client can format its own text
     instead of parsing the sentence:
     `{ field, code, message, label, constraint: { min: 0 } }`. This rides
     ADR-0114's existing `constraint` / `value` positions on `FieldErrorSchema`
     (`constraint` tightens from `unknown` to `Record<string, unknown>`) rather
     than adding a parallel payload — `label` is the only new field. The bag
     carries `min`/`max`/`minLength`/`maxLength`/`actual`/`allowed`/`type`, and the
     message templates interpolate from exactly those keys.

  Covered end-to-end, not only in the validator: single and batch insert,
  single-id and multi-row update, ADR-0113's clear-out rejection, the object-level
  rule evaluator's own built-in messages (`requiredWhen`, per-option gating,
  state-machine fallbacks), and the importer's cell-coercion, required pre-check
  and #3956 bound pre-check messages — all of which land in the same row report.

  **What this changes for consumers.**

  - `code` is unchanged (ADR-0114's `FieldErrorCode`) and remains the thing to
    match on. Message keys are finer-grained than codes — `invalid_datetime`,
    `invalid_option_value`, `required_cleared` are rendering detail and never reach
    the wire — so localization never splits the client-facing vocabulary.
  - `message` **text changes**: it is localized, and it names the field by label
    even in English (`Budget must be ≥ 0`, not `budget must be ≥ 0`). Anything
    asserting on the old English string should match `code` (and now
    `constraint`) instead.
  - An author-written validation-rule `message` is never touched — it is already
    in the language its author chose.
  - A deployment can override any built-in message with a `translation` item
    defining `validation.field.<messageKey>` (e.g.
    `validation.field.min_value: '{{label}}不得小于 {{min}} 元'`).
  - The importer's reference-failure message no longer names the target object's
    API name (`no sys_user matches "…"`): naming internal identifiers is the
    defect being fixed, and the column plus the offending value are what an
    importer can act on.

- be7945a: feat(rest): `audience: 'public'` publishes a book anonymously on a secure-by-default deployment (#3963)

  `book.audience: 'public'` was a declared per-book capability that in practice
  required the deployment to open its **entire** data plane. The `/meta` umbrella
  gate refused every anonymous caller unless `api.requireAuth` was `false`, so a
  `public` book was only ever reachable inside a globally-public deployment — the
  audience model was _re-narrowing_ what that flag had already opened, not granting
  anything of its own. ADR-0046 §6.7 recorded exactly that as ground truth ("the
  gate is the optional global `requireAuth` … not the handler").

  The exemption is now derived from the declaration, the same shape ADR-0056
  Option A chose for public form submission (`publicFormGrant`): the umbrella gate
  admits an anonymous **GET** of the book/doc read surface, and the §6.7 audience
  gate inside the handler is what authorizes it.

  Narrow in three independent ways:

  1. **Only when no execution context resolved.** An authenticated caller still
     goes through `enforceAuth` unchanged, so the ADR-0069 auth-policy gate
     (expired password, enforced MFA) keeps governing a gated session's book reads.
  2. **Only GET, only book/doc.** `GET /meta/:type`, `GET /meta/:type/:name` (type
     `book` or `doc`, either spelling — #3984) and `GET /meta/book/:name/tree`.
     Every other type stays 401 for anonymous, writes stay 401, and `GET /meta`
     itself stays 401. The predicate keys on the REGISTERED route path plus the
     normalized `:type`, so a route added later cannot fall into it by accident.
  3. **Reachability, not authorization.** `audienceAllows` admits `'public'` only;
     `org` and `{ permissionSet }` books require `caller.authenticated` and
     unresolvable holdings fail closed, so an anonymous read of a gated book is
     still `401`.

  A deployment can now publish a public manual with `requireAuth: true` — which is
  the prerequisite for retiring that flag entirely (#3963 step 2). ADR-0046 §6.7
  carries an amendment recording the new gate; its SEO and tenant-from-host
  reasoning is unchanged, having never depended on the flag.

- a1b61e0: Request bodies are now checked against the schemas the API catalog declares for them (#3899, the request-side dual of #3877).

  **Routes that now answer `400 VALIDATION_FAILED` + `fields[]` for a body violating their declared `requestSchema`** (previously the body was consumed raw, and a malformed one silently executed different semantics):

  - `POST /data/:object/query` — body must be a QueryAST (`FindDataRequestSchema`); a garbage body used to degrade into an unfiltered full read. The path `object` is now pinned into the forwarded query (a body `object` can no longer contradict the path).
  - `POST /data/:object` / `PATCH /data/:object/:id` — body must be a record object (`CreateDataRequestSchema` / `UpdateDataRequestSchema`).
  - `POST /data/:object/batch` — body must be a `BatchUpdateRequestSchema` (`operation` + `records[]`).
  - `POST /data/:object/createMany` — body must be a bare JSON array of records (`CreateManyDataRequestSchema`); `{ records: [...] }` (updateMany's envelope) is rejected with a pointer.
  - `POST /notifications/read` — body must be `{ ids: string[] }` (`MarkNotificationsReadRequestSchema`); a misnamed key used to become `markRead(userId, [])` — a 200 no-op that never cleared the badge.

  **Dispatcher automation routes now validate their bodies** (no catalog schema; hand-written guards):

  - `POST /automation` and `PUT /automation/:name` require a flow-definition object, and POST requires a non-empty `name` — a mistyped `name` used to register the flow under the key `undefined` and echo 200.
  - `POST /automation/:name/toggle` is strictly `{ enabled?: boolean }` — `{"enable": false}` (one letter off) used to ENABLE the flow and answer 200 `{enabled: true}`; it is now a 400 naming the offending key. An empty body still means enable.

  **`QuerySchema` now declares the search contract ADR-0061 actually serves** (additive): `search` accepts the canonical bare query string as well as the structured `FullTextSearch` form, and the server-validated `searchFields` narrowing is formally declared. Previously the schema declared only the object form while every surface (and the ADR's own conformance proof) sent the string — drift that surfaced the moment request bodies started being validated.

  **Catalog corrections in `@objectstack/spec` (`plugin-rest-api.zod.ts`)** — documentation-only tables:

  - `DEFAULT_NOTIFICATION_ROUTES` drops the four device/preferences endpoints — those server routes were removed in #3612 (never built), yet the table kept declaring them, `requestSchema` and all.
  - `DEFAULT_AUTOMATION_ROUTES`' trigger endpoint path is corrected `/trigger` → `/trigger/:name` (the mounted path; the flow name rides the path) and its `AutomationTriggerRequestSchema` declaration is removed — that schema never described this route's wire shape.
  - `DEFAULT_DATA_CRUD_ROUTES` gains the `POST /:object/query` entry (mounted since forever, previously undeclared), repoints create/update to the schemas the routes actually validate (`CreateDataRequestSchema` / `UpdateDataRequestSchema` — the old `CreateRequestSchema`/`UpdateRequestSchema` names described a `{ data }` envelope the wire never had), and drops `requestSchema` from GET/DELETE entries (path/query-bound inputs; nothing can violate them as a body).
  - New gates: catalog `requestSchema`/`responseSchema` strings must resolve to real exported Zod schemas, `requestSchema` may only sit on body-carrying methods, and every declared `requestSchema` on a mounted route has a violating-body → 400 conformance case (`packages/rest` + `packages/runtime` request-schema-gate suites).

  Migration: clients that already send the documented shapes are unaffected. If you relied on a malformed body being silently accepted (e.g. posting `{ records: [...] }` to `createMany`, a non-boolean `enabled` to toggle, or an off-schema analytics/query body), fix the request to the declared shape — the 400's `fields[]` names each offending key.

### Patch Changes

- 8d895ff: feat(spec,objectql,rest): publish the audit-provenance and import-coercion vocabularies (#3786, #4173)

  Two more hand-copied lists retired the same way, each replaced by one spec
  export and derivation at every consumer.

  **`AUDIT_PROVENANCE_FIELDS`** (`@objectstack/spec/data`, with the
  `AuditProvenanceField` type) — the four columns `applySystemFields` injects on
  every audit-tracked object: `created_at`, `created_by`, `updated_at`,
  `updated_by`. That four-name list existed in at least four copies across two
  repos: the registry's injection if-chain, the rule-validator's `preserveAudit`
  allowlist ("Kept in sync with the registry's auto-injected audit fields" — by
  nothing), and two objectui render surfaces. Now:

  - the registry's injection is table-driven, keyed by the tuple with a
    `satisfies Record<AuditProvenanceField, …>` clause — a name added to the spec
    without a column definition (or vice versa) is a compile error, the
    `APPROVER_VALUE_BINDINGS` discipline;
  - the rule-validator's `AUDIT_TIMELINE_FIELDS` derives from the same tuple;
  - `FIELD_GROUP_SYSTEM_FIELDS`' audit prefix derives from it too — one
    declaration even inside the file that hosts both;
  - objectui's `AUDIT_FIELD_BY_ROLE` already pins itself by subset assertion and
    can import the tuple directly once this release is published.

  Injection behaviour is byte-identical — a conformance test pins every injected
  column's shape against the pre-refactor definitions.

  **`IMPORT_BOOLEAN_TRUE_TOKENS` / `IMPORT_BOOLEAN_FALSE_TOKENS` /
  `IMPORT_REFERENCE_TYPES`** (`@objectstack/spec/data`) — the `/import` coercion
  vocabulary #4173 asked for. The server's `import-coerce.ts` now derives its
  `BOOL_TRUE` / `BOOL_FALSE` / `REFERENCE_TYPES` from these instead of owning
  them privately, and objectui's Import Wizard preview — which re-checks the same
  contract client-side so a cell is flagged red exactly when the server would
  reject it — can retire its pinned-inventory mirror once this release is
  published (the retirement path is written in that file's own header).
  `IMPORT_REFERENCE_TYPES` ships with the legacy `'reference'` spelling included,
  retiring the `+ 'reference'` literal both ends carried separately. The tables'
  own discipline is tested: sets disjoint, every token pre-normalized
  (lower-case, trimmed), and the Chinese / check-mark spreadsheet-reality tokens
  pinned by name.

  No behaviour change anywhere: every derived value is byte-identical to the
  literal it replaces.

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

- fae74b5: fix(rest): give the bare 501 error exits a machine `code` (#4067)

  Most REST error exits already carry a typed `code` (`VALIDATION_FAILED`,
  `BATCH_NOT_ATOMIC`, `BATCH_TOO_LARGE`, `PERMISSION_DENIED`), and the clone /
  search 501s already answer `{ error, code: 'NOT_IMPLEMENTED' }`. Four 501 exits
  still returned a bare `{ error: '<string>' }` with no code, so a client could
  only key on the prose:

  - the cross-object transactional batch route (`POST {basePath}/batch`) when the
    runtime has no `transaction()` — the last untyped exit on that route, whose
    siblings (`BATCH_NOT_ATOMIC`, `VALIDATION_FAILED`, the `enforceBatchSize`
    `BATCH_TOO_LARGE`) were already typed by the #3897 / #3933 / #3939 line;
  - the two `saveMetaItem`-unsupported exits;
  - the UI-view-resolution-unsupported exit.

  Each now carries `code: 'NOT_IMPLEMENTED'`, matching the clone / search 501s.
  Additive only — the `error` message is unchanged and no status changes — so
  existing clients are unaffected; new ones can branch on the code.

- 366105c: fix(service-datasource,rest): the last three uncovered datasource routes answer their registered refusal code (#4264)

  #4249 (fixed in #4263) gave the rest surface's two introspection routes a
  failure contract; this closes the same gap on the three sibling routes it left
  uncovered. Each had no `catch` around its service call, so a service throw was
  swallowed by the adapter and surfaced as the pre-#3675 non-envelope
  `500 { error: 'No response from handler' }` — no `success` flag, no
  `error.message`, no code to switch on, real cause lost.

  Wire-visible changes — each route now answers `400` in the declared envelope,
  under the refusal code registered (ADR-0112) for the service it dispatches to,
  with the service's own message at `error.message`:

  - `GET /api/v1/datasources` (`listDatasources` throw) →
    `400 DATASOURCE_ADMIN_ERROR` — matching its eight siblings in
    `service-datasource/admin-routes.ts`, which already answer their catches this
    way.
  - `POST /api/v1/datasources/:name/external/refresh-catalog` (`refreshCatalog`
    throw) and `POST /api/v1/datasources/:name/external/validate` (`validateAll`
    throw) → `400 EXTERNAL_DATASOURCE_ERROR` — the same code #4249 gave the two
    introspection routes one block above them.

  The issue left the code choice open (`INTERNAL_ERROR` was the alternative);
  the registered per-service codes win on consistency: every other catch in both
  modules — including pure reads — already answers 400 with the service-attributed
  code, and `refreshCatalog`'s dominant throw class (unknown datasource,
  unreachable remote, no such schema) is the one #4249 already adjudicated as a
  400 refusal on `listRemoteTables`. A 500 here would fork the failure contract
  within a module — the drift #4249 removed.

  No new codes: both were registered in the error-code ledger by #4263. The
  envelope-conformance suites and the `REFUSALS` pin table gain one row per
  route.

- f0d6594: fix(rest): `GET /data/:object/export` honours a `search` term

  The streaming export route accepted `filter` and `orderby` but had no way to
  carry the term a user had typed into the list's search box. So exporting after
  a search downloaded the **unsearched superset** — more rows than the screen
  showed, in a file that looks authoritative, with nothing indicating the
  difference. The route's own comment claimed the opposite: that it "mirrors the
  active view's filter + sort so the exported file matches what the user sees".

  Same family as a dropped filter (objectstack#3948, objectstack#4181): a
  plausible answer that is quietly broader than the one asked for.

  Two new query params, both matching the list endpoint's semantics:

  - `search=<term>` — folded into `findData` as `$search`, so it **composes**
    with `filter` (`{ $and: [filter, search] }`) rather than replacing it. Empty
    or whitespace-only terms are ignored rather than applied as a blank predicate.
  - `searchFields=a,b` — the ADR-0061 override for which fields the term scans.
    Only meaningful alongside `search`, and intersected with the object's allowed
    searchable set by the engine, exactly as on the list endpoint.

  Unknown query params on this route were already ignored, so a client that sends
  `search` to an older server gets today's behaviour rather than an error.

  Covered by `export-integration.test.ts` against the real engine + protocol: the
  composition case is built so each half alone returns a different non-empty
  result and only "both applied" returns none. Reverting the route change fails 4
  of the tests. The file's in-memory driver also learned `$or` / `$contains` —
  without them a search predicate is a silent no-op and an "it filtered"
  assertion would pass for the wrong reason.

- bcf1112: fix(service-datasource,rest)!: external-datasource refusals answer their own error code (#4249)

  #4225 / #4234 fixed the 503 `message` on the three routes in
  `service-datasource/admin-routes.ts` that dispatch to `external-datasource`
  rather than `datasource-admin`. The identical mis-attribution survived one field
  over, on the 400 path — and machine-readably: one shared `badRequest` helper
  hard-coded `DATASOURCE_ADMIN_ERROR`, which the ADR-0112 ledger defines as a
  refusal _from the datasource-admin service_. So a `no such schema` raised by the
  external-datasource introspector was reported as datasource-admin's, and where
  #4225 misled a human reading prose, this misrouted a client switching on
  `error.code`.

  `EXTERNAL_DATASOURCE_ERROR` is now registered in the error-code ledger — under
  `@objectstack/service-datasource` and `@objectstack/rest`, the two packages that
  emit it; per the ledger's own rule the per-package rows are provenance, not
  identity — and `badRequest` takes the same `ServiceName` the route passed to
  `resolve` (#4234), so the code, like the 503 message, comes from the service the
  route actually dispatches to.

  Wire-visible changes:

  - **The three external-datasource routes' 400 `error.code`** —
    `GET /datasources/:name/remote-tables`, `POST /datasources/:name/test`,
    `POST /datasources/:name/object-draft` — is now `EXTERNAL_DATASOURCE_ERROR`
    (was `DATASOURCE_ADMIN_ERROR`). Status, envelope, and `error.message` are
    unchanged, as is everything on the six datasource-admin routes. No consumer
    branches on the old code (grepped both repos, all the ADR-0112 sweep forms).
  - **The rest surface's two introspection routes now have a failure contract at
    all.** `GET /datasources/:name/external/tables` and
    `POST /datasources/:name/external/tables/:remote/draft` carried no
    `try`/`catch`, so the very same service operations that answer 400 through
    the admin surface surfaced here as the adapter's non-envelope
    `500 { error: 'No response from handler' }`. They now answer
    `400 EXTERNAL_DATASOURCE_ERROR` in the declared envelope — one operation, one
    failure contract, on both paths. (`EXTERNAL_IMPORT_ERROR` on the import route
    is unchanged: a refused import is a different act from a failed
    introspection, and its name says so.)

  Why a new registered code rather than reusing one: ADR-0112's ledger asks
  _generic_ conditions to reuse the standard catalog — that argument carried
  #4225's 503, where `SERVICE_UNAVAILABLE` is correct for all nine routes and only
  the free-text `message` named the service. A refusal specific to one service is
  exactly what registered extension codes are for, and the closed `ErrorCode`
  union means correcting the attribution had to be a ledger edit. Widening
  `EXTERNAL_IMPORT_ERROR` to cover introspection was rejected because these are
  not imports; leaving the throws uncaught was rejected because the adapter's 500
  is not the declared envelope.

  The conformance rows that pinned the drift move with it, and each surface now
  pins the refusal code per route the way #4234 pinned the 503 message per route.

  Pre-existing, like #4225: #3843 carried every code string over verbatim.

- 99b4392: Advertise `mcp` in `/discovery` only when it is actually serveable (#4024).

  Both discovery producers gated the `/mcp` route on `isMcpServerEnabled()` alone.
  The stated justification was a lockstep — `os serve` auto-loads plugin-mcp from
  the same flag, so on that path advertised did imply mounted. But the lockstep is
  a property of the CLI, not of the dispatcher: `@objectstack/rest` has no
  `@objectstack/mcp` dependency, mounts no `/mcp` route and performs no auto-load,
  so a host that embedded it without plugin-mcp advertised `/mcp` in `/discovery`
  and then answered 501 on it — the `declared ≠ enforced` failure #3369 forbids,
  and a broken contract for third-party clients that read `/discovery` to decide
  what exists.

  Both producers now require the flag AND a serveable MCP service. The runtime
  dispatcher gates on the handler's own predicate (`typeof
mcp.handleHttpRequest === 'function'`), so a wrong-shaped service can't
  over-promise either. `@objectstack/rest` probes via the per-request kernel or the
  single-env `serviceExistsProvider`; when it genuinely cannot probe it keeps the
  prior flag-only answer rather than hiding a working endpoint (fail-open,
  ADR-0057 D10). The `os serve` / `os dev` path is unchanged — it loads the plugin,
  so the service resolves and `/mcp` is still advertised.

  Also exercises the `mcp: false` seam in `route-parity.integration.test.ts`, which
  had existed unused since the file was written: `bootServe()` was only ever called
  with no args or `{ notification: false }`. The one capability whose advertisement
  was not service-presence gated was also the one whose absence was never tested.

- 495019b: fix(rest): the /meta per-type gates are enforced on both spellings of the type segment (#3984)

  Every per-type filter on `GET /meta/:type` and `GET /meta/:type/:name` compared
  `req.params.type` to a literal SINGULAR name, while the protocol's `getMetaItems`
  normalizes singular↔plural and serves either. Prime Directive #3 makes plural the
  canonical REST spelling, so the form a client is most likely to use —
  `/api/v1/meta/books` — reached the handler with every gate skipped.

  Three of those gates are authorization:

  - **ADR-0046 §6.7 book / doc audience** (three sites: the list, the single-item
    read, and the doc effective-audience union). `GET /meta/books` returned a
    `{ permissionSet }`-gated book — an _Admin Guide_ — to a caller who does not
    hold the set, and `GET /meta/books/admin_guide` answered `200` where the
    singular spelling answers `401`. On a publicly-served deployment the same skip
    handed an `org` book to an anonymous reader.
  - **App RBAC filter** — hides privileged apps (Studio, Setup) and gated nav
    entries from callers without the grants. `GET /meta/apps` skipped it.
  - **Dashboard `requiresService` gate** (ADR-0057 D10). `GET /meta/dashboards`
    skipped it.

  The remaining spelling-sensitive branches are behavioural rather than
  authorization — doc i18n locale collapse, and the list-response `content` strip —
  and were inconsistent between the two spellings for the same reason.

  Each handler now normalizes the type ONCE (`RestServer.metaTypeSingular`, backed
  by the same `PLURAL_TO_SINGULAR` table the protocol uses) and every gate keys on
  that value, so the two spellings of one route can no longer diverge. Found while
  scoping #3963.

- 20bc1ec: fix(spec,rest): the metadata forms save what they show — form ↔ Zod reconciliation (#3786)

  Every entry in `METADATA_FORM_REGISTRY` is a hand-written `defineForm` layout
  that names keys of a Zod schema it never imports: two descriptions of one key
  set, a comment asking the next author to keep them in step, and nothing that
  fails when they don't. #3786 asked for a sweep of that shape across the repo.
  **Four of the seventeen forms had already drifted, every one of them silently.**

  The silence is the point. `ObjectSchema` / `FieldSchema` are deliberately not
  `.strict()`, so a key the schema does not declare parses clean and is stripped
  on the way to storage — the same ADR-0104 failure class the `field.zod.ts`
  prune tombstone already describes in prose. An admin toggled a switch in
  Studio, got no error, and the value never landed.

  **What was broken, from an author's seat:**

  - **Object → Capabilities.** The block bound to `capabilities`; the
    `ObjectSchema` key is `enable`. All seven toggles (Track history, Searchable,
    API enabled, Files, Feeds, Activities, Clone) saved nothing.
  - **Object → Fields.** The inline column grid offered 16 keys `FieldSchema` has
    never declared. `PII`, `Encrypted`, `Indexed`, `Immutable`, `Filterable`,
    `Placeholder`, `Validation`/`Error message` and `Starting number` were
    controls with no storage behind them at all; the rest named keys the schema
    had **renamed** and the form never followed:
    `referenceFilter` → `lookupFilters`, `cascadeDelete` → `deleteBehavior`
    (a three-way enum, not a boolean), `formula` → `expression`,
    `displayFormat` → `autonumberFormat`, and the flat `summaryType` /
    `summaryField` pair → the single `summaryOperations` object, which also
    restores the `object` key the flat pair had no slot for. Roll-ups authored in
    that grid saved nothing.
  - **Report → Advanced.** `aria` and `performance` were pruned from
    `ReportSchema` by #3496; the form kept rendering both.
  - **Hook / Action → Body.** `memoryMb` was unauthorable — named in
    `hook.form.ts`'s own doc comment, absent from the list beneath it.
  - **Page → Interface.** `interfaceConfig.sort` was unauthorable, so a page's
    default sort order could not be set in Studio at all.

  **No authored metadata changes and nothing you can write is removed.** These
  were UI controls that never persisted; every corrected key is one `FieldSchema`
  / `ObjectSchema` already accepted. Metadata authored in YAML/TS was always
  validated against the real schema and is unaffected. If you had been filling
  those Studio controls expecting them to stick, they now either work (the
  renamed five) or are gone rather than lying to you.

  The metadata-form translation bundles are derived from the registry, so all
  four locales are regenerated. Worth naming what they contained: translated
  labels, in four languages, for switches that saved nothing — the drift had
  propagated into a generated artifact and been dutifully translated there.

  **The mechanism.** `metadata-form-zod-reconciliation.test.ts` walks every
  registered form and reconciles it against `getMetadataTypeSchema()`. The two
  directions are deliberately asymmetric: **form-only** (a control whose value is
  discarded) is always a defect and cannot be excused, because no design wants
  one; **zod-only** is ledgerable with a reason, for a deprecated key held back
  from new authoring or a curated quick-add subset that defers to a fuller
  editor. Ledger entries are checked for non-vacuity and for still resolving on
  both sides, per the #4045 / #4040 discipline. Verified by mutation — re-adding
  a stripped key, dropping a covered key, and offering a ledgered omission each
  turn the gate red.

  **New export: `TRANSLATABLE_METADATA_TYPES`** (`@objectstack/spec/system`), the
  set of metadata types whose labels `translateMetadataDocument` localizes,
  derived from its dispatch table rather than restated. `@objectstack/rest` had
  been carrying a hand-copied literal set under a "keep in sync with the type
  dispatch" comment; it now reads this instead. Registering a translator in spec
  reaches the REST boundary with nothing else to remember — the second list is
  deleted rather than checked, which is the better half of derive-or-gate.

  Also corrected: `ActionAiCategorySchema`'s comment claimed it mirrored
  `ToolCategorySchema` in `ai/tool.zod` and told the next author to update both
  sides — but #3896 deleted `ToolCategorySchema` along with the inert
  `tool.category` key it typed. The instruction had been pointing at a source
  that no longer exists. The enum is canonical now and says so.

- 6c87cc9: fix(data): a filter the server cannot apply is rejected, not silently ignored (#4181)

  `GET /api/v1/data/:object?filter={status:done` — one missing quote — answered
  `200` with the **unfiltered** page. The JSON-parse tolerance
  (`catch { /* keep as-is */ }`) left the raw string on `where`, a shape no
  driver consumes, so the filter was dropped whole and the response was
  byte-for-byte a successful unfiltered query. The worst failure direction in
  this family: #4134 returned nothing, #4164 dropped one predicate, this
  returned everything.

  The sibling `GET /data/:object/export` route had rejected the same input since
  it was written — the list path was the outlier. That guard now lives in the
  shared normalizer, so `GET /data/:object`, `POST /data/:object/query` and the
  runtime dispatcher all give one answer:

  - Unparseable JSON → `400 INVALID_FILTER`, naming the parameter and stating the
    filter was not applied.
  - Parses but is not a filter (`?filter=5`, `?filter="done"`, `?filter=null`) →
    same rejection; usable JSON is not a usable filter.
  - Blank `?filter=` → treated as absent, as before. No error.
  - `filter` / `filters` / `$filter` / `where` are four spellings of ONE slot.
    Sending two with **different** values used to run one and discard the rest
    silently; it is now `400 INVALID_REQUEST` (each value is a valid filter — the
    _request_ is ambiguous, so it does not share the malformed-filter code).
    Redundant identical spellings pass.
  - `orderby` on the export route gets the same treatment — a sort that cannot be
    parsed is refused rather than dropped (lower stakes than a filter: the row set
    is unchanged, but a caller taking "latest N" got an arbitrary N).

  **One wire code for one condition.** #4121 landed `400 INVALID_FILTER` for
  malformed filter _arrays_ on this same code path while this fix was in flight;
  the non-array rejections above use that code too, so a caller asking "did my
  filter run?" never has to know which branch caught it. The export route's
  filter guard moves from `INVALID_REQUEST` to `INVALID_FILTER` to match — a wire
  change on an existing route, and the reason it is worth making is that a client
  otherwise has to handle two codes for one condition depending on which URL it
  called. The route's `orderby` guard keeps `INVALID_REQUEST` (it is not a
  filter).

  **What changes for callers:** requests carrying a malformed filter now fail
  loudly instead of receiving every record. Every valid filter shape — JSON
  string, live object, `FilterCondition` AST array, and all four alias spellings
  used alone — is unaffected.

- af2a095: fix(data): `searchFields` / `groupBy` / `aggregations` naming a field that does not exist are rejected, not silently degraded (#4254)

  #4226 closed `sort` / `select` / `expand`; with the filter axis (#4134 / #4164 /
  #4181 / #4121) that made four field-naming read axes that either apply or fail.
  The same machine kept leaking on the remaining three, and each failure corrupted
  something the closed axes never touched:

  ```
  search=alpha&searchFields=no_such  -> 200  MORE rows than the narrowing allowed
  groupBy=[no_such]                  -> 200  [{no_such: null, n: <true count>}]  N groups collapsed into 1
  sum(no_such)                       -> 200  0 — indistinguishable from a real zero
  ```

  Each is now refused at the shared normalizer, so `GET /data/:object`,
  `POST /data/:object/query`, the export route and the runtime dispatcher give
  one answer instead of four.

  - **`searchFields` → `400 INVALID_FIELD`.** The `select` failure with the sign
    flipped outward: the engine dropped unknown names and, when that emptied the
    override, fell back to the FULL searchable set — so a parameter that exists
    only to narrow a search widened it, and it changed which ROWS came back, not
    just which columns. Its only in-framework caller is `GET /data/:object/export`
    — the route whose `search` support just shipped so exports would stop
    downloading "the unsearched superset … in a file that looks authoritative";
    a typo'd `searchFields` did exactly that, one parameter over. Three causes,
    three messages, because the fixes differ (the split #4226 drew on expand): a
    name that is no field is a request typo; a REAL field outside the searchable
    set needs the object changed (its message names the declared
    `searchableFields` or the auto-default's type rule, whichever applies); and
    a `searchableFields` entry that names no field is a STALE DECLARATION — a
    bug on the object, called out as such because clients (objectui's list
    search) echo the declaration verbatim. The allowed set is resolved by the
    same `@objectstack/spec/data` function the engine's search expansion
    consumes (`resolveSearchFieldResolution`, moved from objectql), so the gate
    cannot drift from what search actually scans.
  - **`groupBy` → `400 INVALID_FIELD`.** The in-memory aggregation path projects
    an unknown column as `null` for every row, so all rows landed in ONE bucket
    whose count is the true row count — structurally perfect, identical to "this
    column really holds a single value". A chart draws one bar; nothing says the
    grouping never ran. Native SQL aggregation errors on the same input, so which
    backend a deployment sits on decided the answer — the "two routes, opposite
    answers" split, one axis over.
  - **`aggregations` → `400 INVALID_FIELD`.** `sum(<typo>)` folded a column of
    `undefined` to `0` — the exact number an empty quarter produces, in reports
    whose whole job is to be believed (`avg`/`min`/`max` answered `null` the same
    way). `count` with no `field` (or the `'*'` sentinel) is the one legitimate
    field-less form and passes.
  - **Unreadable SHAPES on the aggregation axes → `400 INVALID_QUERY`** — the
    standard-catalog code that had no emitter since it was written, like
    `INVALID_SORT` before #4226. A string `groupBy`, an entry naming no field, a
    function or `dateGranularity` outside the spec enums, a missing `alias`: each
    slipped past the `Array.isArray` routing guard (rows returned UNGROUPED) or
    computed a silent placeholder (`null` results, a column keyed `"undefined"`,
    one bucket per raw value under an unknown granularity).

  Tiering is unchanged from #4226: registry + field map present → authoritative;
  no registry / no field map / legacy array field map → the NAME gates skip (shape
  gates still apply — they need no schema). The engine's own tolerance is
  untouched: internal callers reaching `engine.find()` / `engine.aggregate()`
  directly are unaffected. `@objectstack/rest` also stops logging
  `INVALID_FILTER` / `INVALID_SORT` / `INVALID_QUERY` rejections as
  "[REST] Unhandled error" — they are client mistakes the response already
  explains, as `INVALID_FIELD` always was.

  Requests that name real fields are unaffected.

- dd5daac: fix(data): reject unknown list query parameters instead of reading them as zero-matching field filters (#4134)

  `GET /api/v1/data/:object` reads any parameter it does not reserve as a
  field-level equality filter — that is what makes `?status=done` shorthand for
  `?filter={"status":"done"}`. When the name matched **no** field the resulting
  predicate could only ever match nothing, so `?pageSize=5` on a 10-row object
  returned `200` + `total: 0`: structurally valid, and indistinguishable from
  "this object is empty". The write path already rejected the same unknown name
  loudly (`400 INVALID_FIELD`), so one piece of knowledge — does this field
  exist — was enforced on write and silently zeroed on read.

  The read path now answers the same way, in the same envelope:

  ```json
  {
    "error": "Unknown field 'pageSize' on object 'showcase_task'. Query parameters that are not reserved are read as field filters, so an unknown name can only match zero records. Did you mean the 'top' query parameter (OData spelling '$top')?",
    "code": "INVALID_FIELD",
    "field": "pageSize",
    "object": "showcase_task"
  }
  ```

  The rejection carries a suggestion — the canonical parameter for a known
  dialect (`pageSize` / `perPage` / `page` / `sortBy` / `q` → `top` / `skip` /
  `sort` / `search`), or the closest real field name when it reads like a typo —
  and fires whether or not an explicit `filter` rode along, so the failure never
  depends on which other parameters were sent.

  **What changes for callers:** a request sending a parameter that names no field
  now gets a `400` where it used to get an empty `200`. Page size is `top` /
  `$top` / `limit`; page offset is `skip` / `$skip` / `offset`. Every documented
  parameter, every `$`-prefixed OData alias, and the full `QueryAST` body of
  `POST /data/:object/query` are unaffected. An object with a field named after a
  reserved parameter (`count`, `cursor`, `object`, `top`, `search`, …) filters it
  through the explicit form: `?filter={"count":3}`.

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

- ccd9397: fix(security)!: a sharing rule with no criteria now shares NOTHING instead of every record (#3896)

  `SharingRuleSchema` has always required `condition`, and its doc is explicit
  that a predicate the compiler cannot lower is _"skipped and logged — never
  seeded as a permissive match-all (ADR-0049)"_. The declared/seed path honoured
  that. The two other ways to create a rule did not:

  - **`POST {basePath}/sharing/rules`** plucks its body field-by-field into
    `SharingRuleService.defineRule`, which validated `name` / `label` / `object` /
    `recipientType` / `recipientId` — and not `criteria`. A missing, `null`, or
    **misspelled** key (`criterias`) was stored as `criteria_json: null`, answered
    `201` with no warning, and evaluated as
    `find(object, { filter: {}, context: SYSTEM_CTX })`: every record of the
    object, up to 5000, granted to the recipient. Triggering it took a typo, not
    an attacker.
  - **Authoring a rule in Setup** is a direct `sys_sharing_rule` insert, which
    never reaches `defineRule` at all.

  Empty criteria is now rejected everywhere a rule can be written, and — because
  rules created before this gate are already in the table — the evaluator refuses
  to act on one regardless of how it got there.

  - **`defineRule` rejects a match-all criteria** with
    `VALIDATION_FAILED: criteria is required …`, alongside its other required
    fields. Covers the REST endpoint, programmatic callers, and the seeder.
    Rejected shapes: missing / `null` / `''` / `{}` / `[]` / `{ $and: [] }` /
    unparsable JSON (e.g. a CEL source typed into the Criteria box).
  - **The evaluator matches nothing** for such a rule and logs why, so a row
    stored before this release under-shares instead of over-sharing: the next
    reconcile _revokes_ the grants it had materialised. Both evaluation paths are
    covered — the bulk `evaluateRule` and the per-record write-hook path.
  - **`bindRuleCriteriaGuard`** fails `sys_sharing_rule` inserts with no
    criteria as a field-level `VALIDATION_FAILED` (a 400 naming `criteria_json`),
    so the Setup path reports the problem instead of saving an inert rule
    (ADR-0078). Updates are checked only when the patch supplies
    `criteria_json` — switching an over-broad legacy rule off must not require
    inventing a criteria for it first.
  - **The seed bootstrap's "empty condition = match-all" branch is gone**: a
    missing or empty `condition` is now skipped and logged like any other
    non-lowerable one.
  - `POST {basePath}/sharing/rules` also accepts `criteria_json` as an alias for
    `criteria`, matching the snake_case aliases the endpoint already takes for
    `object_name` / `recipient_type` / `access_level`.

  **Migration.** There is no "share every record" sharing rule, and there never
  usefully was one — the shape existed only as a failure mode. A rule that
  relied on it must state its predicate (`criteria: { stage: 'won' }`), or, if
  the object really should be readable by everyone, use the object's
  organization-wide default (`sharingModel`) instead. Rules already stored with
  a null `criteria_json` need no data migration: they stop granting on the next
  evaluation and their existing grants are revoked.

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
  - @objectstack/observability@17.0.0-rc.1
  - @objectstack/service-package@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- ad4af62: feat: single-source API-method derivation — the server is the only adjudicator (#3391)

  An object's effective API surface is now resolved from **six primitives**
  (`get/list/create/update/delete/bulk`) by ONE derivation table in
  `@objectstack/spec/data` (`resolveEffectiveApiMethods` / `isApiOperationAllowed`
  / `effectiveOperationsArray` / `API_METHOD_DERIVATION`). Every gate consumes it:
  the REST data surface, the runtime HTTP/MCP dispatcher, and the
  `/me/permissions` annotation. The `apiMethods` whitelist is three-state —
  `undefined` = unrestricted, `[]` = deny-all, a subset = the derived closure — and
  the legacy 8 verbs (`upsert/aggregate/history/search/restore/purge/import/
export`) are DERIVED from the primitives, never declared standalone. (This
  release also ships the enum shrink — see the `#3543` changeset: the authored
  enum IS the six primitives, and a stored legacy value is stripped at parse
  with a warning rather than honored.)

  **Derivation:** `import` ⊆ create∨update (writeMode-precise: insert→create,
  update→update, upsert→create∧update); `export` ⊆ list (reserved user-export slot,
  always on this phase); `aggregate`/`search` ⊆ list (search also needs
  `searchable`); `history` ⊆ get ∧ `trackHistory`; `upsert` ⊆ create∧update;
  bulk sub-ops ⊆ bulk ∧ derived(child). `restore`/`purge` do not derive (the
  `enable.trash` flag was retired, #2377).

  **New response-side contract:** `EffectiveObjectPermissionSchema` extends
  `ObjectPermissionSchema` with an optional `apiOperations` array;
  `GetEffectivePermissionsResponse.objects` uses it, and `/me/permissions` now
  hands down the per-object effective operation set. The authoring
  `ObjectPermissionSchema` is deliberately NOT extended — the frontend consumes
  the effective set the server resolves, never the raw whitelist.

  **Behavior changes (tightening — a `declared ≠ enforced` gap closed):**

  1. `apiMethods: []` + `apiEnabled: true` now denies every operation (405),
     matching the documented three-state contract instead of the prior fail-open
     "no restriction". In-repo impact is zero (every `[]` object also sets
     `apiEnabled: false`, so 404 precedes 405).
  2. The runtime dispatcher / MCP whitelist is now live. It previously read the
     flat shape while `getObject()` returns the flags nested under `.enable`, so
     the gate never fired — a silent dead gate now enforced (nested-first,
     flat-compatible).
  3. `import`/`export` reverse-derive: an object with a plain CRUD whitelist (no
     explicit `import`/`export`) now admits import (⊆ create∨update) and export
     (⊆ list). Row-level FLS is shared with list; the export column header is now
     projected to the FLS-readable set so it can never expose a wider column set
     than list (previously a masked column leaked its name as an empty column).
  4. The bulk surfaces (`createMany`/`updateMany`/`deleteMany`, per-object
     `/batch`, cross-object `/batch`) now require the `bulk` primitive AND the
     child write (`bulk ∧ child`). The four in-repo explicit-whitelist objects
     (`sys_user`, `sys_user_preference`, `sys_business_unit`,
     `sys_business_unit_member`) gained `bulk`; a third-party object with an
     explicit write whitelist that omits `bulk` will now 405 on the Many/batch
     routes.
  5. The 405 body's `allowed` array is now the derived EFFECTIVE operation set
     (enum-ordered), not the raw whitelist.

- 5f9a987: fix(rest): a batch create goes through the same create ingress as a single create (#3835)

  `readonly` meant two different things depending on which create endpoint you
  used. `POST /data/:object` runs the #3043 ingress strip, so a non-system caller
  cannot seed a read-only column — the field is dropped and reported. The
  cross-object transactional batch (`POST /batch`) called `ql.insert` directly and
  skipped that ingress entirely, and the engine's INSERT path is
  static-`readonly`-exempt **by design** (#3413, the strip lives one layer up), so
  nothing enforced it: the same forged `readonly` value that was rejected on one
  route was written through on the other.

  Measured on the showcase (`showcase_contact.lead_score`, `readonly: true`, same
  signed-in non-system user):

  |                               | before                                 | after            |
  | ----------------------------- | -------------------------------------- | ---------------- |
  | `POST /data/showcase_contact` | `lead_score = null`, reported          | unchanged        |
  | `POST /batch` create          | **`lead_score = 999` written, silent** | `null`, reported |

  The fix routes the batch's create ops through the protocol's `createData` rather
  than re-implementing the strip at the REST layer. That keeps **one** create
  ingress: a future change to its policy covers the batch for free, and the
  carve-outs already encoded there stay intact — notably the platform-object
  exemption (a `sys_`/`managedBy` object's own guard must _reject_ a forged value
  with 403, not have it silently swallowed) and the `isSystem` exemption. The
  context passed through is the transaction context, so the insert still joins the
  batch transaction and rolls back with it, and `{ $ref: <opIndex> }` resolution is
  unaffected.

  `createData`'s `droppedFields` are folded into the batch response's per-op
  `droppedFields` list (#3794), so a batch create now reports its strips the same
  way an update does.

  Update ops are untouched: the engine enforces `readonly` and `readonlyWhen` on
  its own update path.

- 5f9a987: fix(rest): report `droppedFields` from the cross-object batch, so a silent strip stops reading as a clean save (#3794)

  The engine strips writes to `readonly` (#2948) and `readonlyWhen`-locked (#3042)
  fields and completes the write without them. Every write path already reported
  which fields it dropped (#3431/#3455) — except the cross-object transactional
  batch, which never wired `onFieldsDropped` at all.

  That path is the Console record form's save for a master-detail record, so it is
  exactly where a _user_ edits a `readonlyWhen` field: they changed it, the form
  said "updated successfully", the value never moved, and nothing anywhere said
  so.

  `POST /batch` responses now carry a top-level `droppedFields` list, each event
  tagged with the `index` of the operation that produced it (`results` entries are
  bare record echoes, with no envelope to hang a per-row list on). Omitted
  entirely when nothing was dropped, so the shape stays backward-compatible; the
  batch still commits either way — a strip is legal semantics, not an error.

  The Console half ships in objectui: the write-warning toast now fires on batch
  saves too.

- 3949a43: fix(metadata-protocol,rest): the data path really 404s unknown objects now (#3770)

  The REST API-exposure gate (`enforceApiAccess`) passes through any object it
  cannot find in metadata, and the comment there justified that with
  `// unknown object → let the data path 404`. That fallback did not exist.

  - `findData` — and every other data entry point except `cloneData` — had **no
    existence check**. The repo's only `OBJECT_NOT_FOUND` throw was in `cloneData`.
  - The engine does not reject unregistered names either: `resolveObjectName`
    falls back to `StorageNameMapping.resolveTableName({ name })`, so the object
    name is used **as the table name**.
  - The 404 was therefore only ever a side effect of the **driver** erroring on a
    missing table, which the REST layer recognised by matching the driver's error
    string.

  So the 404 held only when the table happened not to exist. When a physical table
  with that name **did** exist — out-of-band DDL, a registration that failed after
  `syncObjectSchema` had already run, a registration race — the exposure gate was
  silently skipped and the rows were served, with no layer turning it into a 404.
  (Since #3545 an authenticated caller on a plugin-security deployment is refused
  by the fail-closed posture check; anonymous callers and deployments without
  plugin-security were not.)

  **The gate.** `ObjectStackProtocolImplementation` now runs a shared
  `assertObjectRegistered` before storage is touched, on `findData`, `getData`,
  `createData`, `cloneData`, `updateData`, `deleteData`, `batchData`,
  `createManyData`, `insertManyData`, `updateManyData`, `deleteManyData` and
  `analyticsQuery`. An object absent from the schema registry is rejected with
  `OBJECT_NOT_FOUND` / 404 — an authoritative answer from the registry, raised
  _before_ the name becomes a table name, instead of an inference from driver
  prose. `cloneData`'s open-coded check is now that shared gate; its envelope is
  unchanged.

  It sits at the protocol ingress, the same boundary `apiEnabled` guards: internal
  callers (hooks, flows, migrations, raw ObjectQL) go to the engine directly and
  are unaffected. When the engine exposes no schema registry at all there is
  nothing to consult, so the gate stands down and warns once per process —
  matching the tiering #3545 recorded in `api-exposure.ts` for a whole-registry
  outage.

  **Behaviour change.** A REST data request for an object that is not in the
  schema registry now returns `404 object_not_found` even when a table of that
  name exists. Previously it returned that table's rows. If a deployment depended
  on reading a table with no registered object, register the object (its schema is
  what every other layer — exposure, RBAC/FLS/RLS, field projection — already
  needs in order to enforce anything at all).

  **One wire code.** `mapDataError` maps the protocol's `OBJECT_NOT_FOUND` to the
  canonical `object_not_found` `ApiErrorCode` — byte-identical to the envelope the
  driver-string branch already produced — so a client keying on `code` sees _what
  happened_, not _which layer noticed_. The driver-string branch stays as the
  safety net for the other failure it actually covers: an object that IS registered
  but whose physical table is missing. Callers that were reading `cloneData`'s 404
  as `code: 'OBJECT_NOT_FOUND'` on the wire now get `object_not_found`; the status
  is 404 either way.

  The misleading comment is replaced with what actually closes the hole — this
  gate for existence, plugin-security's `unresolved` posture (#3545) for
  authorization — and a note not to widen the exposure gate on the assumption that
  some other layer 404s.

- 7c7e246: feat(authz): expose the caller's delegable scope — the read half of the
  delegated-administration gate (ADR-0090 D12 / ADR-0105 D8)

  `adminScope` decided writes but could not be READ: `assignablePermissionSets`
  lived only inside `delegated-admin-gate.ts`, so a UI offering "place this
  person in a unit, with these positions" (the D8 scoped-invitation form) had no
  way to narrow its pickers. It would list the whole tree and let the user
  discover the boundary by being refused — which turns an authorization gate into
  a validator and makes the boundary invisible until it bites.

  `ISecurityService.describeDelegableScope(callerContext)` answers it, exposed as
  `GET /api/v1/security/my-delegable-scope` and `client.security.describeDelegableScope()`:

  - `placeableBusinessUnitIds` — union of the subtrees where the caller may place
    people (scopes granting `manageAssignments`);
  - `assignablePositions` — positions whose every distributed permission set the
    caller may hand out (containment check included);
  - `scopes` — the held `adminScope`s with subtrees resolved, for attribution;
  - `isTenantAdmin` — unconstrained, with everything enumerated so a consumer
    renders ONE uniform picker instead of special-casing.

  Computed by the same helpers the write gate enforces with, so an option this
  reports is one `assert()` accepts — a test asserts that agreement directly. It
  NARROWS; the gate still decides.

  Strictly self-scoped: no target-user parameter, so it discloses nothing beyond
  the authority the caller already holds (unlike `explain`, which has one and
  gates it). Fail-closed — unresolvable scopes contribute nothing, a caller with
  no delegated authority gets empty lists, and a deployment without
  `@objectstack/plugin-security` gets 501.

- 9613396: feat(security): ENFORCE the user-level export axis on the server (#3544)

  `allowExport` landed as a spec bit plus a `/me/permissions` annotation, which
  hid the client's Export button — and nothing else. Because `export ⊆ list`, the
  REST export route streams through `findData` and the engine middleware sees an
  ordinary `find` gated by `allowRead`, so no code path ever read the bit: a caller
  holding `allowExport: false` could still `curl
/api/v1/data/:object/export` and drain the whole table. Declared, not enforced.

  - **plugin-security** `PermissionEvaluator.checkObjectPermission('export', …)` is
    now a real decision: `export` = read granted ∧ not explicitly denied.
    `allowExport` stays out of `OPERATION_TO_PERMISSION` on purpose — that map
    means "the bit must be truthy", which would have denied export to every
    permission set authored before the axis existed. The new exported
    `resolveUserExportAllowed()` folds the tri-state across sets (`true` beats
    `false` beats unset) exactly as the `/me/permissions` merge does.
  - **spec** `ISecurityService` gains `canExport(object, context)` — the question a
    bulk-egress door outside the engine middleware has to ask before it reads.
    Fails CLOSED; `isSystem` and an empty set resolution bypass, mirroring the
    middleware.
  - **rest** `GET /data/:object/export` calls it and answers **403
    `EXPORT_NOT_PERMITTED`** before the first chunk is fetched. Distinct from the
    object-level 405 `OBJECT_API_METHOD_NOT_ALLOWED`, which still runs first: 405
    says the object exposes no export, 403 says this caller may not use it. No
    security service (no `plugin-security` ⇒ no permission sets) → allowed, the
    same fail-open posture as every other permission gate in that layer; service
    present but unable to answer → denied.
  - **plugin-hono-server** the `/me/permissions` annotation now falls back to the
    `'*'` entry's export bit when a per-object entry declares none, matching the
    evaluator's own wildcard fallback — so a set that denies export wholesale via
    `'*'` no longer offers a button the server refuses.

  Backward-compatible: `allowExport` is still an opt-out with no default, so an
  unset bit inherits read and existing permission sets behave exactly as before.
  Only a permission set that explicitly sets `allowExport: false` changes — and it
  now changes on the server, which is the point.

  Implementers of `ISecurityService` outside this repo must add `canExport`; the
  interface member is required, matching how `getReadableFields` was added.
  Consumers still feature-detect (`typeof svc.canExport === 'function'`), so a
  partial implementation degrades rather than throwing.

- 2fa4ca1: Dynamic approver routing for approval nodes (#3447 P2) — three new declarative capabilities:

  **`expression` approvers.** A new approver type whose CEL expression resolves WHO approves at node entry, over exactly three roots: `current.*` (the record's live state), `trigger.*` (the submit-time snapshot) and `vars.*` (flow variables, incl. upstream node outputs). `record` and bare field names are rejected before evaluation — on this platform `record` always means "the record at event time", which is ambiguous at an approval node — with error messages that prescribe the correct spelling. The optional `resolveAs: 'user' | 'department' | 'position' | 'team'` re-expands each resolved id through the same graph lookups the static types use; with `behavior: 'per_group'` each intermediate value (e.g. each returned department) forms its own sign-off group. A missing key fails the node loudly; only a present-but-empty result counts as an empty slate.

  **`onEmptyApprovers` policy.** What an empty resolved slate does, node-level, for all approver types: `admin_rescue` (default — request opens for privileged takeover, the #3424 behaviour), `fail` (node fails), or `auto_approve` (skip the request, continue down the `approve` edge with `output.autoApproved = true`). To support auto-approve, the automation engine now honours `NodeExecutionResult.branchLabel` on the synchronous completion path — the field existed but was only ever consumed via resume signals.

  **Decision outputs.** `decide(..., { outputs })` hands structured data from the approver to the flow: the author declares allowed keys on the node (`decisionOutputs`), approvers fill values only, and accepted outputs resume the run as `<nodeId>.<key>` variables — a later approval node's expression can read `vars.<nodeId>.picked_departments`, closing "the previous approver picks the next step's approvers" without a record-field detour. Undeclared keys reject the decision; `decision`/`requestId` are reserved. Multi-approver tallies now always pin to the open-time approver snapshot (previously unanimous re-resolved at each decision against the payload snapshot).

  Also: `collectCelRootIdentifiers` is exported from `@objectstack/formula` (shared by the new `os lint` rules and the runtime pre-check, so they can never drift), resolution inputs are audited on the request snapshot as `__resolvedFrom`, and three new lint rules gate expressions, empty-slate policies and reserved output keys at author time.

- 16adb3c: fix(rest,client)!: reconcile the two REST↔client mismatches the #3587 audit
  ledgered (#3610, #3611)

  **#3610 — `POST /api/v1/packages` publish-vs-install collision.** The REST
  package registrar claimed the bare `POST /packages` for _marketplace publish_
  (`{manifest, metadata}`), while the dispatcher packages domain gives the same
  verb+path _install_ semantics — and REST registers first in the production
  stack (first-match-wins), so every `client.packages.install` call landed on
  the publish handler and 400'd. Marketplace publish moves to
  `POST /api/v1/packages/publish` (breaking for direct callers; a repo-wide and
  objectui-wide sweep found zero). The dispatcher's `POST /packages/:id/publish`
  (ADR-0033 draft publish) is two segments — different shape, no clash. The
  dispatcher already writes both stores on install (`protocol.installPackage`)
  and fully uninstalls on DELETE (`protocol.deletePackage`), so the remaining
  REST GET/GET/DELETE shadows stay — they are compatible.

  **#3611 — UI view dialect split.** `meta.getView` spoke the `?type=` query
  dialect that only the dispatcher `/ui` domain understands; the REST surface
  mounts only the path form `/ui/view/:object/:type`, so the query form 404'd
  wherever REST serves (e.g. project-scoped bases). The client now sends the
  path form both surfaces accept; a URL-pinning test keeps it that way.

  REST route ledger updated: the two `mismatch` rows are resolved (packages
  publish row is `server-only` publisher tooling; the ui row flips to `sdk`).
  The ledger now carries zero mismatches.

- bbd902d: feat(rest): unify request→environment resolution on the host's `kernel-resolver` seam — ADR-0076 D11 step ④ (#2462)

  The REST server kept its own parallel hostname/`X-Environment-Id` resolution
  chain (duplicated inline in three places), while the HTTP dispatcher resolves
  the same question through the host-injected ADR-0006 `kernel-resolver` seam —
  so the same unscoped request could be attributed to different environments
  depending on which HTTP surface served it.

  `RestApiPlugin` now adapts the host's `kernel-resolver` service (registered by
  the cloud runtime next to `env-registry`; no cloud-side change needed) into a
  new `RestRequestEnvResolver` seam, and `resolveRequestEnvironmentId` becomes
  the single entry point every per-environment decision (protocol, i18n,
  exec-ctx) flows through. Where a resolver is wired, its answer — including the
  session-driven fallbacks the REST chain never had — is final; the legacy
  built-in chain remains for OSS single-environment boots (no resolver
  registered) and as the degradation path if the resolver throws.

- 5ac93d4: feat(rest): surface silently-dropped write fields on PATCH/POST /data (#3431)

  #3413 (closes #3407) built the engine-level strip-observability channel
  (`WriteObservabilityOptions.onFieldsDropped`) and wired the flow side
  (`update_record` / `create_record` emit a step warning + `droppedFields`). The
  **REST write path was never wired**, so an external API caller writing N fields
  still got a bare `200 + record` when `readonly` (#2948) / `readonlyWhen` (#3042)
  stripping meant `< N` actually landed — the same silent-success class #3407
  fixed flow-side, just on HTTP. The only way to notice was a per-field diff of
  the returned row (which need not echo every field). This wires the channel
  through the protocol → REST, on both write verbs.

  **Passthrough (metadata-protocol).** `updateData` now registers an
  `onFieldsDropped` collector on `engine.update` and returns the events on the
  response as `droppedFields`. `createData` surfaces the #3043 static-`readonly`
  INGRESS strip too — that strip runs at the protocol ingress
  (`stripReadonlyForInsert`), _before_ the engine, so it is recovered by diffing
  the supplied payload against the stripped one (the engine's `onFieldsDropped` is
  also wired for a future insert-side engine strip). A faulty listener never
  breaks the write — the engine catches and logs.

  **Contract (spec).** `UpdateDataResponseSchema` / `CreateDataResponseSchema`
  gain an **optional** `droppedFields: DroppedFieldsEvent[]` — present only when
  ≥1 field was dropped. Optional + omit-when-empty keeps the response shape
  backward-compatible for clients that only read `record`.

  **REST surface.** PATCH `/data/:object/:id` and POST `/data/:object` echo the
  drops as an `X-ObjectStack-Dropped-Fields` response header
  (`field;reason=<reason>` tokens, comma-joined — e.g.
  `approval_status;reason=readonly`) and keep the structured `droppedFields` on
  the body. **Status/success semantics are unchanged** (200 update / 201 create) —
  a strip is legitimate semantics, not a failure (same principle as #3413). The
  FLS write gate is untouched (it already fails closed with 403).

  Out of scope (issue #3431 D2 open questions, deferred): bulk
  (`updateManyData` / `createManyData` / `batchData`) and GraphQL mutation wiring,
  typed `@objectstack/client` warnings, and adding the header to the Hono CORS
  `exposeHeaders` allow-list for cross-origin browser reads (the body
  `droppedFields` is the cross-origin-safe channel meanwhile).

- d318b24: feat: `security.getReadableFields` query surface for export column projection (#3547, #3391 follow-up)

  The REST export route projected its columns by inferring readability from the
  first chunk of already-masked data rows (#3498). That has two known
  compromises: a readable column whose first-chunk values are all null (and thus
  omitted by the driver) drops out of the header, and an empty result set leaves
  nothing to narrow. This adds the long-term-correct path.

  - **plugin-security** — the `security` service gains
    `getReadableFields(object, context)`. It resolves the caller's permission
    sets and builds the field-permission map with the SAME evaluator +
    `requiredPermissions` fold the read middleware's `FieldMasker` uses (and the
    same on-behalf-of delegator intersection, fail-closed on a dangling
    delegator), then returns every schema field NOT masked non-readable — the
    exact complement of what the mask deletes, so it can never drift from
    data-plane FLS. Computed from schema + context, never from data rows: immune
    to null values and empty result sets. A system context bypasses FLS; an
    unresolvable schema returns `undefined` so callers fall back.
  - **rest** — the `GET /data/:object/export` route asks the environment's
    `security` service for `getReadableFields(object, context)` and projects the
    schema-derived header to that set BEFORE streaming. When no security service
    is reachable (no plugin-security / single-kernel without a provider) it
    degrades to the existing masked-row inference, so there is zero regression.
    Explicit `?fields=` requests are still honored verbatim.

  Contract-neutral: export columns already equal list's readable columns
  (`export ⊆ list`, #3391); this makes the projection authoritative instead of
  inferred.

### Patch Changes

- fa3d0cf: feat(spec): field runtime value-shape contract — ADR-0104 phase 1 (D1)

  `@objectstack/spec/data` now owns the runtime VALUE shape of every field type
  (`field-value.zod.ts`): semantic type classes (`STRING_VALUE_TYPES`,
  `NUMERIC_VALUE_TYPES`, `REFERENCE_VALUE_TYPES`, `FILE_REFERENCE_TYPES`,
  `STRUCTURED_JSON_TYPES`, `MULTI_CAPABLE_TYPES`, …), the shared
  `isMultiValueField`, and `valueSchemaFor(field, 'stored' | 'expanded')`. The
  four consumers that each hand-copied this knowledge (objectql record-validator,
  rest import-coerce, driver-sql column classification, qa conformance) now
  derive from the spec, and the field-zoo round-trip MATRIX is asserted against
  the contract so the two cannot drift.

  **Write-path change (objectql, warn-first):** previously-unvalidated types —
  single `lookup`/`master_detail`/`user`/`tree`, `file`/`image`/`avatar`/
  `video`/`audio`, `location`, `address`, `composite`, `repeater`, `record`,
  `vector` — are now checked against the contract. A violation **logs a warning
  and passes** in this release (legacy rows must not strand their records);
  set `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1` to enforce as a
  `400 VALIDATION_FAILED`. The flip to strict-by-default rides a later minor
  (ADR-0104 R1/R2).

  **Deprecations (removal rides the next spec major), FROM → TO:**

  - `CurrencyValueSchema` (`{value, currency}`) → none. A `currency` field's
    value is a **bare number** everywhere in the runtime (validator, SQL `float`
    column, import coercion, field-zoo oracle); the currency code lives in field
    config. Use `valueSchemaFor({type: 'currency'})`.
  - `LocationCoordinatesSchema` (`{latitude, longitude}`) → `LocationValueSchema`
    (`{lat, lng}`) — the shape the platform actually stores.
  - `AddressSchema` is **adopted** (unchanged) as the enforced `address` value
    contract via `AddressValueSchema`.

  No stored data changes shape; the contract codifies deployed reality
  ("reality wins", ADR-0104 D1).

- 879ea13: ADR-0105 Phase 0 + Phase 1: group tenancy posture; organization scope as a
  first-class authorization dimension.

  > This release carries BREAKING spec removals (see "Enforce-or-remove" below)
  > but is recorded as `minor`: every publishable package is in the Changesets
  > lockstep group, so one `major` would promote the whole monorepo. Breaking
  > changes ship as `minor` during the launch window — the migration notes below
  > are what reach consumers in `CHANGELOG.md`.

  ## Tenancy is now a spectrum (D1)

  `single | group | isolated`, resolved by the `tenancy` service and selected with
  the new `OS_TENANCY_POSTURE` env var. Existing deployments are unchanged:
  `OS_TENANCY_POSTURE` unset derives the posture from `OS_MULTI_ORG_ENABLED`
  (`true` ⇒ `isolated`, else `single`). An unrecognized value throws at boot
  rather than silently landing in a posture with no organization wall.

  - `single` — no wall (unchanged).
  - `group` — **new.** Organizations are membership boundaries over one shared
    dataset; Layer 0 becomes `organization_id IN accessible_org_ids` (union / MOAC
    semantics). Enforced by the OPEN engine.
  - `isolated` — today's `multi`, renamed. Behavior, enterprise `org-scoping`
    probe and degraded-boot handling all unchanged.

  ## Organization scope is a first-class context field (D2)

  `ExecutionContext.accessible_org_ids` — every organization the caller holds a
  currently-valid membership in (ADR-0091 validity windows) — is resolved once by
  `resolveAuthzContext` and carried by every transport. The `group` wall reads it
  directly; RLS policies may reference it as
  `organization_id IN (current_user.accessible_org_ids)`. An empty or absent set
  fails the wall closed.

  Only the Layer 0 PREDICATE widens. Composition is untouched: the wall is still
  computed independently of the RLS compiler, AND-composed outermost, and
  crossable only by a true `PLATFORM_ADMIN` on a posture-permitting object — so
  ADR-0095's W1/W2 invariants hold in every posture.

  ## Two P0 correctness fixes (D3, D4) — behavior changes

  **D3 — app-authored org-scoped RLS policies are no longer silently dropped**
  (finding F1, framework#3539). `collectRLSPolicies` used to strip any policy whose
  `using` contained the substring `current_user.organization_id` when isolation was
  inactive, which swallowed app-authored policies as well as the platform's own.
  Stripping is now decided by PROVENANCE (identity against the shipped
  declaration). **Upgrade impact:** in a deployment with no organization wall, an
  app-authored policy referencing the active organization is now RETAINED and
  fails closed (zero rows) with a one-time warning, where it previously vanished
  and the object read unscoped. `getReadFilter` shared the defect, so analytics and
  raw-SQL consumers were affected too. If a policy was only ever meant for
  multi-org, delete it or install `@objectstack/organizations`.

  **D4 — `viewAllRecords`/`modifyAllRecords` never cross an organization
  boundary** (finding F2, framework#3540). Under a wall-less posture nothing
  bounded the wildcard superuser bits `organization_admin` carries, so a
  deployment that accumulated organizations (personal orgs on signup) made every
  owner/admin an environment-wide superuser. `auto-org-admin-grant` now grants a
  de-VAMA'd `organization_admin_no_bypass` variant when no wall is enforced, and
  revokes the superseded variant whenever the posture changes. **Upgrade impact:**
  in `single` posture an org owner/admin keeps full CRUD but loses the blanket
  ownership/sharing/RLS bypass. Deliberate deployment-wide visibility remains
  available through `admin_full_access` or an explicitly authored permission set —
  it just stops being a side effect of a better-auth membership role.

  ## Engine-owned organization stamping (D5)

  Under any wall-enforcing posture the engine stamps `organization_id` from the
  caller's active organization on an insert that omits it, and validates every
  supplied value against the wall. Idempotent with the enterprise auto-stamp
  (neither overwrites a supplied value). This also closes a real hole: the
  pre-existing post-image check required a non-array payload, so a BULK insert
  could carry a forged `organization_id` per row. One forged row now denies the
  whole write.

  ## Group structure, extension fields and red-line lints (D6, D7)

  - `sys_organization` gains `parent_organization_id` and `sort_order` — a
    **reporting dimension only**.
  - New lint `validateOrgAxisRedLines` (`org-axis-permission-inheritance`,
    `org-axis-cross-org-bu-grant`), wired into `os lint` / `os compile` /
    `os validate`: an RLS policy or sharing rule that walks the org tree is an
    error, as is a business-unit grant on a platform-global object.
  - Extension fields on better-auth-managed objects ride the existing ADR-0092
    whitelist. A new guard derives better-auth's real field surface from
    `getAuthTables()` at the pinned version and fails the build on any name
    collision, so a library upgrade cannot silently take ownership of a column.

  ## Enforce-or-remove (D11) — BREAKING

  Both removals are of surface that had **zero runtime consumers**, so no
  behavior changes; authoring them is now a no-op instead of a lint warning.

  - **`PermissionSet.contextVariables` — REMOVED.** The RLS compiler never read
    it. FROM → TO: a set a policy needs as `field IN (current_user.<key>)` is now
    supplied by a registered membership resolver (below); a constant belongs in
    the policy itself as a literal (`status = 'published'`).
  - **`Territory` / `TerritoryModel` / `TerritoryType` (`security/territory.zod.ts`)
    — REMOVED.** No runtime object, stack field or resolver existed. FROM → TO:
    matrix requirements are served by multi-position × business-unit anchoring; a
    generalized dimension-security module will arrive with its own ADR.
  - **`ExecutionContext.rlsMembership` — PRODUCTIZED.** The bag the compiler has
    merged since ADR-0056 finally has a producer: register an
    `IRlsMembershipResolver` (`@objectstack/spec/contracts`) under the
    `rls-membership-resolver` service, declaring the keys it owns. Fail-closed by
    construction — an unresolved key makes its policies drop out. Kernel-owned
    keys (`accessible_org_ids`, `org_user_ids`, …) are reserved and cannot be
    overwritten from this seam.

  ## Edition boundary (D12)

  The `group` posture's enforcement primitives ship OPEN — the union wall,
  `accessible_org_ids` resolution, D5 stamping/validation, the D3/D4 correctness
  fixes and the D6 lints — because the correctness of a wall is never a paid
  feature (cloud ADR-0016 铁律「强制免费、治理收费」). `isolated` keeps its existing
  enterprise `org-scoping` probe, so the current commercial boundary for
  legal-entity isolation is unchanged by this release.

- 840ee4b: fix(analytics,runtime,types): gate cube auto-inference on object existence; stop the dispatcher boundary returning raw SQL (#3867)

  Two independent defects on the `/analytics` surface, found while verifying #3770
  against a real server. On an authenticated CRM dev server, before this change:

  ```
  POST /api/v1/analytics/query {"cube":"sqlite_master","measures":["count"],"dimensions":["type"]}
  → 200 {"rows":[{"type":"index","count":262},{"type":"table","count":71},{"type":"view","count":1}],
         "sql":"SELECT type AS \"type\", COUNT(*) AS \"count\" FROM \"sqlite_master\" GROUP BY type"}
  ```

  That is SQLite's internal schema table — never a registered object — read
  successfully through the analytics endpoint. Not merely "the name reaches the
  driver and errors": **any table the connection can see was readable.**

  **① The cube name reached the driver as a table name.** `AnalyticsService.ensureCube`
  auto-infers a minimal Cube when none is registered, with `cube.sql = <the queried
name>`. That is the intended "metric over an object" path — an `object-metric` KPI
  widget queries `crm_account` with no authored Cube — but it accepted _any_ string,
  so the endpoint could aggregate over an arbitrary physical table. The
  analytics-side twin of the data-path gap #3770 closed, and it was not covered by
  that fix: #3770 gated the protocol's `analyticsQuery`, which is the _degraded
  fallback_; a deployment with `@objectstack/service-analytics` installed runs the
  real engine instead (`ctx.replaceService`).

  Inference is now gated on the same schema registry the data path consults, via a
  new optional `AnalyticsServiceConfig.isRegisteredObject` that `plugin.ts` wires
  from the `data` engine's `getObject`. Three-way rule: a registered Cube runs
  untouched (its `sql` is whatever it declares); an unregistered name that IS an
  object still auto-infers exactly as before; neither → `CUBE_NOT_FOUND` / 404
  raised before any SQL exists, naming both ways to make the request valid. With no
  probe configured the gate stands down and warns once — the same tiering #3770
  took for a missing registry. `generateSql` (`/analytics/sql`) is gated too.

  **② The dispatcher boundary returned `err.message` verbatim.** `errorResponseBase`
  is the single error exit for _every_ route the dispatcher plugin mounts —
  `/analytics`, `/packages`, `/i18n`, `/storage`, `/automation`, `/auth`,
  `/notifications`, `/mcp`. `@objectstack/rest` has guarded its data routes against
  driver dumps forever (`mapDataError`); this boundary guarded nothing, so any
  driver error on any of those routes shipped its SQL to the client. Unlike ①, this
  half is unconditional — it does not depend on the cube being invalid.

  The leak heuristic moved out of `rest-server.ts` into `@objectstack/types` as
  `looksLikeInternalErrorLeak` (both packages already depend on it) and is now
  applied at both boundaries — one predicate, one place to widen when a new
  dialect's phrasing shows up. `mapDataError`'s behaviour is unchanged. At the
  dispatcher it applies **only to 5xx**: a 4xx message is a deliberate
  business/validation answer and must reach the caller intact. Sanitising costs no
  diagnostics — the untouched error still reaches `errorReporter` through the
  existing `__obsRecordedError` side-channel.

  **Also fixed in the same function:** `errorResponseBase` read only
  `err.statusCode`, while domain errors across this codebase carry `status` (and
  `HttpDispatcher.errorFromThrown` already reads `status` first). Every deliberate
  4xx thrown through a dispatcher route — including #3770's `OBJECT_NOT_FOUND` on
  the analytics fallback path — was rendered as a **500**. It now reads `status`
  then `statusCode`.

  **Behaviour change.** `/analytics/query` and `/analytics/sql` return 404
  `CUBE_NOT_FOUND` for a cube that is neither registered nor a registered object;
  previously the name was passed to the driver. Dashboards and KPI widgets pointed
  at real objects or authored cubes are unaffected. A 5xx on a dispatcher route
  whose message looks like a driver dump now reads `Internal server error` — check
  server logs or your error reporter for the original.

- 1986594: feat(analytics): honour widget `dateGranularity`, `sortBy`/`sortOrder`, and `limit` in the dataset query (#3588)

  Three presentation options were accepted by the metadata layer and then dropped
  by the analytics query builder. They reached no SQL, produced no error, and the
  only way to notice was to read the `sql` a dataset response echoes — so a
  dashboard could declare `dateGranularity: 'month'` and quietly render one bar
  per record.

  - **`dateGranularity` now buckets.** `DatasetSelection` gained an optional
    `dateGranularity`, applied to every selected `date` dimension. Precedence per
    dimension: an explicit `timeDimensions` granularity, then the selection's,
    then the dataset dimension's own default. A widget can bucket a trend by month
    without the dataset committing every other consumer to that granularity.
  - **`order` / `limit` / `offset` now apply on every path.** They are applied to
    the ASSEMBLED grid — after measure-scoped sub-queries merge, after `compareTo`
    columns attach, and after derived measures are computed — so a derived measure
    is a valid sort key and the ObjectQL aggregate path (which has no ordering
    grammar, and which native SQL hands every date-bucketed query to) orders
    identically to native SQL. A single-query selection still pushes the window
    down into the statement. An `order` key that names nothing the selection
    projects is now rejected (400) rather than silently ignored.
  - **`limit` is deterministic.** Without an `order`, a limit orders by the
    selected dimensions first, so it truncates a reproducible window instead of an
    arbitrary subset.
  - **Widget `options` is a contract again.** The four query-affecting keys
    (`dateGranularity`, `sortBy`, `sortOrder`, `limit`) plus `stageOrder` are
    declared on `DashboardWidgetOptionsSchema`, so a typo like `sortDirection` is
    an author-time error. The bag stays open — renderer extras (`icon`, `columns`,
    `striped`, …) pass through untouched.

  Two latent bugs surfaced while fixing the above and are fixed here too:

  - `order`/`limit` were forwarded to EVERY sub-query. A measure-scoped
    supplementary query selects one measure, so an inherited `ORDER BY` named a
    column it never selected, and an inherited `LIMIT` truncated it before the
    merge — dropping rows from the assembled grid. Nothing hit this only because
    nothing passed `order`.
  - The `compareTo` pass built its query by hand and skipped granularity
    resolution, so a month-bucketed primary grid was merged against raw-timestamp
    comparison rows. No dimension key matched and every `<measure>__compare`
    column came back empty.

  `ObjectQLStrategy` now also echoes a representative `sql` (with `date_trunc`,
  `WHERE`, `ORDER BY`, and `LIMIT`; filter values parameterized, never inlined).
  Previously the `sql` field simply vanished from the response whenever a query
  was date-bucketed, leaving an author unable to tell "not implemented" from "this
  strategy doesn't report".

- 3c8cfd1: fix(rest): make the API-exposure gate's metadata fail-open observable (#3545, #3391 follow-up)

  The object API-exposure gate (`apiEnabled` / `apiMethods`) fails OPEN when object
  metadata can't be resolved, so a transient metadata outage doesn't 405 every
  request. #3545 evaluated the residual risk of that path and confirmed it is
  acceptable — the gate is a **surface-area control, not the authorization
  boundary**: every request still passes auth and the ObjectQL security middleware
  (CRUD / FLS / RLS) on the data call regardless of the gate's outcome, so a
  fail-open can never bypass data authorization.

  The one gap was that the fail-open was **silent** — a persistent metadata fault
  (store down / corrupt schema doc), during which the gate allows every operation
  unchecked, looked identical to healthy operation.

  - **rest** `loadObjectItems` now LOGS a _thrown_ metadata read (a real fault)
    while leaving a legitimately-empty registry (a cold-start `[]`) silent — so a
    genuine outage is diagnosable without false alarms during normal startup. The
    behavior is unchanged (still returns `[]` → gate abstains → data path + security
    enforce).
  - **runtime** `api-exposure.ts` records the #3545 tiered decision in its
    contract doc: keep fail-open when the whole metadata service is unavailable
    (failing closed would break the cold-start window for no security gain); the
    narrow "object resolvable but its `enable` policy is present-yet-unreadable"
    widen (unreachable through Zod-validated registration) is deferred to the
    exposure-semantics window (#3543).

  No contract or behavior change to the gate itself — observability + decision
  record only.

- f92096b: fix(approvals): an approval action is recorded against the authenticated caller, never a body field (#3800)

  Every mutating approvals entrypoint takes an `actorId`, and the REST routes
  filled it from `body.actorId ?? body.actor_id ?? context.userId` — so the body
  won. The service then authorized _that value_: `pending_approvers.includes(
input.actorId)` for a decision, `submitter_id === actorId` for a recall. It never
  checked that the value named the caller.

  So any authenticated user could POST `{"actorId": "<someone else>"}` and have
  that person's approval recorded, the request finalized, and the owning flow run
  resumed down the `approve` edge — or name a request's submitter and recall it.
  With `api.requireAuth` unset the anonymous-deny never fires either, so an
  unauthenticated request could do the same.

  #3783 drew this line for the _data-write_ identity and called the audit-row half
  "tolerable". It was not: the same unchecked string was the authorization key, so
  naming someone else was not a mislabelled audit row, it was how you got through
  the door.

  The actor is now resolved server-side (`ApprovalService.resolveActor`) on all
  nine entrypoints — `decide` / `decideNode`, `recall`, `sendBack`, `resubmit`,
  `reassign`, `remind`, `requestInfo`, `comment`.

  **The rule is not "`actorId` must equal `context.userId`."** A slot can
  legitimately be keyed by something else: the approver resolver stores the
  `type:value` literal when a graph lookup finds no holders, and the Console picks
  from the caller's own identity list — user id, email, or `role:<r>`. The rule is
  **"the actor must be an identity the server can prove belongs to the caller"**:

  - A **system** context keeps its explicit actor. The SLA sweep's reserved
    `system:sla` sentinel and the ADR-0043 action link — whose single-use hashed
    token binds exactly one approver — are unchanged. They are the only callers
    holding a trustworthy actor with no session behind them.
  - A caller with **no identity at all** is now refused. This is the anonymous case
    above.
  - **No `actorId`, or one naming the caller**, resolves to the caller. This is the
    common path and what the Console already sends.
  - **Any other value** is accepted only when the server can prove the caller holds
    it — `position:<p>` / `role:<p>` against the positions on the resolved authz
    context, or the caller's own email (one lazy `sys_user` read, taken only when
    nothing cheaper matched). Otherwise `FORBIDDEN`.

  REST still forwards the body value; it is now a _hint_ the service validates,
  which is what keeps the email and `type:value` slot cases working.

  **Upgrade note.** A client that deliberately sent another user's `actorId` now
  gets `403 FORBIDDEN` instead of silently succeeding. Send the action as the
  acting user's own session — the field can be omitted entirely, and the caller is
  used. Server-to-server callers that legitimately act for someone else should
  present a system context, as the SLA sweep and the action link already do.

  This also makes two existing claims true that were previously aspirational: the
  approval object's declared actions say "`actorId` defaults to the caller
  server-side… the service remains the authority on who may act", and
  `attachViewers` documents `can_act` as mirroring "the exact authorization the
  decision methods enforce".

- 1003125: feat(client): close the approvals (6) + record-shares (3) REST gaps (#3587 batch 3/5)

  `client.approvals` gains the full request lifecycle beyond approve/reject:
  `recall` (submitter withdraw), `revise` / `resubmit` (ADR-0044 send-back
  round-trip), and the thread interactions `remind` / `requestInfo` / `comment`.
  New `client.shares` namespace for per-record sharing grants: `list` / `grant` /
  `revoke` (204-safe) under `/data/:object/:id/shares`. REST route-ledger
  ratchet: 26 → 17.

- 6e62a93: feat(client): close the sharing-rules (5) + security-explain (2) + search (1) REST gaps (#3587 batch 4/5)

  New `client.shares.rules` sub-namespace for tenant-wide sharing rules
  (M10.17): `list` / `save` / `get` / `delete` (204-safe, grants cascade) /
  `evaluate` (reconcile). `client.security.explain` speaks the ADR-0090 D6
  access-explanation contract via the POST transport (the GET query form is the
  same `ExplainRequestSchema`). Top-level `client.search` covers global
  cross-object search (M10.5). REST route-ledger ratchet: 17 → 9.

- ecda20c: feat(client): close the 8 reports-family REST gaps (#3587 batch 2/5)

  New `client.reports` namespace speaking the plugin-reports REST surface:
  `list` / `save` / `get` / `delete` (schedules cascade), `run`, `schedule`,
  `listSchedules`, `unschedule`. The two DELETE routes return 204 — the client
  methods return `{ deleted: true }` without attempting to parse an empty body.
  Fixed path (`/api/v1/reports` is not in `ApiRoutesSchema`), matching the
  keys / share-links precedent. REST route-ledger ratchet: 34 → 26.

- 6e62a93: feat(client): close the final 9 REST gaps — ratchet 9 → 0 (#3587 batch 5/5)

  `data.clone` (enable.clone duplication) and `data.export` (streaming
  CSV/JSON/XLSX; returns the raw `Response` — a file stream, not a JSON
  envelope). New `email.send` (IEmailService; branch on the returned `status`).
  `analytics.queryDataset` speaks the ADR-0021 REST dataset-query dialect. New
  `datasources.external.*` federation admin: `listTables` / `draft` / `import` /
  `refreshCatalog` / `validate` (ADR-0015 Addendum, 503-degrading). Every REST
  route is now either SDK-expressed or carries a reviewed non-sdk disposition —
  the #3587 gap ratchet rests at ZERO.

- fc968af: feat(client): close the 9 metadata-family REST gaps the #3587 ledger carried (#3587)

  New `meta` surface: `getDiagnostics` (spec-validation sweep), `getReferences`
  (reverse references), `getBookTree` (ADR-0046 §6 spine resolution), `getAudit`
  (ADR-0010 §3.6 protection trail), `publishItem` / `rollbackItem` / `diffItem`
  (ADR-0033 per-item draft lifecycle). The two compound-name routes
  (`GET|PUT /meta/:type/:section/:name`) turned out to be already expressible —
  `getItem`/`saveItem` pass slashes through unencoded — so they are flipped to
  `sdk` with URL-pinning tests instead of new methods (the audit note claiming
  an encoding barrier was wrong; only `deleteItem` encodes). REST route-ledger
  ratchet: 43 → 34.

- 48c110e: feat(datasource): a datasource that is down is visible, and says why when queried (#3827, #3828)

  #3816 made an explicitly-bound datasource that cannot connect refuse the boot. Two
  gaps survived that fix, both in the cases that still boot — a policy denial, an
  `autoConnect` datasource, or any failure the operator waved through with
  `OS_ALLOW_DRIVER_CONNECT_FAILURE`:

  - **It was invisible.** `DatasourceSummary.status` was the literal `'unvalidated'`
    for every row — the contract declared three states and the implementation only
    ever emitted one — so a dead datasource looked exactly like a healthy-untested
    one. `checkDriversHealth()` could not help either: it iterates registered
    drivers, and a datasource that never connected was never registered, so it is
    _absent_ from the probe rather than unhealthy. The only trace was a warning
    that scrolled past at boot, which made the diagnostic procedure "restart the
    server and re-read the logs".
  - **The query-time error said nothing.** `getDriver()` answered four different
    situations with one sentence, `Datasource 'x' is not registered.`: refused by
    policy, failed to connect under the escape hatch, a misspelled name, and
    `active: false`. Only the third is an authoring bug, so the other three sent
    the reader hunting for a typo that does not exist.

  Both come from the same root: `connect()` already produced a `ConnectResult` for
  every attempt and every caller threw it away.

  - **`DatasourceConnectionService` retains the last verdict per datasource**, with a
    coarse `availability` (`available` / `blocked` / `failed` / `unattempted`) beside
    the raw status. New `getConnectionState(name)` / `listConnectionStates()`.
    `disconnect()` drops it, so a removed pool stops explaining itself.
  - **`DatasourceSummary.status` tells the truth**: `ok` | `error` | `blocked` |
    `unvalidated`, with a new operator-facing `statusReason`. `blocked` is new and
    deliberate — a policy denial is a decision, not a fault, and will not clear on
    its own. Reported in **Setup → Datasources**, `GET /api/v1/datasources`, and the
    summary returned from create/update, so a "Save" whose pool failed to open is no
    longer presented as success.
  - **`ERR_DATASOURCE_UNAVAILABLE` (HTTP 503)**: new `DatasourceUnavailableError`
    from `@objectstack/objectql`, thrown by `getDriver()` when the connection layer
    recorded _why_ a declared datasource has no driver. An undeclared name keeps the
    original message — there is genuinely nothing to add. 503 rather than 500/400:
    nothing about the request is wrong, and the state may clear.
  - **A privileged/public split for the reason.** The error **never** carries the
    underlying cause — connect failures routinely contain hosts, ports and DSNs, and
    a policy's `reason` is written for operators. Those stay in the logs and the
    (admin-gated) datasource list. `DatasourceConnectDecision` gains an opt-in
    `publicReason` for hosts that want to tell tenants something specific
    (e.g. `'External datasources require the Scale plan.'`); it is the only string
    that reaches an end user.
  - **Readiness is deliberately not gated on this.** `/ready` still reflects
    registered-driver health only: an optional datasource being down must not pull an
    otherwise-working replica out of the load balancer.

  Also lands a drift guard for **#3826**, and corrects ADR-0062's status while doing
  it. The ADR claimed D1 ("exactly one definition → live driver path") as
  implemented; only the _construction_ half converged. The `default` driver is still
  registered as a `driver.*` kernel service and connected by `ObjectQLEngine.init()`,
  with its own failure verdict, pool teardown, and no connect policy. What blocks the
  merge is an input-shape mismatch, not ordering: `connect()` takes a datasource
  _definition_ and builds the driver, while `default` arrives pre-built, and routing
  it through the service would make `ObjectQLPlugin`'s boot depend on an optional
  higher-layer service. Until that is designed, `degraded-boot-parity.test.ts` pins
  both paths to the same operator-visible contract (fail-fast by default, identical
  `OS_ALLOW_DRIVER_CONNECT_FAILURE` parsing, `DEGRADED BOOT` on stderr) so a change
  to one that forgets the other fails CI — #3741 → #3758 was exactly that miss, and
  it cost three months and a second bug report.

  **Migration.** Additive. `DatasourceSummary.status` gains a `'blocked'` member: a
  consumer exhaustively switching on it needs a case (the admin UI shows it as a
  distinct state). Nothing that was `'ok'` or `'error'` changes meaning; rows that
  were reported `'unvalidated'` now report their real state. Query-time errors for a
  datasource the connection layer recorded change from a generic `Error` to
  `DatasourceUnavailableError` (503 instead of the previous catch-all status);
  matching on the old `is not registered` text still works for the undeclared-name
  case, which is the only one that was ever accurate.

- ce1f100: fix(rest): export emits the projected header row on an empty result set (#3547)

  `GET /data/:object/export` wrote a zero-byte file whenever the query matched no
  rows — the header was only ever written alongside the first data chunk. With the
  `getReadableFields` column projection the readable column set is derived from
  schema + context, so it is known even when no rows come back: an empty CSV/xlsx
  export now carries the exact readable header, which also makes it a usable
  import template.

  The header is emitted only when the column set is AUTHORITATIVE — the security
  service's readable projection, or an explicit `?fields=` request. When the header
  is schema-derived and the projection was unavailable, the export stays headerless
  as before: the masked-row fallback has no rows to narrow with, and writing the
  full schema header would name FLS-hidden columns. `header=false` still suppresses
  the header in every case.

- 81ce41a: feat(rest): `treatAsHistorical` import also preserves the original audit timeline (#3493)

  Follow-up to #3479/#3483. `treatAsHistorical` solved the FSM half — mid-lifecycle
  rows are no longer rejected by `initialStates` — but the OTHER half of a historical
  migration, preserving the original timeline, still didn't hold: an imported ticket
  that closed in 2021 stored `updated_at` = the import day (and `updated_by` = the
  importer), and a `writeMode: 'upsert'` refresh silently dropped business `readonly`
  fields (`closed_at`, `resolved_by`). Reports, audit, and "recently modified"
  sorting all came out wrong.

  Three layers were force-overwriting the timeline; all three now respect a single
  new opt-in flag, `ExecutionContext.preserveAudit`, which `treatAsHistorical` sets
  alongside `skipStateMachine`:

  - **spec**: `ExecutionContext.preserveAudit` (server-set only, never client-supplied)
    and `DriverOptions.preserveAudit` (threaded to the driver's update stamp).
  - **objectql** — the built-in audit hook (`plugin.ts`) now treats `updated_at` /
    `updated_by` as CLIENT-PREFERRED (`?? now` / `?? userId`) under `preserveAudit`,
    symmetric with how `created_at` / `created_by` already behave on insert; and the
    static-`readonly` write strip (`stripReadonlyFields`) admits a WHITELIST — the
    audit/timestamp family plus author-declared business `readonly` fields — so an
    upsert refresh no longer drops them.
  - **driver-sql** — the SQL `update` path keeps a supplied `updated_at` instead of
    force-advancing it to `now` when `DriverOptions.preserveAudit` is set (fills-only-
    empty, mirroring the insert stamp).
  - **rest** — the import runner sets `preserveAudit` on the write context iff the
    request opts into `treatAsHistorical`.

  Deliberately a WHITELIST, not the blanket `isSystem` exemption: platform-managed
  `system` columns OUTSIDE the audit family (`organization_id` / tenancy, generated
  columns) STAY stripped, so a historical import reinstates established facts without
  becoming a backdoor to forge tenancy. Permissions / RLS / field-level security are
  unaffected — this changes only which audit/readonly values the runtime overwrites,
  never who may write the record. Fully opt-in: a normal write still auto-stamps
  `updated_at`/`updated_by` and strips `readonly` exactly as before. The objectui
  "Import as historical data" checkbox (objectui#2815) now drives both halves — no new
  UI.

- 85e1e4e: feat(rest): `treatAsHistorical` import option — skip the state machine for historical-data migration (#3479)

  Sibling of #3433 (seed exemption), one entry point over. #3165's `initialStates` enforced
  the FSM entry point on every INSERT, so importing established historical facts —
  a batch of already-`closed` tickets, `closed_won` deals, `completed` projects —
  was rejected row-by-row with `invalid_initial_state`, blocking the core
  data-migration path. Unlike the seed case it was visible (per-row errors), but it
  still functionally blocked a legitimate use.

  - **spec**: `ExecutionContext.skipStateMachine` — a general, server-set flag (the
    seed-specific `seedReplay`'s sibling) that skips the `state_machine` rule for a
    write; `ImportRequestSchema.treatAsHistorical` (default `false`) — the user-facing
    import option.
  - **objectql**: the engine now skips the state machine for `seedReplay` OR
    `skipStateMachine` (one helper), covering both seed replay and historical import.
  - **rest**: the import runner sets `skipStateMachine` on the write context iff the
    request opts into `treatAsHistorical`; default off, so a normal import still walks
    the FSM (the strict behavior is the default). Import **undo** now also carries
    `skipStateMachine`, since restoring a prior snapshot re-writes an earlier state
    that need not be a legal transition from where the row is now.
  - **platform-objects**: `sys_import_job.treat_as_historical` audit column (additive).

  Scope is identical to the seed exemption: ONLY the `state_machine` rule is skipped;
  field shape, `format`, `cross_field`, `script` all still run. The objectui import
  wizard checkbox is a separate follow-up.

- 65ac468: fix(import): sanitize row errors — never leak raw SQL, map constraint failures to human wording (#3566)

  A failing import row surfaced the driver's raw error verbatim. When a write hit
  a DB constraint (e.g. `sys_user.phone_number` is `unique`), the query builder
  embeds the entire failing statement in `err.message`, and `toFailedResult`
  handed that straight back — so the importer saw `` insert into `sys_user`
(...) values (...) - UNIQUE constraint failed: sys_user.phone_number ``. That is
  both unreadable and an information disclosure of the schema.

  - `sanitizeRowError()` (import-runner) maps the common constraint failures —
    SQLite / MySQL / Postgres `UNIQUE` and `NOT NULL` — to human wording
    ("A record with this `<column>` already exists.", "`<column>` is required.")
    and, as a backstop, never lets a message that still reads as a SQL statement
    reach the client (it salvages the driver's trailing reason, or falls back to
    a generic message). Already-friendly messages (e.g. better-auth's "User
    already exists") pass through unchanged. Applies to every import path.
  - `isLikelyEmail` now rejects non-ASCII addresses, so an address like
    `x@柴仟.com` fails the import **dry-run** pre-check instead of passing client
    and dry-run validation only to be rejected by better-auth's strict ASCII
    validator at real-import time.

- ef5e72d: fix(rest): undo of a historical import now preserves the audit timeline (#3549)

  A `treatAsHistorical` import writes with `preserveAudit` (#3493), keeping the
  original `updated_at`/`updated_by` and business `readonly` fields instead of
  stamping-now / stripping them. Its undo route, however, restored the captured
  pre-import snapshot with a plain write context — so the audit auto-stamp
  re-wrote `updated_at`/`updated_by` to "now", silently corrupting the very
  timeline the historical import had preserved.

  The undo write context now mirrors the import's own: it carries
  `preserveAudit` iff the job row is flagged `treat_as_historical`, so restoring
  `u.before` re-writes the snapshotted audit/timestamp values verbatim. A normal
  import's undo is unchanged (default stamp/strip).

- 67452d1: feat(spec): resolve page metadata i18n — `page:header` title/subtitle (#3589)

  Custom system pages authored as metadata (Installed Apps, Cloud Connection,
  Connect an Agent) hard-code their `page:header` copy in
  `properties.title` / `properties.subtitle`. Every other metadata type is
  localized at the REST boundary, but `page` was not: the `pages` namespace
  existed only on `AppTranslationBundleSchema` — a schema no runtime reads —
  with no resolver behind it, so those headers stayed English in every locale
  while the matching nav labels translated correctly.

  - `TranslationDataSchema` (the shape the i18n service actually serves) gains a
    `pages` namespace: `pages.<name>.{label,description,title,subtitle}`.
  - New `translatePage` in `@objectstack/spec/system` translates a page's own
    `label` / `description` and overlays `title` / `subtitle` onto every
    `page:header` in the page's regions. Registered in
    `translateMetadataDocument`, so it rides the existing read path.
  - `page` added to the REST boundary's `TRANSLATABLE_META_TYPES`. Locale
    extraction, the locale-keyed ETag, and `Vary: Accept-Language` already
    covered every metadata type — no new plumbing.
  - `objectstack i18n extract` now emits page entries, including the
    `page:header` copy, so the new namespace is not invisible to the tooling.
  - zh-CN / ja-JP / es-ES translations shipped for the three Setup pages, plus
    the missing `nav_cloud_connection` / `nav_connect_agent` nav labels (these
    existed only in zh-CN).

  Header copy is keyed by **page name**, not by component id: `page:header`
  instances carry no stable id. `title` falls back to `pages.<name>.label`, since
  a page's header title and its nav label are normally the same string.

  Authoring is unchanged and English literals stay in metadata as the fallback —
  a page with no `pages` entry renders exactly as before. Consumers of
  `@object-ui` need no change: pages arrive already localized from the server.

- 3d5f726: feat(rest): route audit tranche 2 — the REST surface gets its own ledger +
  conformance guard (#3587, follow-up to #3563)

  The dispatcher tranche closed its 27 gaps and guards them (#3569…#3579), but
  `@objectstack/rest` mounts a second, larger surface the client also reaches —
  89 routes, never audited. `rest-route-ledger.ts` now records a reviewed
  disposition for every one of them (38 sdk, 43 gap, 3 server-only, 3 public,
  2 mismatch), and the guard is real enumeration on both sources: RouteManager
  routes via the `getRoutes()` introspection seam, and the two
  RouteManager-bypassing registrars (`package-routes.ts`,
  `external-datasource-routes.ts`) via captured mock-server registrations — no
  pinned-by-hand list. The client half
  (`rest-route-ledger-coverage.test.ts`) verifies every claimed method exists;
  a 43-gap ratchet is wired into CI. Every guard direction was negative-tested.

  Notable dispositions the audit surfaced: `POST /api/v1/packages` is a
  publish/install shape collision between REST and the dispatcher (REST
  registers first and wins) — ledgered `mismatch`; the REST
  `GET /ui/view/:object/:type` path dialect is unreachable by the SDK's
  query-param dialect — ledgered `mismatch`; `service-storage` /
  `service-i18n` mount a third route surface outside `@objectstack/rest`,
  explicitly out of scope here and tracked under #3587.

  No behavior change — data + tests only, plus a scope-note refresh in the
  runtime ledger pointing at the new REST ledger.

- 1659072: feat(spec): publish `ISecurityService` — the `security` service surface becomes an enforced contract

  The `security` service registers seven cross-package methods (`getReadFilter`,
  `getReadableFields`, `resolvePermissionSetNames`, `explain`, and the three
  audience-binding suggestion calls) but had no contract in
  `@objectstack/spec/contracts`. Consumers duck-typed it, and each one invented its
  own fallback for a missing method or an "empty" answer — with more consumers
  arriving, that is a drift surface.

  `ISecurityService` now documents the surface, and both ends are typed against it
  so it is **enforced rather than declared**: `plugin-security` assigns its
  registration to `ISecurityService` (a renamed, dropped, or re-typed method fails
  that build), and the REST layer resolves the service as a `Partial<ISecurityService>`
  (so call sites must keep feature-detecting instead of assuming the full surface).

  The contract makes explicit the one thing consumers cannot guess — that the
  methods do **not** share a failure convention:

  - `getReadFilter` fails **CLOSED**: a resolution failure yields a deny filter
    matching zero rows, never `undefined`. `undefined` means "no row restriction",
    and nothing else.
  - `getReadableFields` fails **SOFT**: `undefined` means "no answer, use your own
    projection", while `[]` is authoritative and means "no field is readable" —
    opposite instructions that a consumer must not conflate.

  Typing the producer immediately caught one real discrepancy, fixed here:
  `getReadFilter` declared `Promise<Record<string, unknown> | null | undefined>`
  while every return path yields a filter or `undefined` (`filter ?? undefined`
  normalizes the null away). The dead `| null` is removed, so "no restriction" has
  exactly one representation. Type-level only — no runtime behaviour changes.

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
  - @objectstack/observability@17.0.0-rc.0
  - @objectstack/service-package@17.0.0-rc.0

## 16.1.0

### Patch Changes

- 818e6a3: fix(server-timing): emit the per-request, admin-gated `Server-Timing` header on the standard server (`os serve`/`dev`) (#3361)

  The per-request `Server-Timing` path (#2408) — where an admin sends
  `X-OS-Debug-Timing: 1` (or `json`) and gets phase timings while an ordinary user
  gets nothing — never emitted on the shipped Hono server. The disclosure gate the
  Hono middleware opens is only ever flipped by the runtime dispatcher's
  `timedResolveExecutionContext`, but the data (`/api/v1/data/*`) and metadata
  (`/api/v1/meta/*`) routes on `os serve`/`dev` are served by `@objectstack/rest`'s
  `RestServer` (which shadows the Hono plugin's own CRUD), and its identity
  resolver never opened the gate. Only global mode (`OS_SERVER_TIMING=true`) — which
  discloses to _every_ caller, not just admins — worked.

  - **observability**: the disclosure predicate `isPerfDisclosurePrincipal(ec)` now
    lives here (the home of the gate), the single definition of "who may pull
    per-request timings" shared by every HTTP entry point. `@objectstack/runtime`
    re-exports it for back-compat.
  - **rest**: `RestServer.resolveExecCtx` opens the gate for an admin/service
    principal (via the carried `posture` rung), the REST-server analog of the
    dispatcher — this is the fix that makes `os serve`/`dev` emit.
  - **plugin-hono-server**: the standalone CRUD surface's self-contained
    `resolveCtx` opens the gate too (deriving the rung for the gate decision only,
    never writing it onto the enforcement context). Adds an e2e test that boots the
    Hono app and asserts an admin gets `Server-Timing` while a member/anon does not.

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
- Updated dependencies [818e6a3]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/observability@16.1.0
  - @objectstack/service-package@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Minor Changes

- bfa3c3f: **Broadcast a `transactionalBatch` capability bit in discovery so clients negotiate the atomic cross-object batch declaratively, instead of runtime-probing 404/405/501 (#3298).**

  The atomic cross-object batch endpoint (`POST {basePath}/batch`, #1604 / ADR-0034 item 4) and its typed SDK surface (`client.data.batchTransaction`, #3271) already shipped, but discovery never told a client whether a backend actually supports it. Consumers (notably ObjectUI's `ObjectStackAdapter`) had to _probe_: fire a `/batch`, read `404`/`405` (no route) or `501` (no runtime transaction), and only then fall back to non-atomic client-side simulation. That is "find out by calling", not capability negotiation — it cannot be decided at connect time and cannot serve as the "minimum backend supports `/batch`" gate that blocks hard-deleting the non-atomic fallback downstream.

  `WellKnownCapabilitiesSchema` gains a required `transactionalBatch: boolean`, and **every** discovery producer fills it honestly (`declared === enforced`), so it never becomes a declared-but-unpopulated bit:

  - **`@objectstack/metadata-protocol`** (`getDiscovery`) — reports whether the runtime engine can honour a transaction (`typeof engine.transaction === 'function'`). The `/batch` handler runs its ops inside `engine.transaction()`, which degrades to a non-atomic passthrough (or 501) without one.
  - **`@objectstack/rest`** (`/discovery`) — ANDs the engine signal with whether it actually mounts the route (`api.enableBatch`), so a server with batch disabled reports `false` even on a transaction-capable engine (never advertise an endpoint that would 404).
  - **`@objectstack/plugin-hono-server`** (standalone discovery) — reports `false`: this minimal surface registers CRUD only and does not mount `/batch` (that ships with `@objectstack/rest`). Under-reporting is the safe direction — a client keeps its correct-but-slower fallback rather than losing atomicity.
  - **`@objectstack/client`** — already normalizes hierarchical `capabilities` to flat booleans, so `client.capabilities.transactionalBatch` is exposed (and now typed) for declarative consumers.

  The bit follows the existing capability semantics: `true` ⟺ the `/batch` route is mounted **and** the runtime can honour a transaction — the exact condition under which the endpoint returns `200` rather than `404`/`405`/`501`. Additive and behavior-preserving; only the discovery payload gains a field.

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

- e057f42: fix: harden the bulk-write path — retries, idempotency, contracts, and summary visibility (#3147–#3152)

  Six reliability fixes to the batched seed/import + `engine.insert(array)` path
  introduced by the #2678 bulk-write rework:

  - **#3151** `bulkWrite` validates that `writeBatch` returns one record per input
    row (a short/long/non-array return is degraded per-row, not backfilled as
    phantom success); `engine.insert(array)` likewise rejects a short driver
    `bulkCreate` return instead of padding afterInsert with `undefined`.
  - **#3150** wraps the two remaining un-retried write points (seed
    `writeRecord`/`resolveDeferredUpdates`, import's no-`createManyData`
    fallback) in `withTransientRetry`; `defaultIsTransientError` short-circuits
    definitive logical errors to non-transient.
  - **#3148** import `resolveRef` flushes pending creates on a same-object miss so
    a later row can reference an earlier same-file CREATE, and no longer
    negatively caches a miss.
  - **#3149** threads an `attempt` counter through `bulkWrite`; seed rechecks by
    `externalId` and import by `matchFields` before re-writing, so a
    commit-then-lost-response retry cannot duplicate a batch.
  - **#3147** `recomputeSummaries` retries transient failures and, on exhaustion,
    surfaces `SummaryRecomputeError` (`ERR_SUMMARY_RECOMPUTE`) instead of a
    silent warn; seed/import recover it to a warning without re-writing.
  - **#3152** autonumbers are assigned after validation, so a batch that dies in
    validation consumes no sequence value (no number-range gaps).

- 43a3efb: fix(rest): gate the cross-object transactional batch by the same per-object API rules as single-record writes (#1604)

  The `POST {basePath}/batch` route (issue #1604 / ADR-0034) wraps N cross-object
  create/update/delete ops in one engine transaction, but it skipped the
  per-object API-exposure gate every single-record route applies — an
  authenticated caller could write to an `apiEnabled: false` object, or run an
  operation outside an object's `apiMethods` whitelist, straight through the batch
  surface (ADR-0049 / #1889 — the same "declared ≠ enforced" hole closed for the
  generic write path in #3220 / #3213).

  The route now:

  - validates the body against a new `CrossObjectBatchRequestSchema`
    (`@objectstack/spec/api`, Zod-First) — a malformed op, an unknown action, or a
    missing `object` is a `400` instead of a `500`;
  - enforces `enable.apiEnabled` / `enable.apiMethods` for **every** op (metadata
    fetched once, each distinct `(object, action)` checked) BEFORE opening the
    transaction — `404 OBJECT_API_DISABLED` / `405 OBJECT_API_METHOD_NOT_ALLOWED`;
  - requires an `id` for `update` / `delete` (`400`);
  - rejects an unresolvable `{ $ref }` with `400 BATCH_UNRESOLVED_REF` instead of
    silently writing a `null` FK;
  - rejects an explicit `atomic: false` (`400 BATCH_NOT_ATOMIC`) rather than
    silently applying atomically — non-atomic per-object batches stay on
    `POST /data/:object/batch`.

  `enforceApiAccess` is refactored to share the pure `apiAccessDenialFromEnable`
  check + a `loadObjectItems` helper with the batch route (single-record behavior
  unchanged). Adds `rest-batch-endpoint.test.ts` — the REST-boundary coverage
  ADR-0034 flagged as missing (commit, `$ref`, rollback surfacing, API-access
  denial, request validation).

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
  - @objectstack/service-package@16.0.0

## 16.0.0-rc.1

### Minor Changes

- bfa3c3f: **Broadcast a `transactionalBatch` capability bit in discovery so clients negotiate the atomic cross-object batch declaratively, instead of runtime-probing 404/405/501 (#3298).**

  The atomic cross-object batch endpoint (`POST {basePath}/batch`, #1604 / ADR-0034 item 4) and its typed SDK surface (`client.data.batchTransaction`, #3271) already shipped, but discovery never told a client whether a backend actually supports it. Consumers (notably ObjectUI's `ObjectStackAdapter`) had to _probe_: fire a `/batch`, read `404`/`405` (no route) or `501` (no runtime transaction), and only then fall back to non-atomic client-side simulation. That is "find out by calling", not capability negotiation — it cannot be decided at connect time and cannot serve as the "minimum backend supports `/batch`" gate that blocks hard-deleting the non-atomic fallback downstream.

  `WellKnownCapabilitiesSchema` gains a required `transactionalBatch: boolean`, and **every** discovery producer fills it honestly (`declared === enforced`), so it never becomes a declared-but-unpopulated bit:

  - **`@objectstack/metadata-protocol`** (`getDiscovery`) — reports whether the runtime engine can honour a transaction (`typeof engine.transaction === 'function'`). The `/batch` handler runs its ops inside `engine.transaction()`, which degrades to a non-atomic passthrough (or 501) without one.
  - **`@objectstack/rest`** (`/discovery`) — ANDs the engine signal with whether it actually mounts the route (`api.enableBatch`), so a server with batch disabled reports `false` even on a transaction-capable engine (never advertise an endpoint that would 404).
  - **`@objectstack/plugin-hono-server`** (standalone discovery) — reports `false`: this minimal surface registers CRUD only and does not mount `/batch` (that ships with `@objectstack/rest`). Under-reporting is the safe direction — a client keeps its correct-but-slower fallback rather than losing atomicity.
  - **`@objectstack/client`** — already normalizes hierarchical `capabilities` to flat booleans, so `client.capabilities.transactionalBatch` is exposed (and now typed) for declarative consumers.

  The bit follows the existing capability semantics: `true` ⟺ the `/batch` route is mounted **and** the runtime can honour a transaction — the exact condition under which the endpoint returns `200` rather than `404`/`405`/`501`. Additive and behavior-preserving; only the discovery payload gains a field.

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/service-package@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

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

- e057f42: fix: harden the bulk-write path — retries, idempotency, contracts, and summary visibility (#3147–#3152)

  Six reliability fixes to the batched seed/import + `engine.insert(array)` path
  introduced by the #2678 bulk-write rework:

  - **#3151** `bulkWrite` validates that `writeBatch` returns one record per input
    row (a short/long/non-array return is degraded per-row, not backfilled as
    phantom success); `engine.insert(array)` likewise rejects a short driver
    `bulkCreate` return instead of padding afterInsert with `undefined`.
  - **#3150** wraps the two remaining un-retried write points (seed
    `writeRecord`/`resolveDeferredUpdates`, import's no-`createManyData`
    fallback) in `withTransientRetry`; `defaultIsTransientError` short-circuits
    definitive logical errors to non-transient.
  - **#3148** import `resolveRef` flushes pending creates on a same-object miss so
    a later row can reference an earlier same-file CREATE, and no longer
    negatively caches a miss.
  - **#3149** threads an `attempt` counter through `bulkWrite`; seed rechecks by
    `externalId` and import by `matchFields` before re-writing, so a
    commit-then-lost-response retry cannot duplicate a batch.
  - **#3147** `recomputeSummaries` retries transient failures and, on exhaustion,
    surfaces `SummaryRecomputeError` (`ERR_SUMMARY_RECOMPUTE`) instead of a
    silent warn; seed/import recover it to a warning without re-writing.
  - **#3152** autonumbers are assigned after validation, so a batch that dies in
    validation consumes no sequence value (no number-range gaps).

- 43a3efb: fix(rest): gate the cross-object transactional batch by the same per-object API rules as single-record writes (#1604)

  The `POST {basePath}/batch` route (issue #1604 / ADR-0034) wraps N cross-object
  create/update/delete ops in one engine transaction, but it skipped the
  per-object API-exposure gate every single-record route applies — an
  authenticated caller could write to an `apiEnabled: false` object, or run an
  operation outside an object's `apiMethods` whitelist, straight through the batch
  surface (ADR-0049 / #1889 — the same "declared ≠ enforced" hole closed for the
  generic write path in #3220 / #3213).

  The route now:

  - validates the body against a new `CrossObjectBatchRequestSchema`
    (`@objectstack/spec/api`, Zod-First) — a malformed op, an unknown action, or a
    missing `object` is a `400` instead of a `500`;
  - enforces `enable.apiEnabled` / `enable.apiMethods` for **every** op (metadata
    fetched once, each distinct `(object, action)` checked) BEFORE opening the
    transaction — `404 OBJECT_API_DISABLED` / `405 OBJECT_API_METHOD_NOT_ALLOWED`;
  - requires an `id` for `update` / `delete` (`400`);
  - rejects an unresolvable `{ $ref }` with `400 BATCH_UNRESOLVED_REF` instead of
    silently writing a `null` FK;
  - rejects an explicit `atomic: false` (`400 BATCH_NOT_ATOMIC`) rather than
    silently applying atomically — non-atomic per-object batches stay on
    `POST /data/:object/batch`.

  `enforceApiAccess` is refactored to share the pure `apiAccessDenialFromEnable`
  check + a `loadObjectItems` helper with the batch route (single-record behavior
  unchanged). Adds `rest-batch-endpoint.test.ts` — the REST-boundary coverage
  ADR-0034 flagged as missing (commit, `$ref`, rollback surfacing, API-access
  denial, request validation).

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
  - @objectstack/service-package@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1
- @objectstack/platform-objects@15.1.1
- @objectstack/service-package@15.1.1

## 15.1.0

### Patch Changes

- f531a26: feat(discovery): honest capabilities — standardized stub/fallback marker + realtime route honesty (ADR-0076 D12/A1.5 framework slice, #2462)

  **Spec** — new service self-description marker for honest discovery
  (ADR-0076 D12): `SERVICE_SELF_INFO_KEY` (`__serviceInfo`),
  `ServiceSelfInfoSchema` / `ServiceSelfInfo`, and `readServiceSelfInfo()`,
  which also normalizes plugin-dev's legacy `_dev: true` flag to
  `{ status: 'stub', handlerReady: false }`. A registered service that is a
  stub / dev fake / degraded fallback self-identifies via this marker; a fully
  real service carries no marker.

  **Runtime + metadata-protocol** — both discovery builders
  (`HttpDispatcher.getDiscoveryInfo` and the protocol shim's `getDiscovery`)
  now honor the marker instead of hardcoding `status: 'available',
handlerReady: true` for every registered service. Dev stubs report `stub`,
  the ObjectQL analytics fallback reports `degraded` (it keeps serving — no
  `/analytics` 404), and consumers can finally trust
  `status === 'available'` / `handlerReady === true`.

  **Realtime honesty fix** — discovery no longer advertises a
  `/realtime` route or `websockets: true`: `service-realtime` is an
  in-process pub/sub bus, no dispatcher branch or plugin mounts any
  `/realtime` HTTP surface, so the advertised route always 404'd. The
  registered service now reports `status: 'degraded', handlerReady: false`
  with no route (clients using the SDK are unaffected — it falls back to the
  conventional path, which behaves exactly as before). Also corrects the
  advertised realtime provider from the nonexistent `plugin-realtime` to
  `service-realtime`.

  **REST (A1.5)** — the REST layer's protocol dependency is narrowed from the
  `ObjectStackProtocol` god-union to the new `RestProtocol =
DataProtocol & MetadataProtocol` slice (exported from
  `@objectstack/rest`), per the ADR-0076 D9 incremental narrowing guidance.
  Type-level only; no runtime change.

- f531a26: feat(attachments): sys_file orphan lifecycle + parent-derived attachment access (#2755)

  **Orphan lifecycle (ADR-0057).** Deleting a `sys_attachment` join row used to
  orphan the backing `sys_file` row and its storage bytes forever. `sys_file`
  now declares a lifecycle (`ttl 30d` on a new `deleted_at` tombstone for
  orphans; `retention 7d onlyWhen status=pending` for abandoned uploads), the
  storage plugin's new hooks tombstone a file when its LAST join row is deleted
  (attachments scope only — `Field.file`/`Field.image`/avatar scopes are never
  touched) and un-tombstone on re-attach, and a new LifecycleService **reap
  guard** seam (`registerReapGuard`) re-verifies zero references at sweep time
  and deletes the storage bytes before confirming each row reap. A guarded
  object is never blind-deleted; an erroring guard fails safe (rows retained).

  **Attachment access (ADR-0049, Salesforce parent-derived semantics).**
  `sys_attachment` create now requires caller READ visibility of the parent
  record (403 `ATTACHMENT_PARENT_ACCESS`) and server-stamps `uploaded_by` from
  the session (client value ignored); delete requires uploader-or-parent-editor
  (403 `ATTACHMENT_DELETE_DENIED`). The storage upload routes require an
  authenticated session when an auth service is wired (401 `AUTH_REQUIRED`;
  bare kernels stay open) and stamp `owner_id` on new files.

  **REMOVED — `sys_attachment.share_type` / `sys_attachment.visibility`.**
  Both fields were modeled in v1 with zero runtime consumers (ADR-0049
  parsed-but-unenforced). There is no replacement key: attachment access is
  derived from the parent record by the hooks above. Writers of these fields
  should simply stop sending them (unknown-field validation will reject them);
  existing DB columns are left as unmanaged leftovers, no migration needed.

  `@objectstack/verify` gains `BootOptions.extraPlugins` for booting optional
  service pairs (e.g. storage + audit) in dogfood fixtures.

- f531a26: refactor(security): converge the anonymous-deny decision into one shared function + a source-enumerating ratchet (#2567 Phase 2)

  Phase 1 gated every HTTP surface (REST `/data`, dispatcher `/graphql` + `/meta`,
  raw-hono `/data`) against the secure-by-default `requireAuth` posture, but each
  seam hand-rolled the same `!userId && !isSystem → 401` check. Phase 2 removes
  that duplication and pins the surfaces so a new ungated entry point fails CI.

  - **New `shouldDenyAnonymous` in `@objectstack/core`** (`security/anonymous-deny.ts`)
    — the single anonymous-deny decision + shared 401 body/constants, mirroring the
    `auth-gate.ts` pattern (pure function so the seams can never drift). All five
    seams — REST `enforceAuth`, dispatcher `handleGraphQL` / `handleMetadata` /
    `handleAI`, hono `denyAnonymous` — now delegate to it. **Pure refactor: no
    runtime behavior change** (verified by the unchanged Phase-1 handler + e2e
    proofs). Identity resolution and the dynamic exemptions (public-form grants,
    share-link tokens) are untouched — they run upstream and only ever hand the
    seam an already-resolved context.
  - **A `discover()` ratchet on the authz-conformance matrix** — it statically
    enumerates the data/meta/graphql HTTP entry points from source (curated
    per-file probes, control-plane routes excluded) and asserts each is classified
    by a matrix `covers` key. A new `/data`/`/meta`/`/graphql` route (or a
    removed/stale `covers`) now fails CI as UNCLASSIFIED / STALE, not in review. A
    companion negative test proves the ratchet bites.

  A design trap is guarded: `isAuthGateAllowlisted(undefined)` returns `true`, so a
  body-routed seam (GraphQL, which has no request path) must pass no path — the
  shared function's non-empty-path guard denies anonymous unconditionally there,
  never falling through to the control-plane allowlist.

- f531a26: fix(authz): carry the derived posture rung on ExecutionContext (#2947)

  The ADR-0095 D2 posture ladder (`PLATFORM_ADMIN > TENANT_ADMIN > MEMBER >
EXTERNAL`) is derived once by the shared authz resolver from capability grants,
  but both HTTP/MCP entry points that build the `ExecutionContext` dropped it —
  so any enforcement-side reader of `context.posture` always saw `undefined`
  (the same drop that forced the explain layer to re-derive it, #2949).

  `ExecutionContextSchema` now carries an optional `posture` field, and both
  `rest-server` and the runtime `resolveExecutionContext` plumb the resolver's
  value through. Additive and **behavior-preserving**: no enforcement decision
  consumes `posture` yet — whether the hot path evaluates _by_ posture remains a
  larger ADR-level decision — this only stops the already-computed value from
  being discarded, so enforcement and explain read the same derived rung.

- f531a26: fix(import): make async import-job cancellation actually stop the worker (#2824)

  Cancelling a running async import used to have no effect on a synchronous
  storage driver (better-sqlite3 / wasm fallback): every `await` in the row
  loop resolved as a microtask, so a 50k-row import monopolized the Node event
  loop for minutes — the cancel route's HTTP handler (and every progress poll)
  could never run, so the in-memory flag `shouldCancel` polls was never set.
  The job then finished `succeeded` with all rows written despite the user's
  cancel.

  Three-part fix:

  - **`runImport` yields one macrotask at every progress boundary** (every
    `progressEvery` rows), so pending I/O — the cancel request, progress
    polls, any other traffic — gets serviced during a large import. This is
    the root-cause fix; it also unblocks progress polling for the wizard.
  - **The worker's `shouldCancel` now also reads the durable job row** as a
    fallback: a cancel accepted by another process (or after a restart
    dropped the in-memory flag) still stops the worker.
  - **A late cancel wins the terminal state**: the worker's final patch no
    longer overwrites the cancel route's durable `cancelled` with
    `succeeded`, and a job cancelled while still `pending` doesn't start at
    all. Counts stay truthful — they reflect what was actually written.

- f531a26: fix(rest): split multi-value fields on import so `multiple: true` columns resolve per-token (#3063)

  The bulk-import coercion (`import-coerce.ts`) resolved a reference cell as a
  single value regardless of the field's `multiple` flag: a `multiple: true`
  lookup/user cell like `张焊工;李质检` was passed whole to name resolution and
  always failed with `no <object> matches "张焊工;李质检"`, so every multi-value
  association had to be back-filled by hand in the record UI after import.

  Coercion now mirrors objectql's `isMultiValueField` predicate. A field whose
  stored value is an array — an inherently-multi type (multiselect/checkboxes/tags)
  or a multi-capable type flagged `multiple: true` (per the spec: select, lookup,
  file, image; `radio` shares select's branch and `user` shares lookup's) — has
  its cell split on the export separator (`, ` / `;` / `、` / newline) and each
  token coerced individually:

  - **lookup / user (`multiple: true`)** — resolve each name token to an id, store
    the id array; an unmatched/ambiguous token reports the **specific token**
    (`no sys_user matches "查无此人"`) instead of the whole string.
  - **select / radio (`multiple: true`)** — match each token against the options,
    store the option-value array.
  - **file / image (`multiple: true`)** — split into an id/url array.

  Single-value fields and the non-multi-capable reference types (master_detail /
  reference / tree) are unchanged — a stray `multiple: true` on them stays a
  single resolved value, matching the engine.

- f531a26: fix(security): public-form submissions can no longer forge server-managed anchors (#3022)

  The anonymous public-form surface (ADR-0056 Option A, `POST /forms/:slug/submit`)
  is authorized by the declaration-derived `publicFormGrant`, which short-circuits
  the security middleware BEFORE every write gate (CRUD, FLS, the owner anchor
  guard, the tenant CHECK). The only field-side defense was the route's
  declared-field allow-list — and a FormView with zero declared section fields
  fell back to merging the raw body wholesale, so an unauthenticated visitor
  could `POST owner_id=<victim>` (or `organization_id`, audit columns, `id`) and
  attach the record to another user or tenant — the #3004 insert-forge, with no
  credentials at all.

  Server-managed anchors are now enforced on this surface at BOTH layers, from a
  single shared definition (`PUBLIC_FORM_SERVER_MANAGED_FIELDS`, new in
  `@objectstack/spec/security`):

  - **Data layer (authoritative)** — the `publicFormGrant` branch in
    `@objectstack/plugin-security` strips `id` / `owner_id` / `organization_id` /
    `tenant_id` / audit columns / soft-delete state / `__search` from every row
    of a granted insert (batch included) before admitting the write, so the
    boundary holds no matter what any route lets through. Ownership stays NULL
    for object hooks / the first-admin bootstrap to assign, as for other
    anonymous-seeded rows.
  - **Route layer** — the submit allow-list excludes the same set
    unconditionally: an explicitly declared `owner_id` section field no longer
    passes, and the zero-declared-sections fallback keeps its documented
    all-fields behavior for business columns while refusing the managed set.
    The resolve route (`GET /forms/:slug`) drops the managed fields from the
    rendered sections and the embedded object schema so a form never collects a
    value the submit refuses, and `GET /forms/:slug/lookup/:field` refuses a
    `publicPicker` declared on a managed anchor (which would have opened
    anonymous `sys_user` search through `owner_id`).

  Authenticated writes are unaffected — this is the anonymous-surface rule only;
  `owner_id` transfer semantics for signed-in callers stay governed by the
  transfer grant (#3004 / PR #3018).

- f531a26: fix(rest): mapDataError now honors an explicit 4xx `error.status`/`error.code` carried by domain errors (#2926 ⑦). Record-scope authorization denials from plugin-sharing (status 403, code FORBIDDEN) previously degraded to a bare 400 with no machine-readable code because the generic data routes bypass sendError's status passthrough. Structured 409 envelopes (CONCURRENT_UPDATE, DELETE_RESTRICTED) keep their dedicated branches; 5xx statuses still go through the message-sanitizing heuristics.
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
  - @objectstack/service-package@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0

## 15.0.0

### Patch Changes

- a581a65: feat(plugin-security): C2-β — explain 引擎 record 粒度行级归因 (#2920)

  `explain(principal, object, operation, recordId?)` 现支持记录级解释。透传 `recordId` 时，引擎在对象级流水线之上叠加**行级归因**，全部复用 enforcement 同一批函数（explained-by-construction）：

  - **`tenant_isolation` Layer 0**：作为永远最先的层被 prepend；每层打上 `kernelTier`（`layer_0_tenant` vs `layer_1_business`），可区分「租户墙挡的」还是「业务 RLS 挡的」。
  - **每层 `record` 归因**（tenant / owd_baseline / sharing / rls）：`outcome`（admitted/excluded/not_evaluated）、有效 `rowFilter`、`matchesRecord`（用 `@objectstack/formula` 的 `matchesFilterCondition` 对同一条 FilterCondition 求值)、命中的 `rules[]`（tenant_filter/owd_baseline/ownership/record_share/sharing_rule/team/rls_policy，含 grants/via/effect）。
  - **顶层 `record` 判定**：`visible` + `decidedBy` 决定性层。读走复合行过滤匹配，写走 sharing service 的 `canEdit`（均为 enforcement 原语）。
  - **`principal.posture`**：ADR-0095 D2 档位（PLATFORM_ADMIN/TENANT_ADMIN/MEMBER/EXTERNAL）的 B2 stand-in 派生（复用 `resolveAuthzContext` 已投影的 platform_admin / org 角色证据），待 B2 合并后替换。
  - `computeRlsFilter` 重构为 `computeLayeredRlsFilter`（暴露 `{ layer0, layer1 }` 拆分）+ 薄 andCompose 包装，单一代码路径，行级归因不会与执行漂移。
  - REST `security.explain`（GET/POST）接受可选 `recordId`。

  **向后兼容**:无 `recordId` 的对象级请求输出 **byte-identical**——无 `tenant_isolation` 层、无 `kernelTier`、无 `posture`、无 `record`。

- 31d04d4: Fix the data-import automation chain (#2922). Batch `engine.insert` now fires
  `beforeInsert`/`afterInsert` once **per row** with single-record hook contexts,
  so flat-input proxies, declarative hook conditions, audit writers, and
  record-change triggers see real records instead of arrays. A new
  `ExecutionContext.skipAutomations` flag (mirrored into `HookContext.session`)
  lets callers suppress metadata-bound automation hooks and flow dispatch while
  code-registered system hooks (audit, security, sharing) still run — making the
  import wizard's "run automations & triggers" checkbox and import undo actually
  effective. The REST import default flips to running automations unless the
  request explicitly opts out (`runAutomations: false`), matching historical
  behavior.
- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/service-package@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- 607aaf4: 导出文件名本地化 + 系统字段标签内置多语言回退。

  **`@objectstack/rest` — 导出下载文件名**:`GET /data/:object/export` 的 `Content-Disposition` 不再是裸的 `<对象名>.<扩展名>`,改为「对象显示名-时间戳」:ASCII 兜底用 API 名(`filename="contracts-20260714-153045.xlsx"`),本地化标签(如中文)按 RFC 5987/6266 编码进 `filename*=UTF-8''…`(浏览器直接下载得到 `合同-20260714-153045.xlsx`)。新增导出 `exportContentDisposition(objectName, label, ext, now?)`。

  **`@objectstack/spec` — 系统字段标签回退**:ObjectQL 注册表给每个对象注入的系统字段(`owner_id`/`created_at`/`created_by`/`updated_at`/`updated_by`)只带英文标签,自定义对象又没有对应的翻译条目,导致中文界面的列表表头、导出文件、导入模板里漏出 "Owner"/"Created At" 等英文。`translateObject` 现内置这五个字段的 en/zh-CN/ja-JP/es-ES 标签表(措辞与平台生成的翻译包一致),仅当字段仍是注入的英文默认值时套用——作者自定义的标签绝不覆盖;无翻译包时也生效(`translateObject` 不再因缺 bundle 而提前返回,REST 元数据翻译路径同步放宽,缓存 ETag 本就按 locale 分键,无缓存串味风险)。

  **`@objectstack/plugin-reports` — 附件文件名**:定时报表附件的文件名清洗从「非 ASCII 全部替换成 `_`」改为按 Unicode 字母/数字保留(`\p{L}\p{N}`),中文计划名不再变成一串下划线。

  **`@objectstack/rest` — 导入接受翻译后的选项标签(导出 ↔ 导入闭环)**:导出与导入模板写出的是*翻译后*的选项标签(如 `待规划`),但导入强制转换只认作者原始 schema 的标签/值,导致用户把自己刚导出的本地化文件原样导回时 select 字段全部报 `invalid_option`。`prepareImportRequest` 新增 `localizeSchema` 钩子(REST 导入路由传入 `translateMetaItem`),把当前 locale 的翻译标签合并进字段选项作为匹配同义词——作者标签与选项 code 照常匹配,非法值照常报错,翻译失败时降级为仅作者标签匹配。新增导出 `mergeLocalizedOptionSynonyms(metaMap, localizedMetaMap)`。

- e46169c: 面向最终用户的错误消息去掉调试噪音:REST 数据路由(`mapDataError`)对沙箱 hook/action 抛错解包 `SandboxError.innerMessage`(并对丢失实例的情况正则剥离 `hook 'x' threw: Error: ` 包装,保留 `TypeError:` 等非默认错误名);客户端 SDK 的 `error.message` 不再拼 `[ObjectStack] CODE:` 前缀(code 仍在 `error.code` 上可编程读取)。控制台报错 toast 从 `[ObjectStack] hook 'pm_ref_base' threw: Error: 制作基地被…` 变为只显示业务消息本身;完整调试包装仍写入服务端日志。
- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/service-package@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/platform-objects@14.7.0
  - @objectstack/service-package@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/service-package@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Patch Changes

- 4d9dd7b: fix(rest): validate required fields in import dry-run to match the real insert

  The bulk-import dry run (`POST /data/:object/import`, `dryRun:true`) only ran cell
  coercion and reported every coercible CREATE row as ok — so a row missing a required
  NOT-NULL field with no default was green-lit, then died on the real insert with
  `NOT NULL constraint failed`. The ImportWizard shows the dry-run result, so it
  promised imports that then failed.

  Add a required-field pre-check to the shared import runner (CREATE rows only),
  mirroring the engine's insert-time validation (`objectql/record-validator.ts` +
  `applyFieldDefaults`): a required field is unsatisfied only when it has no value AND
  no default; `system`/`readonly`/`autonumber` and the engine-owned lifecycle columns
  are exempt. `ExportFieldMeta` gains `required`/`system`/`readonly`/`hasDefault`
  (populated by `buildFieldMetaMap`). Applied to both dry-run and real paths so they
  stay identical and a real insert returns a readable `<field> is required` instead of
  a raw driver error; skipped when `runAutomations` is set (a beforeInsert hook may
  populate the field).

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
  - @objectstack/service-package@14.5.0
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
  - @objectstack/service-package@14.4.0
  - @objectstack/types@14.4.0

## 14.3.0

### Minor Changes

- 2a71f48: feat(auth): admin direct user management, phone sign-in, and identity bulk import (#2766, re-scoped #2758)

  `sys_user` is managed by better-auth and its generic CRUD is suppressed, so
  until now the only way to add a teammate was the email-dependent invite flow.
  This ships three staged capabilities:

  - **Admin direct user management** — `POST /api/v1/auth/admin/create-user`
    and a wrapped `POST /api/v1/auth/admin/set-user-password` (ADR-0068
    platform-admin gate; better-auth pipeline so credentials are real). Optional
    generated temporary password (returned once, never persisted or logged) and
    a new `sys_user.must_change_password` flag enforced through the ADR-0069
    authGate (`403 PASSWORD_EXPIRED` until the user changes it). New
    `create_user` action and upgraded `set_user_password` action on the Users
    list — pure schema, no frontend changes.
  - **Phone sign-in (opt-in `auth.plugins.phoneNumber`)** — better-auth
    phoneNumber plugin, phone+password only (`POST /sign-in/phone-number`);
    OTP flows stay off until SMS infrastructure exists. Adds
    `sys_user.phone_number` (unique) / `phone_number_verified`. Phone-only
    accounts get an undeliverable placeholder email
    (`u-<random>@placeholder.invalid`, never derived from the phone number);
    all auth mail callbacks refuse placeholder recipients.
  - **Identity bulk import** — `POST /api/v1/auth/admin/import-users` accepts
    the same payloads as the generic import routes (rows/csv/xlsx, dryRun,
    upsert by email or phone) but writes every row through better-auth.
    Password policies: `invite` (reset-link email per created user; requires an
    EmailService) and `temporary` (per-row one-time passwords + forced change).
    Sync only, ≤500 rows per request; no undo; upsert updates touch profile
    fields only and can never reset an existing user's password.
    `prepareImportRequest` and the CSV/xlsx parsers moved from rest-server.ts
    to an exported `import-prepare.ts` module (behavior unchanged).

- 02f6af4: ADR-0090 follow-through wave: enforce book audience at the read layer; finish the D2/D3 cleanup the P1 rename missed.

  - **rest**: `/meta/book`, `/meta/doc`, and `/meta/book/:name/tree` now ENFORCE
    the ADR-0046 §6.7 audience model (ADR-0049 — no unenforced security
    properties): anonymous callers see only `public` books/docs;
    `{ permissionSet }`-gated books require the caller to hold the named set;
    a doc's effective audience is the union over the books that CLAIM it
    (unclaimed docs default to `org`; orphan rendering never inherits `public`).
    Gated evaluation fails CLOSED when holdings cannot be resolved. `doc`/`book`
    single-item reads bypass the shared meta cache (per-caller gate vs shared ETag).
  - **spec**: new pure helpers powering that gate — `audienceAllows`,
    `resolveDocAudiences`, `docAudienceAllows`, `resolveBookClaimedDocs`
    (+ `AudienceCaller`/`AudienceBook` types). BREAKING but ships as a `minor`
    per the launch-window convention (pre-1.0 semantics — breaking changes do
    not burn a major version number while the whole stack is in lockstep):
    `METADATA_FORM_REGISTRY` keys `role`/`profile` are gone — `position` is the
    registered form (the `position` type had LOST its form layout in the P1
    rename); `EnvironmentArtifactMetadataSchema` declares `positions` instead of
    retired `roles`/`profiles`.
  - **plugin-security**: the `security` service exposes
    `resolvePermissionSetNames(ctx)` — the same resolution as data-plane
    enforcement, for the docs gate.
  - **metadata**: artifact ingestion maps `positions → 'position'` (the stale
    `roles → 'role'` mapping matched nothing since the P1 rename, silently
    dropping compiled positions from metadata registration).
  - **lint**: books join the D3 role-word scan (their `audience` is a
    permission-model reference now), and a new advisory rule
    `security-book-audience-unknown-set` flags a `{ permissionSet }` audience
    naming a set the stack does not declare (runtime fails closed — the typo
    cost is "nobody can read the book", so say it at author time).
  - **platform-objects**: metadata-form translations regain `position` (all four
    locales) and drop the retired `role`/`profile` groups, with a vocabulary
    regression test.

- bea4b92: feat(rest): colour select/radio cells in xlsx exports with their option colour

  The data export route (`GET /data/:object/export`) now carries a select /
  radio field's option `color` into the generated Excel workbook as the cell's
  **font colour** (white cell background), so an exported sheet reads like the
  in-app coloured badges instead of plain black text. csv / json output is
  unchanged.

  - `export-format.ts` gains `toArgb()` (hex `#RGB` / `#RRGGBB` → exceljs ARGB
    `FFRRGGBB`, `undefined` for anything not plain hex) and `cellFontColor()`
    (resolves the matched select/radio option's colour for one cell; returns
    `undefined` — i.e. leave it unstyled — for non-option fields, unmatched
    values, colourless options, or invalid hex). `ExportFieldMeta.options` now
    carries the option `color`.
  - `createXlsxStream(res, useStyles)` takes the flag through to exceljs'
    `WorkbookWriter`; the route enables styling and sets `cell.font.color`
    per-cell only for xlsx.

  Styling is heavier than a bare value dump, so it is gated behind a **10 000-row
  cap** (`STYLE_ROW_CAP`): exports whose effective limit exceeds it stream
  without colours (all rows intact) and set `X-Export-Styles: dropped`; coloured
  exports set `X-Export-Styles: applied`. This mirrors the "formatted export has a
  lower ceiling than a raw dump" pattern used by Salesforce / ServiceNow. The
  existing 50 000-row hard cap is unchanged.

  Closes #2757.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/service-package@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/service-package@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/platform-objects@14.1.0
  - @objectstack/service-package@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Minor Changes

- ac08698: ADR-0090 D6 — the explain engine gets its REST face (#2696).

  **`@objectstack/rest`**: new `GET/POST /api/v1/security/explain`
  (`object`/`operation`/`userId`, validated against the spec's
  `ExplainRequestSchema`) delegating to the `security` service's
  `explain(request, callerContext)` — the same code paths the enforcement
  middleware runs, so the returned `ExplainDecision` is explained by
  construction. The route is authenticated-only (401 even on
  `requireAuth=false` deployments), returns 501 when no security service
  exposes `explain`, and maps the service's `PermissionDeniedError` to 403.
  Registered on scoped (`/environments/:environmentId`) and unscoped base
  paths; the env kernel's own `security` service is preferred, with a new
  host-kernel `securityServiceProvider` fallback wired by the REST plugin.

  **`@objectstack/plugin-security`**: `explainAccessForCaller` now honors
  delegated administration (D12) — explaining ANOTHER user is authorized by
  `manage_users` **or** a delegated `adminScope` whose business-unit subtree
  covers the target user (new `DelegatedAdminGate.scopesCoverUser`, fail-closed
  on unresolvable scopes/memberships). Self-explain still needs neither.

- bd39dc5: ADR-0090 D5/D9 — suggested audience bindings become a queryable, confirmable surface.

  A package permission set declaring `isDefault: true` is an install-time
  SUGGESTION to bind the set to the built-in `everyone` position — never
  auto-bound. Until now the flag was only read at bootstrap as the fallback-set
  name; after an install there was no way to see or act on the suggestion.

  **`@objectstack/plugin-security`**: new `sys_audience_binding_suggestion`
  system object (read-only over the data API; unique per
  package × set × anchor) plus a convergent reconciler
  (`syncAudienceBindingSuggestions`) that reads every declared `isDefault` set —
  boot-declared stack metadata AND installed package manifests, so a runtime
  `POST /api/v1/packages` install is visible immediately — and keeps the table
  honest: undeclared → pending row pruned, bound out-of-band → marked
  `confirmed` (observed). The `security` service gains
  `listAudienceBindingSuggestions` / `confirmAudienceBindingSuggestion` /
  `dismissAudienceBindingSuggestion`, all pre-gated on tenant-level admin
  (ADR-0066 superuser wildcard — anchors stay tenant-level only per D12).
  Confirm writes the `sys_position_permission_set` row **with the caller's
  execution context**, so the D5/D9 audience-anchor gate (no high-privilege
  set on `everyone`/`guest`) and the D12 delegated-admin gate enforce the
  binding; a set not yet materialized (installed this session) is first
  seeded through the same provenance-checked upsert as the boot seeder
  (ADR-0086 D4).

  **`@objectstack/rest`** and **`@objectstack/runtime`**: the HTTP surface,
  registered on both API layers (the RestServer that `objectstack dev`/hono
  serves, and the runtime HttpDispatcher used by the adapters) —
  `GET /api/v1/security/suggested-bindings?status=&packageId=`,
  `POST /api/v1/security/suggested-bindings/:id/confirm`,
  `POST /api/v1/security/suggested-bindings/:id/dismiss` (401 unauthenticated,
  403/404/409 mapped from the service's typed errors, 501/503 without
  plugin-security).

### Patch Changes

- e2fa074: feat(data): make object `enable.feeds`/`enable.activities` real opt-out gates; define the `enable.trackHistory` contract (#2707)

  `ObjectSchema.enable.{files,trackHistory,activities,feeds}` were parsed but
  (mostly) unconsumed — an author setting them got nothing, silently. Per the
  enforce-or-remove doctrine, each flag now has a defined enforcement contract:

  - `enable.activities` — opt-OUT writer gate. Spec default flips
    `false → true`; plugin-audit keeps mirroring CRUD into the `sys_activity`
    timeline unless the object declares an explicit `activities: false`
    (behavior-preserving for every existing stack; the off-switch is the
    per-object lever for activity-row growth, ADR-0057). The compliance
    `sys_audit_log` row is NOT gated.
  - `enable.feeds` — opt-OUT with server-side enforcement. Spec default flips
    `false → true`; an explicit `feeds: false` now rejects `sys_comment`
    creation targeting that object at the engine hook seam
    (403 `FEEDS_DISABLED`, fail-closed like `CLONE_DISABLED`).
  - `enable.trackHistory` — was misclassified `dead` in the liveness ledger:
    the console has gated the record History tab on it since 2026-05.
    Reclassified live with the two-grain contract documented (object flag =
    History-tab master switch; per-field `trackHistory` = diff selector; audit
    _capture_ stays unconditional as a compliance ledger).
  - `enable.files` — stays dead + authorWarn (reserved for the future generic
    Attachments panel; use `Field.file`/`Field.image` meanwhile). Its
    `describe()` now says so instead of advertising a capability that
    doesn't exist.

  The default flips can't be avoided: with `default(false)`, compiled output
  materializes `false` for every object with an `enable` block, making
  "author explicitly opted out" indistinguishable from "schema default" — so
  opt-out semantics require the default to be `true` (same posture as
  `trash`/`mru`/`clone`). Liveness ledger + reference docs regenerated;
  compile-time authorWarn now fires only for `enable.files`.

- 23c8668: feat(data): `enable.files` goes live — opt-in gate for the generic Attachments surface (#2727)

  The last dead ObjectCapabilities flag gets its enforcement contract.
  `enable.files` is opt-IN (spec default stays `false`): the generic record
  Attachments panel is a new surface, not an existing behavior.

  - plugin-audit registers a `sys_attachment` beforeInsert hook: attachment
    join rows may only target objects that explicitly declare
    `enable: { files: true }` — anything else (absent block, absent flag,
    explicit false, unknown object) rejects fail-closed with
    403 `FILES_DISABLED` (CLONE_DISABLED / FEEDS_DISABLED pattern).
  - `mapDataError` maps `FILES_DISABLED` → 403 with the gated target object
    (generic data routes bypass `sendError`'s `.status` passthrough — the
    #2707 lesson, applied at introduction time).
  - `Field.file` / `Field.image` are deliberately independent: they store
    the file URL in the record's own column and never create
    `sys_attachment` rows, so field-level attachments work regardless of
    this flag.
  - Liveness ledger: `enable.files` dead→live, authorWarn dropped —
    ObjectCapabilities is now 100% live. The compile-time
    liveness-dead-property warning no longer fires for it; `describe()` and
    the reference docs state the real contract.

  Companion objectui PR ships `RecordAttachmentsPanel` (upload/list/
  download/delete over the presigned three-step storage flow), rendered on
  record pages when the flag is true.

- 1056c5f: Package uninstall now revokes the package's data-plane permission rows (#2747, ADR-0086 D3 / ADR-0090 D5 "no ghost grants").

  **`@objectstack/metadata-protocol`**: `deletePackage` gains an
  uninstall-cleanup seam — the exact mirror of the publish materializer:
  domain plugins register named cleanups via `registerUninstallCleanup(name,
fn)` and every cleanup runs with the uninstalled package id, its outcome
  reported on the new `cleanups` array of the response (a failed revocation is
  visible, never silent). `deletePackage` also unregisters the package from
  the in-memory SchemaRegistry (best-effort), so the running kernel stops
  serving it without waiting for a restart.

  **`@objectstack/plugin-security`**: registers the
  `security.package-permissions` cleanup — deletes the package's own
  `sys_permission_set` rows (`managed_by: 'package'` + matching `package_id`
  only; env-authored and foreign-package rows are never touched, ADR-0086 D4),
  their `sys_position_permission_set` / `sys_user_permission_set` bindings
  (bindings first, so no dangling grants), and the package's
  `sys_audience_binding_suggestion` rows (a reinstall re-prompts fresh).
  Also fixes the engine-call signature in the suggestion module: `find`/`delete`
  read `context` from their second argument — the previous trailing
  `{ context }` argument was ignored, so deletes ran principal-less.

  **`@objectstack/rest`**: `DELETE /api/v1/packages/:id` (no version pin) now
  goes through `protocol.deletePackage` — one uninstall semantic instead of a
  bare `sys_packages` row delete — removing the package's metadata, durable
  record, registry entry, and running the cleanups; the response carries
  `deletedCount` + `cleanups`. A version-scoped delete keeps the narrow
  durable-registry semantics.

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
  - @objectstack/service-package@14.0.0
  - @objectstack/types@14.0.0

## 13.0.0

### Major Changes

- 6d83431: ADR-0090 P1 breaking wave — permission model v2 concept convergence.

  Pre-launch one-step renames and secure defaults (no compatibility aliases, per
  ADR-0090 D3/D4 superseding ADR-0057 D5/D7's alias discipline):

  - `sys_role` → `sys_position`, `sys_user_role` → `sys_user_position` (field
    `role` → `position`), `sys_role_permission_set` → `sys_position_permission_set`
    (field `role_id` → `position_id`); `RoleSchema`/`defineRole` →
    `PositionSchema`/`definePosition` with **no `parent`** (positions are flat;
    hierarchy lives on the business-unit tree).
  - `ExecutionContext.roles[]` → `positions[]`; the EvalUser/CEL contract
    `current_user.roles` → `current_user.positions` (formula validators updated);
    stack property `roles:` → `positions:`; metadata kinds `role`/`profile` →
    `position` (profile kind removed).
  - `isProfile` removed from `PermissionSetSchema` (ADR-0090 D2); `isDefault`
    narrows to an install-time suggestion; `appDefaultProfileName` →
    `appDefaultPermissionSetName` (isDefault-only).
  - OWD enum drops legacy aliases `read`/`read_write`/`full`; new optional
    `externalSharingModel` (external dial, `private` default) lands as P1 spec
    shape (ADR-0090 D11).
  - **Secure default (D1)**: a custom object with an owner field and NO
    `sharingModel` now resolves `private` (was: fully public). System objects
    keep their explicit posture. Unrecognised stored values fail closed.
  - ExecutionContext gains the P1 principal-taxonomy shape (D10):
    `principalKind` / `audience` / `onBehalfOf` (optional, semantics phase in
    later).
  - Sharing recipients: `role` → `position` (expanded via `sys_user_position`
    ∪ the better-auth membership transition source); `role_and_subordinates`
    removed — `unit_and_subordinates` now expands the business-unit subtree
    (finishes ADR-0057 D5's re-homing).

### Minor Changes

- 57b89b4: feat(mcp): the MCP surface is now **default-on** — a core platform capability (#2698)

  `/api/v1/mcp` is served (and advertised in `/discovery`) out of the box; the
  OAuth 2.1 authorization track and Dynamic Client Registration follow it, so a
  fresh deployment is connectable by any MCP client with zero configuration.
  Operators opt OUT with `OS_MCP_SERVER_ENABLED=false`.

  - New single decision point `isMcpServerEnabled()` in `@objectstack/types`
    (default on; explicit `false`/`0`/`off`/`no` disables). The runtime
    dispatcher's `/mcp` route gate, the CLI's MCP plugin auto-load, the REST
    `/discovery` advertisement, and the auth service's OAuth/DCR follow-defaults
    all delegate to it — the served route, the advertised route, and the
    authorization track can never disagree.
  - The env var is now effectively tri-state: unset → HTTP surface on;
    explicit `true` → additionally auto-start the long-lived **stdio** transport
    at boot (unchanged, still opt-in — a default must not claim the process's
    stdin/stdout); explicit `false` → everything off, fail-closed (404, no
    metadata, no DCR).
  - The OAuth 2.1 TLS rule is unaffected: on a plain-HTTP non-loopback origin
    the OAuth track stays dark and the default-on surface remains API-key-only.

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
  - @objectstack/service-package@13.0.0

## 12.6.0

### Minor Changes

- 21420d9: Seed loader and data-import now route bulk writes through the engine's array-form `insert()` (one round-trip per batch, with parent-deduplicated summary recompute) instead of one `insert()`/`createData()` call per record, and both retry transient driver errors instead of silently dropping the row (#2678).

  A new shared helper, `bulkWrite` (`@objectstack/core`), batches rows through a caller-supplied batch-write function, retries a whole-batch transient failure (network blip / timeout) with exponential backoff, and degrades to per-row writes (each itself retried) when a batch fails for a non-transient reason — so one bad row can't drop the other N-1. `withTransientRetry` wraps a single write (e.g. an update) with the same retry behavior.

  - `SeedLoaderService.loadDataset()` (`@objectstack/metadata-protocol`) buffers insert-mode records and flushes them in batches of 200 via the engine's array `insert()`. Datasets with a self-referencing field (e.g. `employee.manager_id -> employee`) keep the historical per-record write path, since a later record may need an earlier one's freshly-assigned id.
  - `runImport()` (`@objectstack/rest`) buffers create-resolved rows and flushes them via `protocol.createManyData()` when the protocol supports it, falling back to the original per-row `createData()` call otherwise. `Protocol.createManyData` (`@objectstack/metadata-protocol`) now forwards `context` to `engine.insert()` like `createData` already did, so tenant-scoped bulk creates work correctly.

  Previously, a 1000-row seed or import into an object with a rollup summary issued 1000+ round-trips and up to 1000 summary recomputes; a single transient network error on any one row silently dropped it with no retry (the 2026-07-06 HotCRM first-boot incident). A `bulkCreate`-capable driver now sees roughly `ceil(N/batch)` writes, and a transient error is retried before a row is ever reported as failed.

  **Fix (`@objectstack/driver-sql`):** `SqlDriver.bulkCreate()` never generated a client-side id for a row missing one, unlike `create()` — a latent gap that this change is the first to exercise at scale (a bulk-inserted row without a driver-native id default silently landed with `id: NULL`). `bulkCreate()` now mirrors `create()`'s id/`_id` normalization per row.

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/platform-objects@12.6.0
  - @objectstack/service-package@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/platform-objects@12.5.0
  - @objectstack/service-package@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/platform-objects@12.4.0
  - @objectstack/service-package@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/platform-objects@12.3.0
  - @objectstack/service-package@12.3.0

## 12.2.0

### Minor Changes

- fce8ff4: feat(rest,spec): named import mappings (#2611) — `POST /data/:object/import` accepts `mappingName`, resolving a registered `defineMapping` artifact (stack `mappings:`) and applying its fieldMapping pipeline (rename + constant/map/split/join; lookup delegates to the built-in reference resolution) as a strict projection before coercion. The artifact's `mode`/`upsertKey` serve as writeMode/matchFields defaults; explicit request values win. Errors are loud and specific: `MAPPING_NOT_FOUND`, `MAPPING_TARGET_MISMATCH`, `MAPPING_FORMAT_MISMATCH`, `CONFLICTING_MAPPING` (mutually exclusive with the inline rename), and `UNSUPPORTED_TRANSFORM` for `javascript` (no server-side sandbox — never silently skipped). `defineStack` cross-reference validation now rejects mappings targeting undefined objects and `javascript` transforms at build time.

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
  - @objectstack/service-package@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/platform-objects@12.1.0
  - @objectstack/service-package@12.1.0

## 12.0.0

### Major Changes

- 7c09621: feat(security)!: `api.requireAuth` now defaults to `true` — anonymous access to the data API is denied by default (ADR-0056 D2 flip)

  **BREAKING.** The global `requireAuth` default flipped FROM `false` TO `true`
  (`RestApiConfigSchema.requireAuth` in `@objectstack/spec`, mirrored by
  `RestServer.normalizeConfig` in `@objectstack/rest`). Anonymous requests to
  the `/data/*` CRUD + batch endpoints are now rejected with HTTP 401 unless the
  deployment explicitly opts out. (Scope note: this gate covers the REST
  `/data/*` surface — the metadata read/write endpoints and the dispatcher
  GraphQL route have their own pre-existing anonymous posture, tracked
  separately; this flip does not change them.)

  **Migration (one line):** a deployment that intentionally serves data publicly
  (demo / playground / kiosk) sets the flag on the stack config — now a declared
  `ObjectStackDefinitionSchema.api` field, so it survives `defineStack` strict
  parsing (previously an undeclared top-level `api` key was silently stripped):

  ```ts
  export default defineStack({
    // …
    api: { requireAuth: false },
  });
  ```

  The REST plugin logs a boot warning for the explicit opt-out so a fail-open
  posture is always visible. A misplaced `api.requireAuth` at the plugin level
  (one nesting short) is now also called out with a boot warning instead of
  being silently ignored.

  **What keeps working with no action:**

  - **Share links** — validate their token, then read under a system context.
  - **Public forms** — self-authorizing via the declaration-derived
    `publicFormGrant` (create + read-back on the declared target object only);
    no `guest_portal` profile needed.
  - **Control plane** — `/auth`, `/health`, `/discovery` are exempt.
  - **`objectstack serve` with an auth-less stack** — the CLI passes an explicit
    `requireAuth: false` for stacks whose tier set has no `auth` (nothing could
    authenticate against them), with the boot warning.

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
  - @objectstack/service-package@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/platform-objects@11.10.0
  - @objectstack/service-package@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/platform-objects@11.9.0
  - @objectstack/service-package@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/service-package@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/service-package@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/platform-objects@11.6.0
- @objectstack/service-package@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/platform-objects@11.5.0
  - @objectstack/service-package@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/service-package@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/service-package@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/service-package@11.2.0

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

### Patch Changes

- 9ccfcd6: perf(core): authenticated requests issued ~16 sequential queries — duplicate authz + repeated localization — now request-scoped memoized

  An authenticated REST request resolves its execution context (identity +
  RBAC/RLS + localization) many times in a single handler — the data operation
  itself, app-nav RBAC filtering, dashboard widget gating, the ADR-0069 auth gate.
  Each `resolveExecCtx` pass is the full `resolveAuthzContext` aggregation plus the
  localization read (~16 sequential queries), and nothing memoized it, so a request
  that resolves twice paid for duplicate authz and repeated localization.

  - **`@objectstack/rest`** — `resolveExecCtx` is now memoized per request, keyed by
    the request object (a `WeakMap`, so the entry is collected with the request — no
    TTL, no cross-request leak) and the input `environmentId`. The in-flight Promise
    is cached so concurrent callers share one resolution. The heavy path moved to
    `computeExecCtx`. Anonymous (`undefined`) resolutions are cached too.
  - **`@objectstack/core`** — within a single `resolveAuthzContext` pass, `sys_user`
    is now read at most once (the email fallback and the `ai_seat` synthesis shared a
    duplicate query on the API-key path); `resolveLocalizationContext`'s direct-read
    fallback batches `timezone`/`locale`/`currency` into one `sys_setting` query
    (`$in` on `key`) instead of three sequential reads.

  No authorization-behavior change — the same roles/permissions/RLS context is
  resolved, just without the redundant reads. The `sys_member` reads (per-user roles
  vs. all-org-members) are intentionally left distinct (different filters/limits).

  Tests: query-counting regressions assert `sys_user` reads once and localization
  reads once; new rest-server tests pin the per-request/per-environment memo contract.

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/service-package@11.1.0

## 11.0.0

### Patch Changes

- 359c0aa: fix(objectql,rest): single-item meta reads must revalidate (no `max-age=3600`)

  `GET /api/v1/meta/object/:name` (and the other single-item meta reads served by
  the cached path) sent `Cache-Control: public, max-age, max-age=3600`. Two bugs:

  1. **Stale metadata for up to an hour.** Object metadata is invalidated by
     publish, but a one-hour TTL let browsers (and any CDN/proxy) serve a stale
     schema _without revalidating_ — e.g. the AI-build "New" create form kept
     rendering pre-publish fields until the TTL lapsed. The list endpoint
     `GET /api/v1/meta/object` is uncached, which is why list views updated but
     single-object reads didn't. `getMetaItemCached` now returns
     `directives: ['private', 'no-cache']` with no `maxAge`, so the ETag validator
     (which already changes on publish) gates freshness: a cheap `304` when
     unchanged, fresh fields the instant a publish bumps the ETag. `private` also
     keeps per-tenant metadata out of shared caches.

  2. **Malformed header.** The directives array carried a bare `max-age`
     placeholder _and_ the REST layer appended `max-age=3600` from the `maxAge`
     field, concatenating into `public, max-age, max-age=3600`. The header builder
     now strips the bare `max-age` token before appending the real value, so a
     `maxAge` is emitted once as a well-formed `max-age=N`.

- 9a810f8: fix(rest): register static data-action routes before the greedy `:object/:id` matcher

  The REST router matches first-registered-wins with no specificity sorting, but
  `registerDataActionEndpoints` (which holds `GET /data/:object/export`) ran AFTER
  `registerCrudEndpoints` (which holds the greedy `GET /data/:object/:id`). A
  request to `GET /data/<object>/export` was therefore captured by `:object/:id` —
  `"export"` treated as a record id — returning `404 RECORD_NOT_FOUND` instead of
  streaming the export. The data-action registration now runs first, mirroring the
  existing `/meta/:type/:name/references`-before-`/meta/:type/:name` convention.
  Reordering is safe both ways: `registerDataActionEndpoints` contains no greedy
  2-segment `:object/:id` routes, so it cannot shadow any CRUD literal. A
  regression test asserts the export route registers ahead of the get-by-id route.

- a619a3a: fix(setup): first-run admin polish — pin Company/Localization, gate dashboard widgets by `requiresService`, i18n + settings PUT envelope

  Dogfooding the Setup app as a brand-new system administrator surfaced a cluster of small first-run gaps, now fixed:

  - **platform-objects**: pin **Localization** and **Company** in the Setup sidebar's Configuration group — both are registered `service-settings` manifests (the two lowest-`order` Workspace settings) but were reachable only via the "All Settings" hub. Translate the previously-English nav labels Cloud Connection (云连接), Datasources (数据源) and Capabilities (能力). Tag the System Overview `widget_organizations` KPI with `requiresService: 'org-scoping'`.
  - **rest**: extend the ADR-0057 D10 server-side visibility gate to **dashboard widgets** — strip widgets whose `requiresService` names an unregistered kernel service (mirrors the existing app-nav gate; `resolveRegisteredServices` now also discovers gates declared on widgets). In a single-tenant runtime this removes the orphan "Organizations" KPI, matching the already-hidden org nav entries.
  - **service-settings**: add the missing zh `help` strings for the Localization manifest (number/currency/first-day-of-week/fiscal-year fields), and accept the `{ values: { … } }` envelope on `PUT /api/settings/:ns` symmetrically with what `GET` returns.

- aa33b02: fix(security): single-source the request authorization resolver — REST no longer drops sys_user_position

  The REST server and the runtime dispatcher each carried their own copy of the request → ExecutionContext identity/role resolver, and they drifted on a security path. The REST copy silently omitted `sys_user_position` (so custom roles granted via the ADR-0057 D4 platform-RBAC path did not apply over REST), `sys_position_permission_set`, the `owner→org_owner` membership normalization, the platform-admin derivation, and the `ai_seat` synthesis — fail-closed (legitimate access denied), not an escalation.

  Both entry points now delegate to a single shared resolver, `resolveAuthzContext` in `@objectstack/core/security` (joining the API-key verifier that already lived there). A contract test locks every authorization source and a lint gate (`check:authz-resolver`) prevents a future duplicate resolver or a dropped delegation.

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
  - @objectstack/service-package@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/service-package@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/service-package@10.2.0

## 10.1.0

### Patch Changes

- 517dad9: Schema drift detection + `os migrate` for non-additive metadata changes (#2186).

  The metadata→DB schema sync was additive-only: it created tables and added
  columns but never altered/dropped existing ones, so relaxing `required`,
  changing a type/length, or dropping a field silently diverged from an existing
  database. The physical column won at write time, surfacing a misleading
  `organization_id is required` 400 even though `/meta` reported the field
  optional.

  - **driver-sql** — the SQL driver now detects managed-schema drift (metadata is
    the source of truth) and categorises each divergence `safe` / `needs_confirm`
    / `destructive`. `initObjects` warns once per divergence with an actionable
    hint. A new opt-in `SqlDriverConfig.autoMigrate: 'safe'` auto-applies the
    _loosening_ subset (relax `NOT NULL`, widen varchar) so an existing dev DB
    self-heals on restart — never destructive, force-disabled under
    `NODE_ENV=production`. New public methods `detectManagedDrift()` /
    `applyMigrationEntries()`. SQLite reconciles via the official table-rebuild
    (copy → swap), preserving data; Postgres/MySQL alter in place.
  - **cli** — new `os migrate plan` (dry-run, categorised diff) and
    `os migrate apply` (`--allow-destructive` for drops/tightenings, confirm gate,
    `--json`). `os dev`/`serve` now pass `autoMigrate: 'safe'` in dev only.
  - **rest** — a `NOT NULL` violation that reaches the driver (metadata validation
    already passed) now carries a drift-aware `hint` pointing at `os migrate`,
    instead of only the misleading "field is required" message. The
    `VALIDATION_FAILED` / `fields` envelope is unchanged for back-compat.

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/service-package@10.1.0

## 10.0.0

### Minor Changes

- 2256e93: Setup nav: gate Organizations/Invitations on multi-org; enforce `requiresService` server-side (ADR-0057 addendum D10).

  `rest-server`'s `filterAppForUser` now honours `NavigationItem.requiresService` — entries
  whose named kernel service isn't registered are dropped from the served app metadata
  (fail-open when the kernel can't be probed; previously the field was a frontend-only hint).
  Applies `requiresService: 'org-scoping'` to the Setup app's Organizations and Invitations
  entries, so they surface only in multi-org (multi-tenant) deployments and disappear in
  single-tenant. Business Units is intentionally left ungated — it is open per the open/paid
  seam + D12 ("pick people by BU"); only the hierarchy rollup capability is enterprise.

- 220ce5b: Resolve the tenant default currency onto ExecutionContext.

  Adds `ExecutionContext.currency` (ISO 4217) and resolves it from the
  `localization.currency` setting alongside `timezone`/`locale` — in both the
  runtime `resolveExecutionContext` and the REST mirror. This is the foundation
  for the documented "applied when a currency field omits its own" fallback: the
  tenant default is now carried on every request context, so analytics enrichment,
  formatters, and renderers can resolve a measure/field currency down to the org
  default instead of hard-coding it. Undefined when no tenant default is
  configured (consumers then render a plain number).

### Patch Changes

- 3754f80: Fix: the Setup-nav capability gate (`requiresService`, ADR-0057 D10) was a no-op on the single-item app-meta path.

  `GET /meta/app/:name` returns a metadata envelope `{ type, name, item: <app>, ... }`, but
  `filterAppForUser` was applied to the envelope — whose `.navigation` is undefined — so it
  returned it untouched, silently bypassing BOTH the `requiredPermissions` gate and the D10
  `requiresService` gate. Organizations/Invitations therefore still appeared in the Setup app
  even in single-tenant deployments. `filterAppForUser` and `resolveRegisteredServices` now
  unwrap the envelope (the list path already passed the raw app). Verified against a live
  `os dev`: single-tenant hides Organizations/Invitations; multi-tenant shows them.

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
  - @objectstack/service-package@10.0.0

## 9.11.0

### Patch Changes

- e7f6539: feat(rest): warn on fail-open anonymous posture (ADR-0056 D2, warn→enforce)

  Secure-by-default work for the data API. The deny capability already exists
  (`api.requireAuth=true` rejects anonymous via `enforceAuth`, and share-link /
  `guest_portal` / control-plane routes are exempt) — but the **default is fail-open**
  (`requireAuth=false`), so an object with no OWD/RLS is world-readable with no signal.
  This adds a boot-time WARN when running in that posture, making it explicit
  (consistent with D4/D8 honesty). The global default is deliberately NOT flipped here
  — that is a release-gated decision; flipping it would 401 deployments that rely on
  anonymous reads. Proven by the `showcase-anonymous-deny` dogfood test (anonymous
  read+write → 401, authenticated → 200, control-plane open).

- 751f5cf: feat(security): declaration-derived public-form authorization (ADR-0056, Option A)

  Public form submissions are now authorized by the **declaration**, not by a
  deployment-configured `guest_portal` profile. The form-submit route derives a narrow
  `publicFormGrant: { object }` from the matched form's target object; the SecurityPlugin
  honors it as a least-privilege capability — **create + the immediate read-back on THAT
  object only**, with no userId, and crucially NOT the anonymous fall-open. This makes
  public forms work under secure-by-default (`requireAuth`) **without** a hand-configured
  `guest_portal`, scoped to exactly the declared object (the field allow-list is still
  enforced at the route; `guest_portal`/`anonymous` are kept on the context for back-compat
  with guest-detection hooks). It is the prerequisite that unblocks the eventual
  `requireAuth` default flip, and generalizes the platform principle "public access =
  declared + runtime-derived scoped grant" (the same shape share-links already use).
  Proven by `form-self-auth` dogfood (create on target allowed; cross-object + update/delete
  denied). plugin-security 108, rest 121, full dogfood 98 — no regression.

- 2afb612: feat(security): resolve `current_user.email` in RLS owner policies

  RLS `using` predicates can now reference **`current_user.email`** — a unique,
  human-readable, _seedable_ owner anchor (`owner = current_user.email`). Previously
  the RLS compiler resolved only `current_user.id` / `organization_id` / `roles` /
  `org_user_ids`, so any owner-by-name/email predicate silently compiled to the
  deny sentinel (fail-closed → the user saw nothing). Email is sourced for free
  from the auth session (with a bounded `sys_user` fallback for the API-key path)
  and threaded onto the `ExecutionContext` in both identity resolvers — the REST
  data path (`rest-server`) and the dispatcher path (`resolve-execution-context`).

  Display `name` is deliberately **not** exposed to RLS: names collide, and a
  collision on an ownership predicate is an access-control leak. Only unique
  identifiers (`id`, `email`) are resolvable.

  This makes owner-scoped row-level security work with seed data (no per-user ids
  needed) and, combined with `controlled_by_parent` (ADR-0055), lets a master's
  owner scoping flow to its detail records. The example-showcase demonstrates it:
  `showcase_invoice` carries an `owner` email + an owner RLS policy, its lines are
  controlled-by-parent, and invoices/lines are seeded per owner. It also fixes the
  showcase's previously inert owner predicates (they used `==` and `current_user.name`,
  neither of which the compiler accepts) to `= current_user.email`.

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
  - @objectstack/service-package@9.11.0

## 9.10.0

### Patch Changes

- fd07027: fix(analytics): make organization timezone actually drive date-dimension bucketing (ADR-0053 Phase 2, #1982)

  Date-bucketed analytics silently ignored the reference timezone end-to-end. Three independent seams were broken:

  - **service-analytics** — `NativeSQLStrategy` (priority 10) won every cube/dataset query on a SQL driver, but it groups by the raw column (no `date_trunc`) and ignores `timezone`, so a date dimension never bucketed (one row per raw timestamp) and a non-UTC zone was dropped. It now declines queries that carry a `timeDimensions[].granularity`, handing them to `ObjectQLStrategy` → `engine.aggregate` (native bucketing when UTC-safe, uniform in-memory bucketing when non-UTC).
  - **objectql** — the in-memory `count` aggregation treated the `*` count-all sentinel (the Cube `count` measure / a fieldless dataset `count`, both compiled to `sql: '*'`) as a column name, counting non-null of a non-existent property → `0` for every bucket. The driver's `COUNT(*)` masked it; the in-memory path (non-UTC date buckets, `driver-rest`/`driver-memory`) returned zeros. `*` is now counted as all rows.
  - **rest** — `resolveExecCtx` never resolved the localization timezone/locale, so `/analytics/dataset/query` always ran with `timezone: 'UTC'`. It now resolves them through the `settings` service (honouring the 4-tier cascade incl. the `OS_LOCALIZATION_TIMEZONE` env override), mirroring the dispatcher path.

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/service-package@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/service-package@9.9.1

## 9.9.0

### Minor Changes

- 44c5348: fix: two runtime gaps found by driving the CRM example end-to-end.

  **Delete of a parent with a required-FK child no longer fails with a misleading "<field> is required" error.** `cascadeDeleteRelations` defaulted a `lookup` FK to `set_null`; for a _required_ FK that issued an UPDATE clearing the column, which the child's validator rejected with a `400 "<field> is required"` naming a field that isn't even on the object being deleted (e.g. deleting a `crm_account` with opportunities → `"account is required"`). A required FK can't be nulled, so a _defaulted_ `set_null` now escalates to `restrict`: the delete is refused with a clear `409 DELETE_RESTRICTED` carrying the dependent object + count (`"Cannot delete crm_account (…): 4 dependent crm_opportunity record(s) reference it via account … set deleteBehavior:'cascade'"`). Explicit `cascade`/`restrict` and optional (nullable) lookups are unchanged.

  **Removed the hardcoded `POST /data/lead/:id/convert` endpoint + `convertLead` protocol method.** It hardcoded bare object names (`lead`/`account`/`contact`/`opportunity`) and a fixed Salesforce field mapping into the framework runtime, so it was unreachable by any real (namespaced) app — `/data/crm_lead/:id/convert` 404s, and the literal `lead` object doesn't exist. Lead conversion is an app concern modeled correctly as a flow (the CRM ships a `crm_convert_lead_wizard` screen flow); baking a CRM-specific workflow into the framework was false surface. Untested, undocumented, unused by the example. Removed.

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
  - @objectstack/service-package@9.9.0

## 9.8.0

### Minor Changes

- 7fe0b91: feat(rest): enforce object-level API exposure (`enable.apiEnabled` / `enable.apiMethods`) on the REST data surface (ADR-0049 #1889). Previously these flags were parsed but unenforced — an object could not be hidden from the automatic API, a false sense of security. Now: `apiEnabled: false` → the object's `/api/v1/data/{object}` routes return 404 (existence not revealed); a non-empty `apiMethods` whitelist → operations outside it return 405. Enforced across list/get/create/query/update/delete/import/export/batch/createMany/updateMany/deleteMany. Default-allow (objects with no `enable` block, or `apiEnabled` unset/true and no `apiMethods`) behave exactly as before — no regression. This is the _external_ API boundary only; internal callers (hooks, flows, objectql) are unaffected.
- 884bf2f: feat: record clone — wire the `object.enable.clone` capability to a real runtime (previously a parsed-but-dead flag).

  - **objectql**: new `protocol.cloneData({ object, id, overrides?, context? })` — reads the source record, drops engine-owned columns (`id` + audit `created_at`/`created_by`/`updated_at`/`updated_by`, plus `system`-flagged, `autonumber`, `formula` and `summary` fields) so the insert path re-derives them, applies caller `overrides` last, and inserts the copy. Shallow by design (duplicates the record's own fields, not its child records). Gated by `schema.enable.clone`: default-on, an explicit `enable.clone === false` throws `403 CLONE_DISABLED`.
  - **rest**: new `POST /api/v1/data/:object/:id/clone` (201 → `{ object, id, sourceId, record }`). Optional body `{ overrides }` (or a bare field map) overrides copied values, e.g. a new `name` or a cleared unique field. Honors the same auth + `enable.apiEnabled`/`apiMethods` gates as the rest of the data surface; `enable.clone === false` → 403.

  Reclassifies `object.enable.clone` `dead → live` in the spec liveness ledger.

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/service-package@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/service-package@9.7.0

## 9.6.0

### Minor Changes

- 71578f2: feat(book): documentation navigation as a `book` element — spine + derived membership (ADR-0046 §6)

  Adds the `book` metadata element: a navigation **spine** (ordered groups + `audience` + identity) whose membership is **derived** by rule (`include` glob/tag) plus optional per-doc `order`/`group`, never a central array. This keeps AI authoring create-and-forget (no central-array read-modify-write) and runtime overlay merge-safe (RFC 7396 treats arrays atomically).

  - `BookSchema` + `resolveBookTree()` derived-membership resolver + `defineBook()` + additive `doc.order`/`doc.group`.
  - Register `book` as a render-time metadata type (`allowOrgOverride: true`); wire it through the runtime type enumerations (PLURAL_TO_SINGULAR, engine registration, artifact field map, type-schema map).
  - REST `GET /meta/book/:name/tree` resolves the tree; read-layer `audience` gating (`public` ≡ anonymous; `org`/`{profile}` require sign-in).

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/service-package@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/service-package@9.5.1

## 9.5.0

### Minor Changes

- d08551c: feat(ADR-0046): per-locale documentation content (doc i18n)

  Docs can now ship localized bodies. Authors add sibling locale-variant files
  `src/docs/<name>.<locale>.md` (e.g. `crm_lead_guide.zh.md`, `..pt-BR.md`) next
  to the base `<name>.md`; the base stays the default and the fallback. Flatness is
  preserved — variants are flat siblings, not subdirectories.

  - **spec**: `DocSchema` gains an optional `translations` map
    (`locale → {label?, description?, content}`) plus `resolveDocLocale(doc, locale)`,
    which collapses a doc to the best-matching locale (exact → primary subtag
    `zh-CN`→`zh` → base) with per-field fallback and strips the `translations` map.
  - **cli (collect-docs)**: variant files are folded into the base doc's
    `translations`; orphan/duplicate variants and the v1 MDX/image bans are linted
    on variant content too.
  - **rest**: `/meta/doc` (list + single) resolves the request locale from the
    existing `Accept-Language` / `?locale` negotiation, returns one localized body,
    and never ships the `translations` map. Doc detail bypasses the response cache
    so a language switch can't return a stale-locale body.
  - **setup / studio**: the built-in overview docs now ship `zh` translations
    (TS-first inline `translations`), so a Chinese console renders Chinese docs.

  The console already sends the active UI language as `Accept-Language`, so doc
  content localizes on a language switch with no client change.

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/service-package@9.5.0

## 9.4.0

### Minor Changes

- 0856476: feat(metadata): package-scoped single-item resolution via `?package=` (ADR-0048)

  A single-item metadata GET (`/meta/:type/:name?package=<id>`) now resolves
  package-scoped (prefer-local): when two installed packages ship an item of the
  same `type`/`name`, the requester's own package wins. Previously only the _list_
  endpoint was package-aware; a single-item fetch was context-free, so a
  cross-package collision always resolved to whichever package registered first.

  The fix threads `packageId` end-to-end:

  - `@objectstack/rest` — the cacheable single-item path called `getMetaItemCached`
    (ETag keyed on type+name only) and dropped `?package=`. A `?package=` read now
    bypasses that cache and takes the disambiguating `getMetaItem(type, name,
packageId)` path, so two same-named items never share one cache entry.
  - `@objectstack/objectql` — `protocol.getMetaItem` forwards `packageId` to the
    overlay query (`sys_metadata.package_id`), `MetadataFacade.get`, and
    `registry.getItem`; `MetadataFacade.get` gained an optional `currentPackageId`.
  - `@objectstack/runtime` — the parallel HTTP dispatcher threads `?package=` too.

  This lets the doc viewer (`/apps/:packageId/docs/:name`) resolve one doc scoped
  to its app, so `doc` names no longer need a namespace prefix for uniqueness (the
  prefix becomes a recommended convention, like `page`/`dashboard`/`report`);
  `doc.zod` doc-comments updated accordingly.

### Patch Changes

- 3e675f6: fix(metadata): package-scope the layered (Studio editor) read via `?package=` (ADR-0048)

  The `?layers=true` single-item read (the Studio metadata editor's 3-state
  code/overlay/effective view) ignored `packageId`, so editing one of two
  same-named items from different packages resolved ambiguously (first match).

  - `protocol.getMetaItemLayered` now threads `packageId` into the code layer
    (`metadataService.get` + `lookupArtifactItem` + `registry.getItem`) and the
    `sys_metadata` overlay query (`package_id` prefer-local).
  - `registry.getArtifactItem(type, name, currentPackageId?)` and
    `lookupArtifactItem` gained the optional package-scope hint.
  - `rest-server` threads `?package=` into the layered branch.

  This completes the per-route package-scoped resolution audit: the runtime
  render surface (dashboard/report/page/doc) was already scoped; this closes the
  Studio editor (`/apps/:appName/metadata/:type/:name`). Frontend counterpart
  sends `?package=` from the metadata list row's owning package.

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/service-package@9.4.0

## 9.3.0

### Minor Changes

- 290f631: ADR-0044 flow-level send-back-for-revision (#1744). The approval node gains a third flow movement beyond approve/reject: `sendBack()` finalizes the pending request as `returned` (new `ApprovalStatus`), resumes the run down its `revise` edge to a wait point where the record lock releases, and the submitter's `resubmit()` re-enters the approval node over a declared back-edge, opening the next round's request (fresh approver slate, re-locked, `round` stamped via the config snapshot). Engine: `FlowEdgeSchema.type` gains `'back'` — cycle validation now requires the graph _minus_ back-edges to be a DAG (unmarked cycles still rejected), node re-entry overwrites outputs/appends steps, a 100-re-entry runaway guard backstops misauthored loops, and `cancelRun(runId, reason)` lands as the first run-cancel primitive (recall crossing a revise window cancels the parked run). `maxRevisions` (default 3) on the approval node config auto-rejects send-backs past the budget. REST: `POST /approvals/requests/:id/revise` and `/resubmit`. Audit kinds `revise`/`resubmit` join `ApprovalActionKind` and the `sys_approval_action` enum.
- 50b7b47: Approvals server-side pagination + search pushdown (#1745). `listRequests` accepts `q` / `limit` / `offset` — free-text search pushes into the engine query as an `$or` of `$contains` terms (the `payload_json` snapshot carries record titles, so titles match without a join), and the page window pushes down whenever the filter is fully pushable; approver/status-array filters still post-filter their bounded scan and window in memory (the documented residual until the approver join-table follow-up). New `countRequests` returns the unwindowed total (engine `count` when pushable). REST: `GET /approvals/requests` gains `q`/`limit`/`offset` and returns `{data, total}` when paging.
- f8684ea: Approvals thread interactions — the collaboration layer between submit and decide. `reassign()` hands a pending-approver slot to someone else (audit-first ordering, new approver notified via the optional `messaging` service), `remind()` nudges every pending approver with a 4h per-request throttle (`THROTTLED` → HTTP 429), `requestInfo()` sends a request back to the submitter for more material while it stays pending, and `comment()` adds free-form thread replies. Rows expose `sla_due_at` (`created_at + escalation.timeoutHours`, display-only) and single reads attach `flow_steps` (the owning flow's approval trunk with done/current/upcoming states). REST grows the four matching POST routes; the `sys_approval_action.action` enum gains the new kinds.

### Patch Changes

- b08d08d: ADR-0046: `GET /meta/doc` list responses omit `content` by default (`?include=content` opts back in; `GET /meta/doc/:name` always returns the full body). The runtime dispatcher's `/metadata/doc` route already slims docs (#1789) — this applies the same rule on the REST `/meta/:type` route the console actually reads, keeping unbounded manuals off the list surface.
- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/service-package@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/service-package@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/service-package@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/service-package@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/service-package@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/service-package@8.0.1

## 8.0.0

### Minor Changes

- 345e189: Robust multi-write transactions (ADR-0034). `engine.transaction()` now establishes an ambient transaction (AsyncLocalStorage) so every data operation during the callback — including internal reads performed while a write runs — binds to the active transaction's connection instead of asking the pool for another one and deadlocking on SQLite's single-connection pool. Adds a cross-object transactional batch endpoint (`POST /api/v1/data/batch`) with intra-batch `{ $ref: <opIndex> }` parent references, so a parent and its children can be created atomically in one transaction.

### Patch Changes

- 0a6438e: perf(rest): cache hostname→environment resolution; document cluster pub/sub durability (P1-4, P1-5)

  - **rest (P1-4):** `resolveByHostname()` ran on every unscoped request — a
    control-plane lookup (typically a DB query) in the hot path. `RestServer` now
    caches `hostname → environmentId` in-memory with a 30s TTL across all three
    resolution sites, caching negative results too so unknown hosts don't hammer the
    registry. Registry errors are not cached, so a transient blip self-heals.
  - **service-cluster-redis (P1-5):** recorded the durability contract for
    `metadata.changed` in `pubsub.ts`. Redis pub/sub is at-most-once **by design**;
    the event is a cache-invalidation hint only — the durable source of truth is the
    transactional `sys_metadata` (+ `sys_metadata_history`) write, so a missed event
    causes a stale cache until the next reload, never data loss. No code change to
    the delivery semantics; risk accepted and documented.

- ae7fb3f: fix(rest): advertise `routes.mcp` in /discovery when MCP is enabled (cloud#152)

  The objectui Integrations page reads `discovery.routes.mcp` to show the "Connect
  an AI agent" card, but it stayed absent on live envs even with MCP enabled. Root
  cause (NOT a cache, as first suspected): `@objectstack/rest` serves its OWN
  `/discovery` (`protocol.getDiscovery()`), separate from the dispatcher's
  `getDiscoveryInfo` where the `mcp` field was added — so the REST-served discovery
  never advertised it.

  The REST discovery handler now adds `routes.mcp` (pointing at the unscoped
  `/api/v1/mcp`, since the MCP route is mounted bare) when
  `OS_MCP_SERVER_ENABLED=true`, and omits it otherwise — mirroring the dispatcher
  discovery and the opt-in gate. 2 tests (enabled → advertised, disabled → absent).

- c262301: fix(rest): REST data API honors sys_api_key — one shared verifier with MCP (closes #1633)

  Staging e2e found the MCP surface authenticated a `sys_api_key` but the REST data
  API (`@objectstack/rest`) returned 401 for the same key — its `resolveExecCtx`
  only checked the better-auth session, never the API key.

  Converged both surfaces onto ONE verifier so they can't drift:

  - **`@objectstack/core/security`** now owns the shared `sys_api_key` primitives
    (`hashApiKey`, `generateApiKey`, `extractApiKey`, `parseScopes`, `isExpired`)
    plus a new `resolveApiKeyPrincipal(ql, headers, nowMs?)` that hashes the
    inbound key, looks it up by the indexed at-rest hash, and rejects unknown /
    revoked / expired / owner-less keys (fail-closed). `core` is the natural home:
    both `rest` and `runtime` depend on it, it depends on neither (no cycle), and
    it's server-side (already uses `node:crypto`).
  - **`@objectstack/runtime`** — `security/api-key.ts` re-exports the primitives
    from core (stable import surface) and `resolveExecutionContext` now delegates
    its API-key branch to `resolveApiKeyPrincipal`.
  - **`@objectstack/rest`** — `resolveExecCtx` resolves the data engine once and
    tries `resolveApiKeyPrincipal` (x-api-key / `Authorization: ApiKey`) BEFORE the
    session, so `/api/v1/data` + `/api/v1/meta` now authenticate an API key under
    the key's permissions + RLS, exactly like the dispatcher/MCP path.

  Tests: core `api-key.test.ts` (primitives + verifier: valid / revoked / expired /
  unknown / owner-less / plaintext-not-matched / fail-closed-ql). runtime + rest
  suites green.

- e1478fe: fix(rest): map schema-mismatch & not-null driver errors to structured 4xx

  `mapDataError` collapsed any SQL-looking driver error into a generic
  `500 DATABASE_ERROR`, so a bad write payload to the data API leaked a 500
  instead of a fixable 4xx (e.g. `POST /data/sys_team` with an unknown field,
  or omitting a required column). It now maps unknown-column errors to
  `400 INVALID_FIELD { field }` and not-null violations to
  `400 VALIDATION_FAILED { fields:[{required}] }` across SQLite/Postgres/MySQL
  phrasings, placed before the unknown-object branch so Postgres
  `column … of relation … does not exist` is not mis-mapped to 404. Genuine
  driver faults still return 500; unique violations still return 409.

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
  - @objectstack/service-package@8.0.0

## 7.9.0

### Patch Changes

- ac1fc4c: feat(metadata): optional storage teardown on delete so "publish to preview" leaves no orphan table

  Object storage was create-only: `publishMetaItem` creates a table (`ensureObjectStorage`) but nothing ever dropped one — `deleteMetaItem` only tombstones the metadata row, leaving the physical table behind. That made the pragmatic "publish an object just to preview it with real data, then discard if wrong" loop leave residue.

  Adds the inverse path, opt-in and guarded:

  - `engine.dropObjectSchema(name)` — inverse of `syncObjectSchema`; resolves the table name + driver and calls the driver's existing `dropTable` (DROP TABLE IF EXISTS / drop collection).
  - `deleteMetaItem({ …, dropStorage })` — when `true`, drops the object's physical table after the metadata is removed. **DESTRUCTIVE**, so it is gated: `object` type only (others have no table), `active` state only (drafts were never materialised), and never a `sys_`-prefixed platform table. Default `false` keeps delete non-destructive to data. Best-effort: a drop failure is logged, not thrown.
  - REST: `DELETE /meta/:type/:name?dropStorage=true` threads the flag.

  This makes "publish to preview → discard" cleanly reversible. Combined with the draft-overlay read mode, it backs the team's chosen approach: lean on publish (into a dev sandbox) for data-level confirmation rather than building a full draft-data preview, and make that publish safely undoable.

  - @objectstack/spec@7.9.0
  - @objectstack/core@7.9.0
  - @objectstack/service-package@7.9.0

## 7.8.0

### Patch Changes

- a75823a: feat(metadata): expose pending DRAFT metadata (ADR-0033 draft discoverability)

  AI-authored metadata lands as drafts (`sys_metadata` rows with `state='draft'`, bound to an app package), but the only list path — `getMetaItems` — reads the active registry, so drafts were invisible: a just-built app package looked empty and there was no "pending changes" surface.

  - `SysMetadataRepository.listDrafts({type?, packageId?})` lists draft rows (mirrors `list()` but scoped to `state='draft'`, optionally narrowed by package), returning a light header projection (no body) with `packageId`.
  - `protocol.listDrafts({packageId?, type?, organizationId?})` exposes it over the overlay repo.
  - `GET /api/v1/meta/_drafts?packageId=&type=` surfaces it to the console. Registered in the REST server before the greedy `/meta/:type` route (and mirrored in the dispatcher) so `_drafts` is never captured as a metadata type name.

  Read-only; no behavior change to existing list/publish paths. Powers the upcoming Studio "drafts/pending changes" view and draft-aware package contents.

- Updated dependencies [06f2bbb]
- Updated dependencies [4fbb86a]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/service-package@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/service-package@7.7.0

## 7.6.0

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
  - @objectstack/service-package@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/service-package@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/service-package@7.4.1

## 7.4.0

### Minor Changes

- 2faf9f2: External Datasource Federation (ADR-0015) — REST surface.

  Adds `registerExternalDatasourceRoutes`, mounting `/api/v1/datasources/:name/
external/*` — `GET tables`, `POST tables/:remote/draft`, `POST refresh-catalog`,
  `POST validate` — served by the `external-datasource` service and wired into the
  REST API plugin. Routes return `503 external_service_unavailable` when the
  service is not registered, so they are safe to mount unconditionally.

### Patch Changes

- 58b450b: Make metadata labels follow the active UI language without a page refresh (#1319).

  The client now carries the active locale on every request (`Accept-Language`,
  `setLocale`/`getLocale`), the protocol ETag is locale-aware so cached metadata
  no longer collides across languages, and the `client-react` metadata hooks
  refetch when the locale changes. The `apps/account` console wires its router
  locale through so a language switch relabels server-resolved object/field/view
  labels in place instead of leaving the UI half-translated until reload.

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
  - @objectstack/service-package@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/service-package@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/service-package@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/service-package@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/service-package@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/service-package@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/service-package@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/service-package@6.8.1

## 6.8.0

### Minor Changes

- c8b9f57: Metadata Admin engine — protocol foundations.

  This is the backend half of the unified Metadata Admin shipped in the Setup
  app. The framework now exposes everything the engine needs to render a
  directory tile, schema-driven form, layered diff, references graph, and
  destructive-change confirmation for every registered metadata type.

  - **`GET /api/v1/meta/types`** is now type-rich. Each entry includes
    `{ icon, domain, schema (JSONSchema), allowOrgOverride, allowRuntimeCreate, supportsOverlay, ui? }`
    so the client can render without a second round-trip per type.
  - **`GET /api/v1/meta/:type/:name/references`** scans every registered
    metadata type for pointers to the given item (object fields, view sources,
    flow targets, permission objects, …) and returns the inbound edges so the
    UI can warn before deletes.
  - **`GET /api/v1/meta/:type/:name?layers=code,overlay,effective`** returns
    each layer separately rather than the merged effective document, powering
    the 3-state diff editor (code source / overlay / effective).
  - **Destructive-change detection** on `PUT /api/v1/meta/object/:name` and
    `PUT /api/v1/meta/field/:name`: rejects field type narrowing, required
    toggled on without a default, removed enum values, etc., unless the
    client opts in with `force=true`.
  - **Env-var registry patch:** `OBJECTSTACK_METADATA_WRITABLE=object,field,permission,view,…`
    flips `allowOrgOverride` on for the listed types at boot, enabling
    runtime overlays for production without re-deploying spec.
  - New guide: **[Adding a Metadata Type](../content/docs/guides/adding-a-metadata-type.mdx)**
    walks through registry entry + Zod schema + optional custom editor.

  Setup app navigation now uses the new component-route variant
  (`{ type: 'component', componentRef: 'metadata:directory' }`) — the temporary
  `/dev/meta` route is removed.

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/service-package@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/service-package@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/service-package@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/service-package@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/service-package@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/service-package@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/service-package@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/service-package@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/service-package@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/service-package@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/service-package@6.1.0

## 6.0.0

### Major Changes

- 944f187: # v5.0 — `project` → `environment` hard rename

  The runtime concept previously called **"project"** (per-tenant business
  workspace; Org → **Project** → Branch hierarchy; per-project ObjectKernel,
  per-project DB, per-project artifact) is now uniformly called
  **"environment"**.

  This is a **hard rename with no aliases, deprecation shims, or compatibility
  layer**. Upgrade requires a coordinated update of CLI, runtime, server, and any
  clients calling the REST API.

  > Note: "project" in the npm / monorepo sense (the framework itself, `package.json`,
  > tsconfig project references, vitest `projects` config) is **unchanged**.

  ## Breaking changes

  ### CLI

  - Flags renamed:
    - `--project` / `-p` → `--environment` / `-e` (`os publish`, `os rollback`)
    - `--project-id` → `--environment-id` (`os dev`)
  - Default local env id: `proj_local` → `env_local`.
  - Env var: `OS_PROJECT_ID` → `OS_ENVIRONMENT_ID`.
  - Command group renamed: `os projects ...` → `os environments ...`
    (`bind`, `create`, `list`, `show`, `switch`).
  - Persisted auth-config key: `activeProjectId` → `activeEnvironmentId`.

  ### HTTP / REST

  - Scoped routes: `/api/v1/projects/:projectId/...` → `/api/v1/environments/:environmentId/...`.
  - Cloud control-plane routes: `/api/v1/cloud/projects/...` → `/api/v1/cloud/environments/...`
    (including `/cloud/environments/:id/artifact`, `/cloud/environments/:id/metadata`,
    `/cloud/environments/:id/credentials/rotate`, etc.).
  - Header: `X-Project-Id` (and lowercase `x-project-id`) → `X-Environment-Id`
    (`x-environment-id`).
  - Route param name in handlers: `req.params.projectId` → `req.params.environmentId`.
  - Hostname-routing and tenant-resolution code-paths use `environmentId` end-to-end.

  ### Runtime / spec

  - Exported symbols (no aliases):
    - `createSystemProjectPlugin` → `createSystemEnvironmentPlugin`
    - `SYSTEM_PROJECT_ID` → `SYSTEM_ENVIRONMENT_ID`
    - `ProjectArtifactSchema` → `EnvironmentArtifactSchema`
    - `PROJECT_ARTIFACT_SCHEMA_VERSION` → `ENVIRONMENT_ARTIFACT_SCHEMA_VERSION`
    - `ObjectOSProjectPlugin` → `ObjectOSEnvironmentPlugin`
    - `createSingleProjectPlugin` → `createSingleEnvironmentPlugin`
  - Plugin identifier strings:
    - `com.objectstack.runtime.objectos-project` → `objectos-environment`
    - `com.objectstack.studio.single-project` → `single-environment`
    - `com.objectstack.multi-project` → `multi-environment`
    - `com.objectstack.runtime.system-project` → `system-environment`
  - Provisioning hook: `provisionSystemProject` → `provisionSystemEnvironment`.

  ### Database / schemas

  - Column renames on `sys_metadata` and `sys_metadata_history`:
    `project_id` → `environment_id`.
  - Column renames on `sys_activity`: `project_id` → `environment_id` (plus index).
  - Object renames in platform-objects metadata: `sys_project` → `sys_environment`
    (lookup targets), `sys_project_member` → `sys_environment_member`,
    `sys_project_credential` → `sys_environment_credential`.
  - Auth-context field: `active_project_id` → `active_environment_id`.
  - JSON schemas under `packages/spec/json-schema/system/`:
    `ProjectArtifact*.json` → `EnvironmentArtifact*.json` (regenerated at build).

  ### Automatic forward migration

  A new migration `migrateProjectIdToEnvironmentId`
  (`packages/metadata/src/migrations/migrate-project-id-to-environment-id.ts`)
  auto-runs from `DatabaseLoader.ensureSchema()` on bootstrap and rewrites any
  existing `project_id` column on `sys_metadata` / `sys_metadata_history` to
  `environment_id` (idempotent, best-effort). Existing rows are preserved.

  The legacy reverse migration `migrateEnvIdToProjectId` is retained verbatim
  for historical / disaster-recovery use; it is **not** auto-run.

  ## Migration guide

  ```diff
  -os publish --project proj_xyz
  +os publish --environment env_xyz

  -curl -H "X-Project-Id: env_xyz" https://api.example.com/api/v1/data/customer
  +curl -H "X-Environment-Id: env_xyz" https://api.example.com/api/v1/data/customer

  -OS_PROJECT_ID=env_xyz os dev
  +OS_ENVIRONMENT_ID=env_xyz os dev

  -import { createSystemProjectPlugin, SYSTEM_PROJECT_ID } from "@objectstack/runtime";
  +import { createSystemEnvironmentPlugin, SYSTEM_ENVIRONMENT_ID } from "@objectstack/runtime";

  -import { ProjectArtifactSchema } from "@objectstack/spec";
  +import { EnvironmentArtifactSchema } from "@objectstack/spec";
  ```

  If you maintain a Cloud control-plane deployment, the `cloud` repository must
  be updated in lockstep to pick up the new plugin identifier strings
  (`single-environment`, `multi-environment`, `objectos-environment`).

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/service-package@6.0.0

## 5.2.0

### Patch Changes

- b806f58: Scope `sys_user` visibility to fellow organization members.

  The default RLS policy on `sys_user` was `id = current_user.id`, which meant
  @-mention pickers, owner/assignee lookups, reviewer selectors and the user
  roster all returned just the current user. The RLS compiler doesn't support
  subqueries, so a `id IN (SELECT user_id FROM sys_member ...)` policy isn't
  expressible.

  This change:

  1. Pre-resolves `org_user_ids` (the IDs of all users in the active org) into
     `ExecutionContext` in **all three** REST entry-point resolvers
     (`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/plugin-hono-server`).
  2. Adds the field to `ExecutionContextSchema` so it survives Zod parsing.
  3. Adds an `org_user_ids` field to the RLS compiler's user context.
  4. Adds a new `sys_user_org_members` policy (`id IN (current_user.org_user_ids)`)
     to both `member_default` and `viewer_readonly` permission sets, alongside
     the existing `sys_user_self` policy. The RLS compiler OR-combines them, so
     users see themselves AND their org collaborators.

  Capped at 1000 members per request. Large enterprises should plug in a
  directory cache or split per workspace.

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/service-package@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/service-package@5.1.0

## 5.0.0

### Minor Changes

- 5cfdc85: PR-10d.4 — REST plumbing for the metadata repository write path.

  - `PUT /api/v1/meta/:type/:name` (and the compound `:type/:section/:name` variant)
    now forwards the `If-Match` header to `saveMetaItem` as `parentVersion`, and
    `X-Actor` (or `req.user.id`) as `actor`. ETag-style quotes are stripped.
  - A failed optimistic-lock check surfaces as HTTP 409 with body
    `{ "error": "...", "code": "metadata_conflict" }` (no protocol changes —
    `sendError` already honoured `error.status` + `error.code`).
  - Added a real-engine integration test for the repository write path
    (`protocol-save-meta-repo-path-real-engine.test.ts`) — addresses the
    PR-10d.3 rubber-duck stub-drift concern by exercising
    `ObjectStackProtocolImplementation.saveMetaItem` through `new ObjectQL()`
    with an inline in-memory driver. Covers insert→update version bump,
    parentVersion conflict, checksum length, and plural→singular normalization.

  Default behaviour unchanged: the repository write path remains opt-in via
  `options.useRepositoryWritePath` / `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH=1`.
  Flag flip and legacy path removal will follow in a separate post-soak PR.

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/service-package@5.0.0

## 4.2.0

### Minor Changes

- 2869891: feat: Optimistic Concurrency Control (OCC) via `If-Match`

  Update and Delete requests now accept an optional version token. When supplied,
  the protocol compares it against the record's current `updated_at` (or `version`
  column when available) and rejects with `409 CONCURRENT_UPDATE` on mismatch,
  preventing silent overwrites when two clients edit the same record.

  **Wire formats** (opt-in, all server- and client-backward-compatible):

  - `PATCH /data/{object}/{id}` — supports `If-Match: "<token>"` header
    _or_ `expectedVersion: "<token>"` body field (body wins when both present).
  - `DELETE /data/{object}/{id}` — supports `If-Match` header _or_
    `?expectedVersion=...` query param.
  - Conflict response: `409 { error, code: 'CONCURRENT_UPDATE', currentVersion,
currentRecord }` so the client can offer Reload / Overwrite / Cancel UX.

  **Behaviour**

  - Missing/empty version → no check (legacy callers unaffected).
  - Record not found during the version probe → no check; the downstream write
    produces a normal `404`.
  - Object has no `updated_at` column → no check (explicit opt-out for objects
    without timestamps).
  - Quoted RFC-7232 tokens (`"…"`) are accepted and unquoted before comparison.

  **Client**

  `client.data.update(resource, id, data, { ifMatch })` and
  `client.data.delete(resource, id, { ifMatch })` now forward the token as an
  `If-Match` header.

  Application-level CAS (findOne + compare in protocol.ts) is used in this slice
  to avoid touching every storage driver. A small TOCTOU window remains; for the
  B2B record-editing latencies this protects against, it is more than sufficient.
  Drivers may later be upgraded to atomic `WHERE id=? AND updated_at=?` writes
  for true CAS without changing the public API.

  Tests: 7 new cases in `protocol-data.test.ts` cover opt-in, match, mismatch,
  quote-stripping, no-timestamps, empty-token, and the delete path.

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/service-package@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/service-package@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/service-package@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/service-package@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 2.0.0

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.1.1
  - @objectstack/core@1.1.1

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.2.0

### Minor Changes

- ## New Features

  - **@objectstack/rest** (new package): Extracted REST server, route management, and `createRestApiPlugin` into a dedicated package
  - **@objectstack/runtime**: Add `createDispatcherPlugin` for structured route management (auth, graphql, analytics, packages, hub, storage, automation)
  - **@objectstack/cli**: Dev mode (`--dev`) now auto-enables Studio UI at `/_studio/` — no need for `--ui` flag; use `--no-ui` to disable
  - **@objectstack/cli**: Root URL `/` redirects to `/_studio/` in dev mode for convenience
  - **@objectstack/cli**: Removed Vite dev server fallback — always serves pre-built dist, no extra port
  - **@objectstack/studio**: Interactive API Console in Object Explorer (request builder, response viewer, history)
  - **@objectstack/spec**: Studio Plugin schema, MCP Protocol schemas, API versioning, Dispatcher protocol
  - **@objectstack/spec**: Comprehensive `.describe()` annotations across all Zod schemas
  - **@objectstack/core**: Production hot reload and dynamic plugin loading protocol

  ## Migration Guide (from 1.1.0)

  ### RuntimeConfig.api removed

  ```ts
  // Before (1.1.0) — implicit
  const runtime = new Runtime({ api: { basePath: "/api/v1" } });

  // After (1.2.0) — explicit
  import { createRestApiPlugin } from "@objectstack/rest";
  const runtime = new Runtime();
  runtime.use(createRestApiPlugin({ basePath: "/api/v1" }));
  ```

  ### z.any() → z.unknown() (~30 fields)

  Fields like `metadata`, `defaultValue`, `filters`, `config`, `data` now use `z.unknown()`. Add type narrowing where needed.

  ### Hub schemas relocated

  Barrel imports via `Hub.*` still work. Direct path imports (`hub/license.zod.ts` → `system/license.zod.ts`) need updating.

  ### MetricType renamed

  `MetricType` (analytics) → `AggregationMetricType`, `MetricType` (licensing) → `LicenseMetricType`

  ### Deprecations

  - `HttpDispatcher` → `createDispatcherPlugin()`
  - `createHonoApp` → `HonoServerPlugin`

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.2.0

### Minor Changes

- ## New Features

  - **@objectstack/rest** (new package): Extracted REST server, route management, and `createRestApiPlugin` into a dedicated package
  - **@objectstack/runtime**: Add `createDispatcherPlugin` for structured route management (auth, graphql, analytics, packages, hub, storage, automation)
  - **@objectstack/cli**: Dev mode (`--dev`) now auto-enables Studio UI at `/_studio/` — no need for `--ui` flag; use `--no-ui` to disable
  - **@objectstack/cli**: Root URL `/` redirects to `/_studio/` in dev mode for convenience
  - **@objectstack/cli**: Removed Vite dev server fallback — always serves pre-built dist, no extra port
  - **@objectstack/studio**: Interactive API Console in Object Explorer (request builder, response viewer, history)
  - **@objectstack/spec**: Studio Plugin schema (`Studio.PluginManifest`)
  - **@objectstack/spec**: MCP (Model Context Protocol) schemas for AI tools, resources, prompts, transport
  - **@objectstack/spec**: API versioning schema with multiple strategies
  - **@objectstack/spec**: Dispatcher protocol schema
  - **@objectstack/spec**: Comprehensive `.describe()` annotations across all Zod schemas for JSON Schema generation
  - **@objectstack/core**: Production hot reload and dynamic plugin loading protocol

  ## Migration Guide (from 1.1.0)

  ### RuntimeConfig.api removed

  REST API is now opt-in. If you relied on automatic REST registration:

  ```ts
  // Before (1.1.0) — implicit
  const runtime = new Runtime({ api: { basePath: "/api/v1" } });

  // After (1.2.0) — explicit
  import { createRestApiPlugin } from "@objectstack/rest";
  const runtime = new Runtime();
  runtime.use(createRestApiPlugin({ basePath: "/api/v1" }));
  ```

  ### z.any() → z.unknown() (~30 fields)

  Fields like `metadata`, `defaultValue`, `filters`, `config`, `data` in spec schemas changed from `z.any()` to `z.unknown()`. If you consume inferred types, add type narrowing:

  ```ts
  // Before — worked silently
  const val: string = record.metadata.foo;

  // After — requires narrowing
  const meta = record.metadata as Record<string, string>;
  const val = meta.foo;
  ```

  ### Hub schemas relocated

  - `hub/composer.zod.ts`, `hub/marketplace.zod.ts`, `hub/space.zod.ts`, `hub/hub-federation.zod.ts` — removed
  - `hub/plugin-registry.zod.ts` → `kernel/plugin-registry.zod.ts`
  - `hub/license.zod.ts` → `system/license.zod.ts`
  - `hub/tenant.zod.ts` → `system/tenant.zod.ts`

  Barrel imports via `Hub.*` namespace still work. Direct path imports need updating.

  ### MetricType renamed

  - `MetricType` (data analytics) → `AggregationMetricType`
  - `MetricType` (hub licensing) → `LicenseMetricType`

  ### Deprecations

  - `HttpDispatcher` → use `createDispatcherPlugin()` instead
  - `createHonoApp` → use `HonoServerPlugin` instead

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0
