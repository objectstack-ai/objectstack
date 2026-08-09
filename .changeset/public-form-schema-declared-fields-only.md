---
"@objectstack/rest": minor
---

fix(rest): 未声明字段的公开表单不再向匿名调用者发布目标对象的**全部**字段(#6601)

`GET /api/v1/forms/:slug` 会把目标对象的 schema 一并内嵌进应答,好让匿名前端不必再走
一次需要鉴权的 `/meta` 就能渲染表单。收窄的依据是表单 `sections` 声明的字段集合,但那段
代码写的是:

```ts
if (allowed.size === 0 || allowed.has(name)) { fields[name] = def; }
```

`allowed.size === 0` —— 表单**没有 sections**,或者 sections 一个字段都没声明 —— 会
落到「发布该对象每一个非 server-managed 字段」这一支。**这条路由是匿名的**,所以发出去的
是完整的字段定义:label、type、picklist 的选项值(常常就是一份运营分类表)、formula
表达式(定价/评分 IP)。下方的 `safeForm` 只过滤表单自己的 `sections`(未声明
`publicPicker` 的 lookup),它与 `objectSchema.fields` 是同一份应答上的两个并列键,从不
收窄后者。那段代码上方注释里的「limited to fields referenced by the form」在这一支上是
不成立的;注释同时提到的「submit 侧仍有服务端字段白名单」是**写**侧防线,挡不住**读**侧
的披露。

「表单先建、sections 之后再配」是完全正常的编写中间态,所以这不是一个刁钻配置。
ADR-0106(#3682)刚刚让平台能完整地讲出「调用者读不到的字段,对它而言在任何平面上都不
存在」这句话,而这条路由是它剩下的那个反例,且调用者是**匿名**的。

**行为变化(线上可见)。** 发布集合现在等于表单声明的字段集合本身:

```ts
if (!allowed.has(name)) continue;
```

一个字段都没声明的表单,`objectSchema.fields` 就是 `{}`。应答的信封形状不变
(`objectSchema` 仍是 `{ name, label, fields }`,不会变成 `null`),`object` /
`label` / `form` 几个键也都不变。**已经正常声明了 sections 的表单,应答逐字节不变** ——
它们本来走的就是 `allowed.has(name)` 那一支。

这里没有新增任何可编写的键。发布应当是一次**声明**,而不是从空集合里掉出来的默认值
(AGENTS.md「Explicit composition over default magic」);真需要「整对象发布」的场景,
带着真实用例来提,再按 ADR-0049「没有需求牵引就不造能力」的顺序决定要不要造这个开关。

`PUBLIC_FORM_SERVER_MANAGED_FIELDS` 的处理(#3022 的 server-managed 锚点)完全未动,
`POST /forms/:slug/submit` 与 `GET /forms/:slug/lookup/:field` 也都未动。
