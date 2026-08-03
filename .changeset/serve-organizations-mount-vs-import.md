---
"@objectstack/cli": patch
---

fix(cli): `os serve` 区分「多组织包缺席」与「插件自己拒绝挂载」(#4818)

`os serve` 在走 walled posture(`OS_TENANCY_POSTURE=group` / `isolated`)时,
把 `importFromHost('@objectstack/organizations')` 和
`kernel.use(new mod.OrganizationsPlugin())` 放在**同一个 `try`** 里,于是插件在
**构造 / 挂载**阶段抛出的任何错误都被当成「包加载不出来」上报:文案说
`@objectstack/organizations could not be loaded`,给出的出路里包含
`OS_ALLOW_DEGRADED_TENANCY=1`,而该 env 已设时更会把它**降级成一条 warning 并继续启动**。

这是两件事,解法相反:

| 事实 | 解法 | `OS_ALLOW_DEGRADED_TENANCY` |
|---|---|---|
| 包缺席 | 装上它 / 改单组织 | 适用(operator 明确接受能力缺席) |
| 插件拒绝挂载 | 按插件自己报的原因处理 | **不适用** |

合并后的代价是实打实的:包明明在镜像里,日志却把人指向模块解析 / `NODE_PATH` /
依赖 prune;更糟的是那条逃生口会吞掉插件自己的拒绝,等于把插件在守的闸门搬到一个
env 变量上。

现在按**哪个阶段抛错**分类(不看错误形状 —— 该包是 `importFromHost` 动态加载的,
CLI 与它可能持有不同模块实例,`instanceof` 和具名 `code` 判据都脆;framework 也不该
编码插件的私有语义):

- **import 阶段失败 = 包缺席** —— 行为完全不变:同样的 ADR-0093 D5 文案,
  `OS_ALLOW_DEGRADED_TENANCY=1` 依旧可以显式降级启动。
- **构造 / 挂载阶段失败 = 插件自己拒绝** —— 原样上报插件的错误(message,以及它自带的
  `code`,通用打印、不作解释),明说包**已找到并加载**、不必去查模块解析,并声明
  `OS_ALLOW_DEGRADED_TENANCY` 对这条路径**不适用**;**无条件 `process.exit(1)`**。

ADR-0093 D5 的态度不变:要求了隔离就不能假装有,仍然拒绝启动 —— 变的只是「为什么拒绝」
和「告诉 operator 什么」。唯一的行为变化是 `OS_ALLOW_DEGRADED_TENANCY=1` 不再能让一个
拒绝挂载的多组织插件被吞掉并继续启动;若你此前依赖这一点,请改用
`OS_TENANCY_POSTURE=single`,或处理插件报出的原因。
