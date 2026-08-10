---
"@objectstack/service-settings": patch
---

fix(service-settings): 写入路径与 env 路径执行 settings 声明的 `step` 网格 (#6199)

`step` 是 `SpecifierSchema` 五个值约束里的**第五个**,也是最后一个只声明不执行的。
#5932(PR #6201)补齐 `min`/`max`/`minLength`/`maxLength` 之后,`step` 在
`packages/services/service-settings/src/` 里仍是**零读取点**:superRefine 不校验它,
写入路径不读它,env 路径不读它。

**为什么判定为「值约束」而不是「纯 UI 提示」。** issue 提了两种读法,定论取自 schema
自己的写法:`step` 与 `min`/`max` 声明在**同一段** `/** number / slider: numeric
bounds and step. */` 注释之下,即它是按「界」被作者写下的,而 #5932 的裁决(声明了
的界就必须绑定)随之传递。另一种读法(它只是 `input[type=number]` 上下箭头的步进,
从不表达「其他值非法」)经核查不成立:落地时 `step` 在本仓库与 `objectui` 中**没有
任何消费者**——没有渲染器读它。按那种读法,这个键就是在为一个并不存在的渲染器表达
「呈现」,那正是 ADR-0049 的洞,而不是 UI affordance。

**修法与 #5932 同形,是同一族的第五个成员:**

- `step` 挂进 `DeclaredBounds` 与 `firstRangeViolation`,因此它按构造同时到达两扇门
  ——写入路径(`validatePatch`)与 env 路径(`effectiveEnvOverride` 这**一个**判定点)
  ——不可能成为「只在一侧执行」的下一个键。
- 越界发码表里现有的 `invalid_value`(ADR-0114:「rejected for a reason no other
  member names」)。码表里没有任何成员命名「网格」,而码表是刻意封闭的;
  `rest-server.ts` 早已把 Zod 的 `not_multiple_of` 映射到同一个成员,即同一条件从另一
  个方向到达时的同一裁决。⛔ `packages/spec` 未改动。
- 沿用 #5131 / #5932 的 **TOUCH 闸门**:只校验本次 patch 触及的键。网格在产品生命
  周期里会被**放粗**(0.05 的滑杆改声明成 0.1),持有旧值的工作区必须仍能编辑无关设置。

**锚点(anchor)约定:** 值须落在 `min + k * step` 上;未声明 `min` 时锚点取 `0`。
这是 HTML step-base 约定,也是声明读起来的唯一自洽含义 —— `min: 1, step: 2` 指的是
**奇数**,而不是偶数;一律锚 0 会把这个 specifier 整个反转。`constraint` 同时带
`step` 与(声明了的话)`min`,客户端据此自行重建网格。

**容差规则:** 网格判定为 `|value - nearest| <= max(|value|, |anchor|, |step|) * 1e-9`,
其中 `nearest = anchor + round((value - anchor) / step) * step`。精确取模是错的 ——
二进制浮点下 `0.7 / 0.1` 是 `6.999999999999999`、`1.2 / 0.1` 是 `11.999999999999998`,
而这两个都是控制台滑杆自己会发出的值。容差取**相对**而非绝对:绝对量随操作数变化,
`1e-9` 在 `step: 1e-6` 上会宽到三分之一步长,在 `max: 1048576` 上又比一个 ULP 还紧。
`1e-9` 落在两类误差之间:double 的相对精度约 `2.2e-16`,几步算术累积约 `1e-15`,比这
个界低六个数量级;而真正的越格差一小截步长(`0.15` 在 `0.1` 网格上差 `0.05`,相对
`3e-1`),比它高八个数量级。比较在**值域**而非倍数域进行,以免容差的含义随网格粗细改变。
剩余存疑的方向也是刻意的:本闸门是对「昨天什么都收」的收紧,所以在算术确实分辨不出时
(量级大到网格比 double 自身间距还细)判**收**。

**非正的 `step` 声明不构成网格。** `step: 0`(`anchor + k * 0` 是一个点)、负值、
非有限值一律**不记录网格**,与「option-bearing specifier 没有 options 表」同一处置:
无可执行者,行为不变,永不拒写。这与 #5204 的注册期姿态一致 —— 注册**报告**、从不
拒绝 —— 而这里没有可报告的:声明了不可能网格的 manifest 既不拒写也不误配部署,它只是
没有约束住,和其余没声明 `step` 的 specifier 处境完全相同。

**已知后果,裁决时已接受:** 全仓库唯一的 `step` 声明是 `ai.manifest.ts` 的
`temperature`(`min: 0, max: 2, step: 0.1`)。执行之后 `0.15` 被拒。这是该声明按其
字面绑定,而不是本闸门的缺陷;这份声明本身是否该改(若 `0.15` 应当合法,则该 manifest
应声明更细的 `step` 或不声明),属于 manifest 属主的问题。
