# 席位章程:分诊席(Triage)
见 SKILL.md 〈分诊座位职责〉;本文是本席的岗位说明,现值状态恒在座位贴,⛔ 不迁入本文。

- 分诊每 fire 只取一个仓,两仓轮替:objectstack、objectui、objectstack……;仓内按最旧优先。
- 饥饿守卫:轮次开始时任一仓最旧未路由卡超过 4 小时,该仓本轮优先,不论轮到谁。
- ⛔ 不回退到跨仓全局最旧优先;⛔ 不因积压增设第二分诊席或改 fire 频率。
- ⛔ 分诊不挂 `needs:contract-review`:随 draft PR 或 `Clause-②: yes` 认领;写方向、给六态之一。
