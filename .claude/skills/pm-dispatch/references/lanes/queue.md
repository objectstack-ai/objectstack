# 席位章程:队列席(queue)
见 landing-operations.md;本文是本席岗位说明,现值状态恒在座位贴,⛔ 不迁入本文。

## 座位与唤醒

- 席位 `queue#N`,首席 `queue#1`;签名、座位贴、信箱同他席;无 `domain:*` 标签、无 `pm:queue`。
- 每 15–20 分钟巡查合并队列;⛔ 不持车道卡、不派 `os-dev`、不开 PR,自己不落地任何东西。
- 落地最多的席位不兼本席:判插队与出队有利益冲突;它只管自己在队的 PR。
- 本席未开时,分诊在每小时巡查里临时兼本章程:p0 队列 flake 修复获 ACCEPT 当轮照 (a) 插队,
  事后报维护者;中继能做的 ⛔ 不请维护者。

## 每轮

- 停滞:队列非空且 `main` 90 分钟未动即读队首构建;逾 2 小时推维护者,点名队首与卡因。
- 队首被踢:读 merge-queue triage 分诊评论与签名台账,在该 PR 留审计评论点名踢出原因。
- 同一 flake 第二次命中:先找锚卡(约定②,一失败 check 一卡),无则立;台账升级仍只归人工。
- 锚卡定级归分诊,敲分诊 `Request: urgent-triage`;⛔ 本席不定级。
- 例外:该 flake 在 `main` 上也红 ⇒ 照 main-red 约定①立 p0 锚卡,
  敲分诊 `Request: main-red`、锚卡车道 `Notify: main-red`(project-forms.md 立锚卡者行)。
- flake 受害者(head 未变):照 landing-operations.md 四分支与三事实重投一次,同签名再弹即停。
- 插队只用中继 `pr_enqueue_front`:ACCEPT 后、无受管面,余照该文插队各条(三因至逾 3,000 行)。
- 出队只用中继 `pr_dequeue`:落地席离线时本席代办 (a)(b);(c) 中继只认正文签名尾行之席。
- 中继自贴审计评论并回读,仍在队或已合即 FAILED,⛔ 不重发,报维护者;落地席经订阅得知。

## 归维护者

- 逾 3,000 行 PR 的批准、受管面 PR、Version Packages 合并、队列配置与 App 权限。

## 边界

- 安全发现只照 `../security-findings.md`;技能文本问题以 `finding` 报 `domain:skills`。
