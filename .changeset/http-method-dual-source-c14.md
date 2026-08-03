---
"@objectstack/spec": major
---

BREAKING(spec): `@objectstack/spec/ui` 不再导出 `HttpMethod` —— 该名字在本包内指向**两个不同的类型**,`./ui` 那一个改名为 `HttpMethodType` (#4691, #4535 C14)

`HttpMethod` 过去被三个入口导出,但**不是同一个声明**,拿到哪个只取决于 import 路径 —— #4411 陷阱。而且与 C11(`HttpRequest`)不同,这一簇两侧连**取值集合都不一样**:

| 入口 | 声明位置 | 取值 |
|:--|:--|:--|
| `@objectstack/spec/shared`、`@objectstack/spec/api`(**不变**) | `shared/http.zod.ts` 的 `z.enum([...])` | **7 值** — `GET` `POST` `PUT` `DELETE` `PATCH` **`HEAD` `OPTIONS`** |
| `@objectstack/spec/ui`(**本次移除**) | `ui/view.zod.ts` 的 `z.infer< typeof HttpMethodSchema >` | **5 值** — `GET` `POST` `PUT` `PATCH` `DELETE` |

7 值那个描述的是「HTTP 协议本身有哪些方法」(CORS `methods[]`、REST 路由表、endpoint 声明都用它);5 值那个是 UI/View 数据源允许配置的**真子集**,它的注释自己写着 *"HTTP Method Schema (subset for UI/View data sources)"*。

## FROM → TO

```ts
// FROM —— 拿到的是 5 值的 UI 子集类型
import type { HttpMethod } from '@objectstack/spec/ui';

// TO —— 同一个类型,同一个入口,零形状变化
import type { HttpMethodType } from '@objectstack/spec/ui';
```

`HttpMethodType` 是 `shared/http.zod.ts` 里 `z.infer< typeof HttpMethodSchema >` 的既有名字(`@objectstack/spec/shared` 一直在导出),本次由 `./ui` **re-export** 同一个声明,所以改完之后解析到的类型与改之前逐字相同。

⚠️ **不要把 import 路径改成 `@objectstack/spec/shared` 而保留 `HttpMethod` 这个名字。** 那里的 `HttpMethod` 是**7 值**的那一个,会把类型悄悄放宽两个值,而 `HttpRequestSchema.method` 运行时只接受 5 值 —— `method: 'HEAD'` 会通过编译、在 `.parse()` 抛错。之所以把 `HttpMethodType` 也从 `./ui` re-export 出去,就是为了让编译器的 "did you mean" 指向同一入口里正确的那个名字,而不是引诱这次换路径。

用 7 值枚举的代码不受影响:`import { HttpMethod } from '@objectstack/spec/api'`(或 `/shared`)行为一字未变。

## 为什么不是「让 `./ui` re-export `./shared` 的 `HttpMethod`」

C11(#4688)对 `HttpRequest` 用的正是这一招,当时是对的 —— 两侧 `z.infer` 的是**同一个 schema 对象**,形状逐字段相同,收敛后消费者零感知。

本簇不成立:那样做会把 `./ui` 的 `HttpMethod` 从 5 值放宽到 7 值,而 `HttpRequestSchema.method`(`shared/http.zod.ts`)校验用的仍是 5 值的 `HttpMethodSchema`。结果是**类型开始对运行时说谎** —— 少一行基线,换来一个编译期放行、运行期抛错的坑。所以走的是「`./ui` 不再叫这个名字」,让 5 值类型保留它在 `./shared` 里已有的诚实名字。

`HttpMethodSchema` 的值域**一字未动**(仍是 5 值),`HttpRequestSchema` 的运行时行为**零变化**。

## 定级理由(逐条自证,未照抄前例)

定 **major**,因为这是一次**已发布导出名的移除**:外部 `import type { HttpMethod } from '@objectstack/spec/ui'` 会以 TS2305 编译失败。这与 C11 定 patch 的情形正相反 —— 那次名字仍在导出、只是换了声明来源,消费者无需改一个字符;本次名字没了。

同时它**不是元数据破坏**:
- `authorable-surface.json` **零变化**(实跑 `check:authorable-surface` ✓)—— `HttpMethod` 是纯 TS 类型别名,不是可作者化的 key。
- 因此**无 tombstone、无 ADR-0087 conversion / migration**,`spec-changes.json` 与 `protocol-upgrade-guide.md` 零变化(两个 gate 均 ✓)。
- 已存 `sys_metadata` 数据、JSON Schema 产物、运行时校验行为全部不受影响。

也就是说:**零元数据迁移,只有一处一行的 TypeScript import 改动。**

## 基线 14 → 13

`dual-source-exports.baseline.json` 删掉 `HttpMethod — [./api, ./shared (type)] ≠ [./ui (type)]` 一行,其余 13 行一字未动。这是 #4535 v17 双源账的**最后一条**。

`api-surface.json` 的改动恰好只有 `./ui` 的一行对换:`- HttpMethod (type)` / `+ HttpMethodType (type)`。
