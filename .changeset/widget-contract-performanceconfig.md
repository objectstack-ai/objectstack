---
---

docs(protocol/objectui): widget-contract 不再教已删除的 `PerformanceConfig` (#4996)

`content/docs/protocol/objectui/widget-contract.mdx` 的「Performance」小节逐字写着「Performance tuning is supplied through the shared `PerformanceConfig` schema (`packages/spec/src/ui/responsive.zod.ts`)」,而 `PerformanceConfigSchema` / `PerformanceConfig` 早在 #3896 的 audit close-out 就被删掉了 —— 该文件里现在是一条墓碑注释,`responsive.test.ts` 里对应的用例也随之移除。同一页的 `WidgetManifest` 接口块还列着 `performance?: PerformanceConfig;`。这一页不是生成物(`packages/spec/scripts/` 下没有任何生成器写它),所以没有闸门会自动纠正,它才活到今天。

议题里悬着的那个前提问题 —— 「manifest 的 `performance` 是 objectui 自己的字段,还是被退役的那三个 spec 键?」 —— 用代码即可判定,不需要 objectui 分片确认:`WidgetManifestSchema` 就住在本仓 `packages/spec/src/ui/widget.zod.ts:273`,它的 `performance` 已经是 `retiredKey(...)`,也就是 `z.never()`。所以这个键不只是「没了」,而是**会在 parse 时被拒**:照文档写 `performance:` 的 manifest 今天直接校验失败。生成的 `content/docs/references/ui/widget.mdx` 早已如实标注 `[REMOVED]`,只有这份手写页还在反着说 —— 生成面与手写面对同一个键给出相反指令,正是 AI 作者最容易踩的形态。

处置取「改写」而非「整段删」:虚拟滚动这个真实用例并没有退役,只是换了载体 —— 活的开关是 list 形态视图上的顶层布尔 `virtualScroll`(`ListViewSchema`,`packages/spec/src/ui/view.zod.ts:909`)。整段删掉会让记得旧键的作者失去落点,于是本节改成说真话:manifest 上没有 performance 块,虚拟化配在**视图**上,并用一条 `warn` callout 点明该键在 17.0.0 被移除且现在会被拒、请删掉。接口块里的 `performance?: PerformanceConfig;` 一并删除。

顺带修掉同一次删除留下的第二个活指针:`layout-dsl.mdx` 的 Related Resources 把 `/docs/references/ui/responsive` 描述成「Responsive and performance configuration」,而那页生成出来已经零 performance 内容,改为「Breakpoint layout and scoped responsive styles」。

全仓复查后 `PerformanceConfig` 的其余出现全部是历史记述(墓碑注释、CHANGELOG、既往 changeset、release notes、liveness 台账、ADR-0021 当时的决策记录、审计日志),按 #4832 的活指针/历史记述区分标准一律保留。纯文档,releases nothing。
