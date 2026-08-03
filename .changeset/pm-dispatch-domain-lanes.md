---
---

docs(pm-dispatch): domain 车道协议 —— 按「修复落点的包」划域,支持同仓多 PM 并发 (#4819)

`.claude/skills/pm-dispatch/SKILL.md` 新增「Domain lanes(同仓多 PM 并发)」一节:
锚定规则(每个包恰好属于一个 domain,`domain:*` 标签取**修复落点所在包**的域,分诊时
读代码后打,不从标题词汇猜 —— #4775 的 hook condition 概念属 automation,落点却是
`packages/objectql/src/hook-wrappers.ts`,故归 `domain:engine`)、六域分类表、标签纪律
(打标 ≠ 认领;未打标不得认领)、认领范围(在 #4604 登记 domain 集合)、跨域单与借单
规则、选批时的全局在飞检查,以及合并队列仍是全体共享串行资源的提醒(flaky 税,#4796)。
认领注释模板加「域」「文件面」两行(跨域与借单必填);Multi-repo coordination 规则 4 的
「同队列多 PM 一律禁止」改为「仅在 domain 车道协议生效时允许」,repo 分片阶梯保留,
domain 车道作为第三级。

仅改内部 agent 协议文本,不发布任何包。
