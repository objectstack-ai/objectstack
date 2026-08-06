---
"@objectstack/spec": major
---

BREAKING(spec): `@objectstack/spec/shared` 与 `/ui` 改名 `HttpMethodSchema` → `HttpMethodSubsetSchema`、`HttpMethodType` → `HttpMethodSubset`;裸名 `HttpMethod(.json)` 现在全包唯一地指 7 值的路由契约,`HEAD`/`OPTIONS` 回到发布出去的 JSON Schema 与参考页 (#5832)

`packages/spec/src/shared/http.zod.ts` 在同一个文件里声明了两个**内容不同**的枚举,
而它们经 `schemaNameFromExportKey()` 剥掉 `Schema` 后缀后同名:

| 导出名 | 值域 | 剥后的发布名 |
|:---|:---|:---|
| `HttpMethod` | **7 值**(含 `HEAD`/`OPTIONS`) | `HttpMethod` |
| `HttpMethodSchema` | 5 值(view 数据源子集) | `HttpMethod` |

`build-schemas.ts` 对 `generatedSchemas.set(defKey, …)` 是无条件覆盖,后写覆盖前写,
5 值那份按导出枚举顺序排在后面。实测结果:`json-schema/shared/HttpMethod.json`、
bundled `objectstack.json` 的 `$defs['shared/HttpMethod']`、以及
`content/docs/references/shared/http#httpmethod` **只描述 5 值那份** —— 而 7 值那份才是
`api/discovery`、`api/endpoint`、`api/plugin-rest-api`、`api/rest-server`、`api/router`
声明 `method` 字段用的线上契约。任何按发布出去的 JSON Schema 做校验的下游(IDE 自动补全、
codegen、AI 元数据作者)拿到的都是被截断的那一份,会以为 `HEAD`/`OPTIONS` 非法。
属于 AGENTS.md「Machine-readable surfaces must not lie」。

## 发布面变化

- `shared/HttpMethod.json` 的 `enum` 从 5 值 **修正为** 7 值
  (`GET`/`POST`/`PUT`/`DELETE`/`PATCH`/`HEAD`/`OPTIONS`)。这是**修复性契约变化**:
  7 值那份一直是源码里 `api/*` 实际使用的那一个,只是从未被发布出去。
- 新增发布名 `shared/HttpMethodSubset`(5 值)。
- `ui/HttpMethod`(5 值)**改名**为 `ui/HttpMethodSubset`,登记在
  `scripts/lib/renamed-defs.ts`。

## 迁移

```ts
// 5 值子集(view 数据源;`HttpRequestSchema.method` 校验用的就是它)
- import { HttpMethodSchema } from '@objectstack/spec/shared'; // 或 '/ui'
+ import { HttpMethodSubsetSchema } from '@objectstack/spec/shared'; // 或 '/ui'
- import type { HttpMethodType } from '@objectstack/spec/ui';
+ import type { HttpMethodSubset } from '@objectstack/spec/ui';
```

⚠️ **不要把 `HttpMethodSchema` 直接换成 `HttpMethod`。** `shared/HttpMethod` 是 7 值的那一个,
换过去会把类型悄悄放宽两个值,而 `HttpRequestSchema.method` 运行时仍只接受 5 值 ——
`method: 'HEAD'` 会通过编译、在 `.parse()` 抛错。这正是 #4691 当初拒绝合并两个名字的理由,
本次只是把当年留下的 `HttpMethodType` 这个「因为 `HttpMethod` 被占用才起的名字」换成了
说明其含义的名字,让发布名、schema const、类型别名三者按本包
`<Name>Schema` / `<Name>` 的惯例对齐(ADR-0112 D9:一个名字只指一件事;改名走 #4684
`RateLimitConfig` 的先例)。运行时值域**一字未动**。

## 守卫

`build-schemas.ts` 补上「同一个 def key 被两个**不同** schema 写第二次 = 硬报错」
(`scripts/lib/def-key-collisions.ts`),在两个 ratchet 之前跑 —— 它们都以 def key 计量,
碰撞只产生一个 key,谁也看不见。`export const X = XSchema` 这种自别名(本包 `api`/`system`/`ui`
共 14 处)不算碰撞:两次写的是同一个对象,不可能改变发布出去的内容。
