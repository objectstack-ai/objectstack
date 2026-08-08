---
"@objectstack/runtime": patch
"@objectstack/rest": patch
"@objectstack/plugin-auth": patch
"@objectstack/service-i18n": patch
"@objectstack/service-storage": patch
---

feat(runtime,rest,plugin-auth,service-i18n,service-storage): route-ledger 条目类型加可选 `responseSchema` (#5791)

#3877 的「最小首步」，维护者 2026-08-06 已批。**纯增量、零行为变更**：五个 route
ledger 的现有条目一行未改，字段缺省即「未声明」。

## 为什么是这一步

#3877 量到的洞不是「发出的和声明的不一致」，而是**大多数路由根本没有可对账的声明**：
237 条已挂载路由里 215 条是 `sdk` 面，而携带 schema 引用的是 **0 条**。于是同一单
里裁定了两件事——Stage C（批量补 ~190 条响应 schema）**永不排期**（一条响应 schema
是「这个端点承诺什么」的产品决定，批量生产正是 #3676 / #3833 / #3847 / #3870 四个
缺陷的成因），以及先把「这条路由声明了什么」变成**可查询数据**，让 Stage D 的棘轮
将来有东西可棘。本次落地的就是后者。

## 字段语义

`responseSchema` 是 `@objectstack/spec/api` 导出名，指向该路由**响应载荷**的声明：
路由套 `{ success, data }` 信封时指 `data`，不套时指整个 body。信封本身不归它管，
由 `pnpm check:route-envelope` 结构化守住——一个字段无法同时诚实地描述两层。

五个 ledger 是五个各自独立声明、按约定同形的 interface，因此是五处同名同措辞的可选
字段，**不是**新建共享类型包。三个 ledger 明确要求保持 import-free（客户端守卫按
相对**源文件**编译它们），且 `zod` 并非每个持有 ledger 的包的依赖，故字段存的是
**名字**而非 live schema 对象，解析放在能 import spec 的守卫里。

## 已填的两条（实证，不是批量）

只填 #5682 已给出双断言覆盖（safeParse 判**值** + 键集判**键**）的 discovery 族两条，
且刻意分处两个 ledger，以证明一个字段形状确实服务五个独立声明的条目类型：

- `packages/runtime` `GET /discovery` → `DiscoverySchema`（走信封，指 `data`）
- `packages/rest` `GET /api/v1/discovery` → `DiscoverySchema`（裸发，指整个 body）

`GET /api/v1` 这条 bare-base 别名**故意不填**：它与上面那条共用同一个
`discoveryHandler` 闭包，但 #5682 的测试只驱动 `/api/v1/discovery`，「同一个 handler
所以同一个形状」是对代码的论证而非对代码的测量。没有覆盖就不填。

## 新增守卫

- `packages/client/src/route-ledger-response-schema.test.ts` —— 五个 ledger 的并集里
  每一个 `responseSchema` 都到**活的** `@objectstack/spec/api` 导出里解析，并且真的
  调用一次 `safeParse`（spec 的 schema 是 `lazySchema()` 代理，只查属性存在会被代理
  陷阱满足）。含否定对照（少一个字母的名字、空串、导出了但不是 schema）与反空转下界。
- `discovery-schema-conformance.test.ts`（runtime / rest 各一）—— 钉住 ledger 报的
  schema 就是该套件实际解析用的**同一个对象**，并各自测量了载荷所在的层级。
