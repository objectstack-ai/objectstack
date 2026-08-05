---
"@objectstack/spec": patch
"@objectstack/rest": patch
---

**发布出去的 OpenAPI 文档 `components.schemas` 不再是空的,6 个 `$ref` 不再悬空(#5168)**

`GET /api/v1/openapi.json` 的 base spec 由 `packages/spec/scripts/build-openapi.ts` 生成,它把九个契约 schema(`CreateRequest` / `ApiError` / `ListRecordResponse` / …)转成 JSON Schema 填进 `components.schemas`。收集判据写的是 `typeof schema === 'object' && '_zod' in schema`,而这九个 schema 全部经 `lazySchema()` 包装 —— 其 Proxy target 是 `function lazyZod() {}`,于是 `typeof` 是 `'function'` 而不是 `'object'`,判据第一段就短路,九个一个都没进去。`paths` 里那 6 个 `$ref` 是手写字面量,不受影响照常写出,结果是**一份 `components.schemas` 为 `{}`、6 个 `$ref` 全部悬空的文档被发布出去**,覆盖 `/api/{object}` 与 `/api/{object}/{id}` 上全部 CRUD 操作的请求体与响应体。

判据放宽为同时接受 `'object'` 与 `'function'`。`'_zod' in schema` 那一段对 Proxy 本来就是有效的 —— `lazySchema` 专门维护了 `_zod` facade 供 `toJSONSchema` 遍历 —— 所以 `lazySchema` 本身不需要改动。对照实验坐实了唯一变量就是 Proxy:同一份源码下 `npx tsx scripts/build-openapi.ts` 得到 `Components: 0`,而 `OS_EAGER_SCHEMAS=1`(`lazySchema` 自带的绕过 Proxy 应急开关)得到 `Components: 9`。修复后不带任何环境变量即为 `Components: 9`。

两类消费者直接受益:`GET /api/v1/docs` 的 Scalar viewer 现在有 schema 可渲染;从该文档做客户端代码生成的集成方(openapi-generator / orval / …)不再在解析期撞上 unresolvable reference。

**同时补上防复发的门禁。** 这个缺陷三个层次同时可见(空 components、悬空 ref、控制台明晃晃的 `Components: 0`)却没有任何一处红 —— `gen:openapi` 是全仓两个完全无门禁的生成器之一。生成器现在在**写盘之前**自检两条,任一不满足即以非零码退出,自恰不了的文档根本不会被写出来:

1. **每个本地 `$ref` 都必须解析得到。** 按 JSON Pointer 解析而不是按 `#/components/schemas/` 前缀匹配,将来新增的 `#/$defs/…` 引用自动被覆盖;报错逐条点名悬空的 `$ref` 及其在文档中的位置,并把「已定义的 schema 列表」一并打出来 —— 哪一侧是空的是读者最先需要的信息。
2. **没有 schema 被静默降级。** 九个契约 schema 是一张字面清单,某个名字没产出东西永远是缺陷而不是「这个可选」。原先的循环写成 `if (像 zod) { 收 }` 且没有 `else`,正是这个「静默跳过」的形状让九次跳过发布成了空文档;现在**声明即强制**,漏掉的名字会被点名。`z.toJSONSchema()` 抛错时原先会塞一个 `{type:'object'}` 占位描述冒充契约,这条同样改为响亮失败 —— 当前九个全部干净转换,零占位。

门禁接在生成器内部而不是单独的 `check:` 脚本,因为 `packages/spec/json-schema/` 是 gitignore 的、每次 `pnpm build` 重新生成,独立检查脚本无论如何都要先跑一次生成器才有东西可查。「产物自恰」这类断言比「产物最新」更便宜,且不需要任何基线快照。

`packages/rest` 侧无行为改动:声明式端点的 enrichment 仍然只写 `type: object` 而不编造 `$ref` —— 九个契约 schema 是通用 CRUD 信封,不是某个具体对象的 body 形状 —— 但三处以现在时陈述「`components.schemas` 是空的」的注释已按事实更新。
