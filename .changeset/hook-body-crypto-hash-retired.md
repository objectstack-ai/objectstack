---
"@objectstack/spec": major
"@objectstack/cli": major
"@objectstack/runtime": major
---

refactor(spec,cli,runtime)!: 退役 `crypto.hash` 能力 —— 声明了四层、构建期还自动推断,沙箱从没实现(#4391,ADR-0049 enforce-or-remove)

`crypto.hash` 是四层声明、零层实现:`HookBodyCapability` 枚举收它、枚举旁的文档表列它、CLI 提取器**自动推断**它、`ScriptContext.crypto.hash` 还写了签名 —— 而 `installCtx` 只往 VM 的 `ctx.crypto` 上装了 `randomUUID`。于是这个 token 唯一授权的那次调用,**每一次都在 VM 里抛**。

这比普通的 declared ≠ enforced 更毒一档,坏就坏在**构建期推断**:作者(尤其是 AI 作者)写下 `ctx.crypto.hash(...)`,提取器就替他把能力加进 `capabilities`,`os build` 因此全绿 —— 系统亲手把人送进一条必炸的死路,而唯一诚实的记录是文档表格里一句 `_(not yet wired)_`,没有作者会先读表格再写 body。

**裁决是 remove,不是实现**(维护者 2026-08-02):从未实现、调用即抛、**零投诉** —— 对一个每次使用都抛错的能力来说,这本身就是最强的活性证据,没人需要它。在沙箱里实现 crypto 会扩大沙箱的能力面与安全审查面,那是长期成本而非一次性工时,无业务拉动不做。真需要哈希时按能力准入流程重提:**实现先行,声明随实现走**(ADR-0049 的 enforce 腿留给有实现的那天)。

## FROM → TO

| 写了什么 | 现在怎么办 |
| :--- | :--- |
| `capabilities: ['crypto.hash']` | **删掉这个 token**。它从未授权成任何东西 |
| `await ctx.crypto.hash(algo, data)` | **删掉这次调用**。它从未返回过值 —— 今天能跑的代码没有一行依赖它 |
| 确实需要哈希 | 在 host 侧做(Connector recipe,或引擎侧 hook)。沙箱内哈希须走能力准入流程重开,实现先行 |

一句话修法:**两个都删**。`os migrate meta --from 16` 会自动帮你剥掉 token;那行**死调用是你自己要删的** —— 转换层刻意不改 body 源码(见下)。

## 定级理由(逐条自证,未照抄前例)

三问按 #4535 §5 逐条走:

1. **会不会 TS2305 / TS2339?** 会,两处。`HookBodyCapability` 是 public 导出类型,把它当**字面量联合**用的代码(`const c: HookBodyCapability = 'crypto.hash'`、对 token 做穷举 switch)现在编译失败;`ScriptContext.crypto.hash` 的调用点以 TS2339 失败。实测三仓(objectstack / cloud / objectui)裸名扫描 `crypto.hash` / `ctx.crypto.hash` / `'crypto.hash'` —— **两个兄弟仓零命中**,本仓命中全在本 PR 内清理。
2. **有没有元数据迁移?** 有。token 是写在作者源 hook/action body `capabilities: []` 数组里的**值**,也会躺在已存的 `sys_metadata` 行里 —— 故注册了 ADR-0087 D2 转换 `hook-body-crypto-hash-removed`(D3 挂 protocol-17)。这是与 #4767 / #4783 / #4616 的分界:那三单退役的是**导出名 / 运行时描述符**,没有作者源可改写;本单有,和 `object-enable-trash-mru-removed` / #4734 同侧。
3. **形状变更?** 是**枚举值收窄**(6 → 5),不是 key 移除。故**没有 `retiredKey()` 墓碑** —— `capabilities` 这个 key 本身依然活着、依然被强制。处方改由枚举自己的 error map 承载,并按 `object.managedBy: 'system'` 的先例**以 `issue.input` 为键**:只有「曾经合法」的那个拼写会被告知「was removed」,写错成 `crypto.hsah` 的作者拿到的仍是 zod 自己那条列出合法 token 的消息 —— 告诉他「你的值被退役了」属于误导。

`@objectstack/cli` 与 `@objectstack/runtime` 同定 **major**:前者 `ExtractedBody.capabilities` 的公开联合类型收窄(赋值给它的代码 TS2322),后者 `ScriptContext.crypto` 少一个成员(TS2339)。

## 门禁实报

枚举值收窄对四张 ratchet **全部不可见**,这一点值得单独记一笔:`authorable-surface.json` 记到 key 级(`data/ScriptBody:capabilities`),`json-schema.manifest.json` 记 def 名(`data/HookBodyCapability` 仍在),`packages/spec/json-schema/` 本身 gitignore。所以 `check:authorable-surface` / `check:api-surface` 实跑**零变化**,`check:liveness` / `check:empty-state` 同样 PASS(`capabilities` key 仍活,不产生台账行变更)。

也就是说:**本次移除没有任何一张基线能自动兜住它** —— 兜住它的只有本 PR 新增的 pin 测试(spec / cli / runtime 各一组,已 sabotage 实跑验证复活即红)。`check:generated` 8/8 绿,移动的是 `spec-changes.json`、`docs/protocol-upgrade-guide.md` 与两页生成参考文档(`data/hook-body.mdx`、`ui/action.mdx`,枚举选项随之少一项)。

## 转换刻意不做的事

`hook-body-crypto-hash-removed` 只从 `body.capabilities` 里剥掉死 token,**不碰** body 源码里那行 `ctx.crypto.hash(...)`。这是有意的:那行调用从未返回过值,剥掉授权不会让任何还能跑的东西变坏;但把它一并「修好」会让作者失去唯一一个还在提醒他「这里有段死代码」的信号。`retiredFromLoadPath: true` —— 枚举当场拒绝,活作者在 parse 时就被教育,转换存在的意义是让已存的 16.x / 17-rc 行重放干净(否则永远被打成 `metadata_spec_invalid`,把链上历史误标成当期违约)以及让 `os migrate meta --from 16` 改写作者源。
