---
"@objectstack/plugin-auth": major
"@objectstack/verify": minor
---

BREAKING(auth): `organization/create` 改判**实际生效的** tenancy posture —— 没有组织墙的部署不再能创建组织 (#5261)

`POST /api/v1/auth/organization/create` 的闸门此前判的是操作者**请求的** posture
(`postureEnforcesWall(resolveTenancyPosture())`,一次纯 env 读)。现在判 `tenancy` 服务给出的
**生效** posture —— `tenancy?.posture ?? resolveTenancyPosture()`,与 `/auth/config` 的
`features.multiOrgEnabled` 是**同一次求值**。

## 为什么

两个站点此前只在一种形状下分叉,而那种形状恰恰是最不该放行的一种 —— ADR-0093 D5 **降级态**:
请求了 `isolated`/`group`,但企业包 `@objectstack/organizations` 缺席,于是 `tenancy.posture`
解析为 `single` 且 `degraded=true`。此时:

- 闸门读「请求」→ **放行**;
- `/auth/config` 读「生效」→ `multiOrgEnabled=false`,console 把「创建组织」入口**藏起来**。

结果是 UI 没有按钮而 API 打得通,并且建出来的每一个组织都是**没有任何引擎强制的租户边界** ——
声明了但没强制,ADR-0049 最讨厌的那一类,只不过发生在部署层。改判生效 posture 之后两者同解、
永不分叉:**没有墙,就没有组织**,无论这个部署是从未要过墙,还是要了没拿到。

## 破坏性影响(有意为之)

**没有安装企业包 `@objectstack/organizations` 的部署将完全无法创建组织**,任何 env 组合都不行 ——
`OS_TENANCY_POSTURE=isolated`、`OS_MULTI_ORG_ENABLED=true`、两个一起设,都不再能把闸门说通。
这是一次实打实的能力收缩,不是 knob 纠正,所以搭 v17 主版本车。

| 部署形状 | 改前 | 改后 |
|---|---|---|
| 有企业包,posture `isolated` / `group`(墙真的立着) | 200 | **200**(不变) |
| **请求了墙但企业包缺席(D5 降级态)** | 200 | **403** ⚠️ |
| `single` / 两个 knob 都不设 | 403 | 403(不变) |
| 未注册 `tenancy` 服务的精简嵌入(回落 env 解析) | 按 env | 按 env(不变) |

`serve.ts` 本来就在降级态**默认拒绝启动**(要 `OS_ALLOW_DEGRADED_TENANCY=1` 才走),所以这条收缩
命中的是一个已经需要显式选择才能到达的形状:从此那里的 org-create 路由也一并拒绝,而不是半通不通。
cloud 控制面与任何装了企业包的部署不受影响。

**迁移**:需要多组织能力的部署安装并声明 `@objectstack/organizations`(ADR-0081 D2)。仅靠 env
声明一个墙、而没有实现它的运行时,不再被当作多组织部署对待。

## `@objectstack/verify`(minor,新增)

`BootOptions.multiTenant` 增加 `'posture-only'` 取值:注册一个内置的 `org-scoping` 服务替身,
让 `tenancy` 服务解析出真实、**非降级**的 `isolated` posture,从而打开受 posture 把守的路由 ——
供那些「组织墙是**前置条件**而非被测对象」的 fixture 使用(#3624 的 `org-create-default-team`
dogfood 就是为它而建:那条回归此前靠「boot 后翻 env、闸门 live 读」开路,本次收缩把这个绕法关死了)。

⛔ 它**不做任何租户隔离**:不 stamp `organization_id`,不 scope 任何查询 —— 它让部署的
**posture** 为真,不是让**墙**为真。跨租户隔离的唯一诚实证明仍然是 `multiTenant: true` +
真实的企业包,这也是那些 gate 在本仓继续 skip 而不是假装通过的原因。
