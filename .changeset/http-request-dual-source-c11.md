---
"@objectstack/spec": patch
---

refactor(spec): 双源 C11 收敛 — `HttpRequest` 类型别名改为 re-export `./shared` 的唯一声明 (#4688)

`HttpRequest` 这个名字过去在 `@objectstack/spec/shared` 和 `@objectstack/spec/ui` 解析到**两份不同的类型声明**,是 `dual-source-exports.baseline.json` 上的一行(#4411 陷阱)。现在 `./ui` 直接 re-export `./shared` 的那一份,平台只剩一个声明。

基线 **19 → 18**。

## 为什么是 patch 而不是 major —— 消费者侧零类型差异,已实证

#4535 主单把 v17 的三个双源簇统称 breaking。**本簇不是**,原因是这一簇和其它簇形状不同:

`HttpRequestSchema` **从来只有一份声明**(在 `shared/http.zod.ts`)。`ui/view.zod.ts` 一直是 `import` 进来再原样 re-export 的,所以基线里根本没有 `HttpRequestSchema` 行。被判为双源的只有 `ui/view.zod.ts` 底部那个**本地类型别名**:

```ts
// FROM —— ./ui 的本地 infer(第二个类型声明符号)
export type HttpRequest = z.infer< typeof HttpRequestSchema >;

// TO —— re-export ./shared 的唯一声明
export type { HttpRequest } from '../shared/http.zod';
```

两者 `z.infer` 的是**同一个** schema 对象,所以解析出来的类型逐字段相同。这不是推断,是编译器验过的:

```ts
type Equal< X, Y > = (< T >() => T extends X ? 1 : 2) extends (< T >() => T extends Y ? 1 : 2) ? true : false;
type Assert< T extends true > = T;

type PreFixUiHttpRequest = z.infer< typeof HttpRequestSchema >;   // FROM,逐字复刻旧那行
type _A = Assert< Equal< PreFixUiHttpRequest, SharedHttpRequest > >;  // ✅ 通过
type _B = Assert< Equal< PreFixUiHttpRequest, UiHttpRequest > >;      // ✅ 通过(FROM === TO)
type _NEG = Assert< Equal< UiHttpRequest, { totallyDifferent: true } > >;  // ❌ TS2344,证明上面两条不是空转
```

配套证据:`api-surface.json` 零改动(名字、入口、kind 全部不变),`authorable-surface.json` 零改动,无 tombstone,无 ADR-0087 conversion —— 因为没有任何可作者化的 key 或运行时行为发生变化。

**所以升级者无需做任何事。** 没有 FROM → TO 迁移动作,`import type { HttpRequest } from '@objectstack/spec/ui'` 和 `from '@objectstack/spec/shared'` 都照旧可用,且现在保证指向同一个声明。谎报破坏和漏报破坏一样会污染升级指南,故按实际情况定级为 patch。

## 回归 pin

`src/ui/view.test.ts` 新增三条**运行时**断言(#4642 已证本包的编译期 pin 空转:`tsconfig.json` 排除 `**/*.test.ts`,vitest 也不开 `typecheck`)。其中第三条用 TypeScript compiler API 在 `src/` 上做符号身份解析 —— 因为 `HttpRequest` 是**类型**,运行时看不见它,而这恰恰是本簇唯一改动的东西。三条已 sabotage 验证会红:

- 还原旧的本地 infer 别名 → `expected 'src/ui/view.zod.ts:2056' to be 'src/shared/http.zod.ts:54'`
- 删掉 re-export 不补 → ``./ui must still export the name `HttpRequest` ``
- 在 `./ui` 重新声明第二份 `HttpRequestSchema` → 运行时身份断言失败

## 未纳入:紧邻的 `HttpMethod`

`ui/view.zod.ts` 下一行的 `export type HttpMethod = z.infer< typeof HttpMethodSchema >` 是**完全相同的形状**,基线行 `HttpMethod — [./api, ./shared (type)] ≠ [./ui (type)]` 仍在。#4535 已把它排进 v18,范围由维护者定,故本 PR 不动它。
