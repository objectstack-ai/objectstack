---
---

docs(pm-dispatch): domain 表补 `domain:spec-tooling` 行 —— 三面争议路径按「是否围着 spec 契约转」判据切分(维护者 2026-08-09 裁决,#5469)

`.claude/skills/pm-dispatch/SKILL.md` 的域分类表新增 `domain:spec-tooling` 行:
无争议面 `packages/spec/scripts/**`、`packages/spec/docs/**` 直列;与 `domain:devx`
相交的 `packages/lint` / `scripts/` / `content/docs/**` 三面按「是否围着 spec 契约转」
判据切分(围着契约转的门禁/生成器/lint 规则/报错散文/references 管线归 tooling,
一般开发工具面留 devx),`devx` 行加对应备注;「`spec` 一分为二」节的「一包两席」
改为「一包三席」并记录裁决出处。该车道(程序卡 #5163、座位贴 #6018)已实际流通
——座位在任、10 open issue、两单在飞——此前表上无行,即 #5469 升级待裁的缺口。

仅改内部 agent 协议文本,不发布任何包。
