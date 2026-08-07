---
"@objectstack/mcp": minor
"@objectstack/runtime": minor
"@objectstack/spec": patch
---

feat(mcp): 开源发行版终于消费 skill —— `instructions` 半边投影为 MCP `prompts` 原语 (#3905)

`stack.zod.ts` 与 ADR-0063 §2 把 **skill 定为唯一第三方扩展原语**,而开源发行版
(BYO-AI,cloud ADR-0025)里零消费方:`SkillSchema` 可作者化、被两条 lint 规则认真
校验(`validateAiToolReferences` / `validateAiSurfaceAffinity`),却没有任何代码路径
读它 —— 作者写 skill → 校验通过 → lint 通过 → **永不运行且无人告知**。这正是本仓
ratchet 存在的意义所要消灭的 declared ≠ enforced 形状。

**skill 的两个半边,现在各自说清楚跑在哪。**

- **`instructions`(判断力)→ MCP `prompts` 原语,处处可用。** MCP 服务器补齐了
  `prompts/list` / `prompts/get`:每个带 `instructions` 的已注册 skill 成为一个
  MCP 客户端可以列出并取回的 prompt(prompt 名 = skill 机器名,`label` → `title`,
  `description` 原样带上)。HTTP 与 stdio 两条传输都服务它。
- **`tools` / `surface` / `triggerConditions`(接线)→ 明确标注 cloud-runtime-only。**
  绑工具与激活判定是 in-product agent 循环的属性;MCP 里模型在客户端、服务端只有
  一张扁平工具表,AI 暴露的 Action 早已通过 `list_actions` / `run_action` 可达。
  文档与 schema JSDoc 如实写明,不再装样子 —— 但两半边在两个发行版里都照旧接受
  **校验**,所以开源里写的 skill 到 cloud 上语义完整,不必写两遍。

**协议合规。** `prompts` 能力按规范声明:只有当宿主能读到本环境的 skill 元数据时
才声明并注册处理器(能力协商如实,与 action 工具同一套优雅降级);无 skill 时
`prompts/list` 返回**空列表而非报错**;`prompts/get` 取不存在的名字返回
`-32602 InvalidParams`;没有 `instructions` 的 skill 与 `active: false` 的 skill
不投影。HTTP 面的投影从**本请求自己的 bridge** 读(与 `describeObject` 同一条
per-environment 通道),多租户宿主不会把一个环境的 skill 服务给另一个环境。

**同时修掉同仓重名。** `packages/mcp/src/skill.ts` 从来不是 skill 元数据类型,
而是 ADR-0036 Amendment C 的 `SKILL.md` 分发物 —— 在 `packages/mcp` 里 grep
`skill` 先找到的一直是它。现在按各自承载的产物命名:`skill-md.ts`(SKILL.md
分发物)与 `skill-prompts.ts`(skill 元数据 → prompts 投影),两侧模块头互指。
包的公开导出名(`renderSkillMarkdown` / `OBJECTSTACK_SKILL_NAME` /
`OBJECTSTACK_SKILL_DESCRIPTION` / `RenderSkillOptions`)一个未变。
