# 车道岗位说明:repo:objectstack(全仓调度)

见 area-lease.md;本文是本车道的岗位说明,现值状态恒在座位贴,⛔ 不迁入本文件。

## 形态

- 席位 `repo:objectstack#N`,可多席、多账号;签名、座位贴、信箱、坐席与收班同他席。
- 一个项目在本车道至多一席;席接哪些 `area:*` 是该席的属性,写在座位贴说明段的接卡行。维护者再点一个 `area:*` 是改该席的接卡面并在席内分区,⛔ 不是加席(`coordinator.md` 一)。
- 每席照 area-lease.md 分区运作:区线程、L1 线程、区内落地;本文只写全仓与多席特有者。
- ⛔ 非单车道仓席:cross-repo-coordination.md 单车道仓条、seat-lifecycle.md 单车道仓行不适用。
- 首触与 `domain:*` 归分诊(`triage-duties.md`);本车道立卡带 area/type/级,⛔ 不产、不改 `domain:*`。
- ⛔ 不给卡挂 `repo:objectstack` 标签:按仓认卡;该标签已退流通。

## 范围

- 本仓全部可认领卡,跨各 `domain:*`;`domain:*` 只定文件归属(SKILL.md 域车道)。
- 不认领:涉 cloud 整卡归 `repo:cloud` 席;安全公告归 `security` 席;他仓卡归各仓车道。
- area-lease.md 认领前重读行的「他区」在本车道读作他席或他区。
- 跨车道卡的留道、L1/L2 审核与通知照 area-lease.md 区内规则,⛔ 本文不另抄。

## 多席分工

- 区是全车道互斥单位:一区一时只归一席;各席租约表住本席座位贴,合即全车道租约。
- 区名全车道唯一,带席号前缀(如 `o2-A3`);区名只记租约表与认领评论的 `Area:` 行。
- 开区、拆并或接区前,读本车道各在座席的租约表;路径相交 ⇒ 不开,写信协商。
- 区名与路径根只住租约表;定区同轮写本席表,`Notify: split` 照其模板只列卡号。
- 本车道以区租约代替 `execution-duties.md` 多席奇偶交替;认领戳仲裁不变。
- 定区同笔在座位贴评论一行区声明;两席争一区,该评论先到先得(seat-lifecycle.md 竞态三招)。
- 区间同文件:对在飞 PR 跑 `git merge-tree`,真交叠才排队并 `Notify: serial`。
- 上行例外:`SINGLE_CLAIM_PATHS` 仍照 `execution-duties.md` 单写。
- 席收班:在飞照 seat-lifecycle.md 收班行交兄弟席;收班席删己表行,接手席写入己表。

## 落地与归维护者

- 落地与交席照 area-lease.md 区内规则与 SKILL.md〈路径分叉〉。
- 开席、加席、收席由维护者召唤;需裁事项照 SKILL.md〈升级与决策〉。
