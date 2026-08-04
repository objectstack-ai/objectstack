---
---

ci(deps): 给 OSV 门禁的逃生口立三条约定并机械强制 (#4965)

`validate-deps.yml` 的 OSV 门禁对无修复版本的公告,唯一出路是 `osv-scanner.toml` 的
`[[IgnoredVulns]]`;但该文件此前不存在,逃生口一次没走过,也就没有约定 —— 而没有约定的
逃生口会在第一次紧急情况下被随手用坏,然后永久留在那里。本次新增零豁免的
`osv-scanner.toml`(三条约定写在文件头 + 一个注释掉的模板条目)与
`scripts/check-osv-exemptions.mjs`:`ignoreUntil` 强制(默认 30 天、上限 90 天,缺失/
加引号/过期/超上限一律判红),`reason` 强制且必须带 advisory 链接与一句"为什么不可修"。
零豁免状态下门禁行为与本次改动前逐条一致。仅 CI 配置,不发布任何包。
