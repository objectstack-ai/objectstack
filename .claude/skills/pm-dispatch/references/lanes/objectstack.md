# 车道岗位说明:repo:objectstack(全仓调度)

见 area-lease.md;本文是本车道的岗位说明,现值状态恒在座位贴,⛔ 不迁入本文件。

## 形态

- 席位 `repo:objectstack#N`,可多席、多账号;签名、座位贴、信箱、坐席与收班同他席。
- 每席照 area-lease.md 分区运作:区线程、复核线程、区内落地;本文只写全仓与多席特有者。
- ⛔ 非单车道仓席:cross-repo-coordination.md 单车道仓条、seat-lifecycle.md 单车道仓行不适用。
- 首触、定级与 `domain:*` 仍归分诊(`triage-duties.md`);本车道 ⛔ 不产、不改 `domain:*`。
- ⛔ 不给卡挂 `repo:objectstack` 标签:本车道按仓认卡,该标签另作缝卡读(H14)。

## 范围

- 本仓全部可认领卡,跨各 `domain:*`;`domain:*` 只定文件归属与串行(SKILL.md 域车道)。
- 不认领:涉 cloud 整卡归 `repo:cloud` 席;安全公告归 `security` 席;他仓卡归各仓车道。
- 只缺 cloud 事实读数的卡留道,敲 cloud 席 `Request: cloud-confirm`。
- 域车道席照常运作:卡有他席 assignee、`Claim:` 或他席 `lease:*` ⇒ 不碰,⛔ 不抢不等。
- 跨车道卡的留道、复核与通知照 area-lease.md 区内规则,⛔ 本文不另抄。

## 多席分工

- 区是全车道互斥单位:一区一时只归一席;各席租约表住本席座位贴,合即全车道租约。
- 区名全车道唯一,带席号前缀(如 `o2-A3`);`lease:` 标签随区名。
- 开区、拆并或接区前,读本车道与域车道各在座席的租约表;路径相交 ⇒ 不开,写信协商。
- 定区同轮写本席租约表,并向各兄弟席发 `Notify: split`,takes/leaves 写区名与路径根。
- 本车道以区租约代替 `execution-duties.md` 多席奇偶交替;认领戳仲裁不变。
- 两席同刻声明同一区:座位贴改动戳早者持有;晚者撤区重划,⛔ 不并持。
- 区间同文件:对在飞 PR 跑 `git merge-tree`,真交叠才排队并 `Notify: serial`;⛔ 不按文件独占。
- 席收班:各区在飞照 seat-lifecycle.md 收班行交在线兄弟席;接手席同笔改写两席租约表。

## 落地与归维护者

- 非受管 PR 区内落地照 area-lease.md;受管面与超 3,000 行 PR 交席,照 SKILL.md〈路径分叉〉。
- 开席、加席、收席与并发由维护者定;需裁事项照 SKILL.md〈升级与决策〉,中文呈报。
