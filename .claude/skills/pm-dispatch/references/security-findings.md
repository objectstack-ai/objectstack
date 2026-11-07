# 安全发现:公开仓永不立卡,永不公开机制

任一座位、dev 与 QA runner 在任一仓碰到安全发现时读本文;他处只指向本文,⛔ 不复述。

## 1. 什么算

- 认证或授权缺口;跨租户或跨组织的读或写;提权;可绕过的限流或锁定。
- 泄露或明文存储的密钥与凭据;注入;存在性探针(能答出某条记录在不在)。
- 拿不准 ⇒ 按安全发现办。

## 2. 永不公开

- 公开仓 ⛔ 不立 issue(私有仓照第 3 节),锚卡、跟踪卡与收口卡也 ⛔ 不提。
- ⛔ 机制不进 PR 标题、正文与评论,提交信息,changeset,复核记录,信箱。
- 测试名写规则,⛔ 不写攻击。

## 3. 私卡:公开仓是安全公告(选 B),私有仓是 `security` issue

- 分辨看受影响仓的 `private` 标志,立私卡时经 API 现读,⛔ 不凭记忆。
- 公开仓私卡 = 一份未发布的安全公告,只有管理员、安全经理与受邀协作者可见。
- 首选中继 `advisory_create` 建草稿公告,再 `advisory_collaborators_add` 带具名账号进公告。
- 读公告只走中继 `advisory_read`(席位账号读被拒):一次性密钥只在席位进程,只回密文。
- `advisory_report` 与 `advisory_create` 同铸公告写权,无此权的仓两者皆拒;私报另有账号日限。
- ⛔ 席位永不以自身账号私报或写公告:GitHub 写只走中继,以 App 身份。
- 只发维护者为该版批准的清单:经中继先定版本再发布;运行编号记座位贴,⛔ 无正文。
- 两操作皆被拒 ⇒ 会话专递(选 A):机制只在会话里交维护者,由其建草稿,⛔ 不换账号重发。
- 回退时座位贴只写不透明编号与状态,⛔ 无细节。
- 公开仓修复只由 `security#1` 席以无卡派发令派 `os-dev`,`xhigh`;机制只进派发令与公告。
- 用到公告的临时私有 fork ⇒ 修复从该 fork 落地。
- 私有仓私卡 = 该仓带 `security` 标签的普通 issue,经中继 `issue_create` 立,机制写在其中。
- 私有仓修复由 `security#1` 席照该卡如常派发,`xhigh`;⛔ 不另起无卡派发令或公告。

## 4. 跨仓发现者(应用仓量框架、cloud 席位)

- 在受影响仓照第 3 节立私卡;中继被拒 ⇒ 机制在会话里交维护者。
- 公开面至多一行「a security item is with the maintainer」,⛔ 无细节。

## 5. os-dev 报告

- dev 把安全发现只写进终报私有字段 `security_findings`,⛔ 不进 `out_of_scope_findings`。
- 报告评论里该字段只写 `withheld` 或 `none`。

## 6. 修复 PR

- 标题、正文与 changeset 只写加固规则,形如 「the door reads in the caller's scope first」。
- 正文、验证、消融只写规则与计数(红、后复原);未守卫代码做什么只进 `security_findings`。
- 私有仓同此,提交信息亦然,只链该 issue:仓可转公开,历史随之公开。
- 契约复核记录停在规则层;机制只进复核者本地的 `security-note.md`,⛔ 不提交。
- 修复要定契约的,交维护者。

## 7. 已误公开

- ⛔ 不追加细节;挂 `security` 标签;即推维护者(`lanes/triage.md` 即推 ①)。
- 是否移入公告并关 issue 由维护者定,⛔ 席位不代关。

## 8. 一处成文

- 立卡门、server 与 security 车道、信箱、`checklist-test` 与 `os-dev` 只指向本文,⛔ 不留第二份。
- ⛔ 本规则不新增门禁、不新增标签。

## 9. 归属:`security#1` 席

- 每份安全发现从接收到发布归 `security#1` 席(章程 `lanes/security.md`),发现者只报不修。
- ⛔ 不扩本 PR 或分支,不自开修复分支,不在同一面顺手加固;dev 只走第 5 节上报。
- 席位与 QA runner 两件事:照第 3 节建私卡;敲 `Notify: security · GHSA-ID`(私有仓 `#N`),只带编号。
- 中继拒(第 3 节)⇒ 机制在会话里交 `security#1` 席;席空缺 ⇒ 交维护者;发布清单归维护者。
- 任务绕不开它 ⇒ 报 `blocked`,只写「a security item is with the owner seat」;席位停卡,⛔ 不绕行。
