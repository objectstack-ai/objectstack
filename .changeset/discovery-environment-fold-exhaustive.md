---
"@objectstack/spec": minor
---

feat(spec): `preview` / `trial` 的 discovery 折叠改为显式声明,并让折叠表对 EnvironmentType 穷尽 (#6287)

`EnvironmentTypeSchema` 有七个成员,而 `NODE_ENV_TO_DISCOVERY_ENVIRONMENT`
(`api/discovery.zod.ts`)只为其中五个写了条目。`preview` 与 `trial`
一直是靠 `resolveDiscoveryEnvironment` 末行的 `?? 'development'`
兜底落到 `development` 的 —— 不是一条被写下来的决定,而是掉出表尾的副作用。
这张表的注释本来就写明它是给后来者读的,读表的人会以为它是全的。

## 行为变化(唯一一处,消费者可见)

`resolveDiscoveryEnvironment` 对两个输入的返回值改变:

| `NODE_ENV`(或任何 operator 提供的字符串) | 之前(兜底) | 现在(声明) |
|:---|:---|:---|
| `preview` | `development` | `sandbox` |
| `trial`   | `development` | `sandbox` |

`/discovery` 的 `environment` 字段是机器可读面,客户端读它回答「我是不是在跟生产说话」,
并据此决定要不要放宽破坏性操作的二次确认。折向 `sandbox` 的三条理由:

1. **它们在本仓语义里是什么。** 本仓的 environment 是被开通的运行容器 —— 独立数据库、
   规范主机名、套餐档位、按环境的 RBAC(`cloud/environment.zod.ts`)。`preview` /
   `trial` 是这种东西,不是 `development` / `dev` / `test` 所描述的开发机与 CI 的一次性运行;
   `sandbox` 正是这个枚举里「已开通的准生产」那一档。
2. **姿态按收紧方向取。** `trial` 尤其装着评估中客户的真实业务数据,答 `development`
   是**低报**姿态 —— 与 #5673 / #5936 把 unset 一行翻成 `production` 所要避免的是同一类错误,
   只是低一档。两者都不是 `production`:它们按定义就不是客户的生产部署,报 `production`
   会让这个字段唯一要回答的问题朝另一个方向答错。
3. **它保住了作者的区分。** 把环境标成 `preview` 的人手里本来就有 `development` 和 `test`
   而没有选;折到 `development` 会把这个选择携带的唯一信息抹平。

其余五行、unset → `production`(#5673 / #5936)、未识别拼写 → `development`(#4828)
三条规则一概未动。

## 漏补条目从此不编译

折叠表拆成两张:声明面 `Record<EnvironmentType, DiscoveryEnvironment>`(七个成员,穷尽),
与 operator 便利拼写 `prod` / `dev`(不属于词表,单列以免污染穷尽标注),合并后仍是原来那张查找表。
给 `EnvironmentTypeSchema` 加一个桶而不说它折向哪里,现在直接**编译不过**。

这是**编译期**而非运行期断言,因为运行期断言看不见这个缺陷:兜底与三条已声明的行都产出
`'development'`,所以调 `resolveDiscoveryEnvironment` 得到的答案在「有条目」与「`??` 现编」
两种情况下完全一致 —— 一条运行期穷尽测试在 #6287 报告的那个坏状态下本来就是绿的。

`?? 'development'` 兜底保留,职责收窄为它真正服务的那一类:既不是词表成员、也不是
operator 简写的任意字符串(`qa`、`uat`、拼错),`NODE_ENV` 是 operator 提供的自由文本,
这一类是真实输入,把它降级到 `development` 正是「猜测不得声称 production」。
