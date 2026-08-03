---
---

docs(skills): 补齐「跟到合并为止 / CI 诊断纪律 / 生成物同步」四类 PM 经验(#4892)

发布面零变化 —— 只改 `.claude/skills/` 下的两份内部 agent 说明,不含任何
workspace 包的代码或产物,故为空 changeset。

`pm-dispatch` 的 Operational notes 由四条扩到八条,新增的四条都是 #4885
(同日另一车道的沉淀)覆盖边界之外的:

- **5** —— `rerun_failed_jobs` 复用原 run 的提交/合并 ref,不重算。红的原因若是
  「基上缺一个已合并的修复」,重跑本身无效,只有推新提交才拿得到新的合并 ref。
- **6** —— 读数纪律:`cd X && cmd` 短路(跨仓一律 `git -C`)、
  `git grep -c | wc -l` 数的是文件数、裸名 grep 被幸存家族当子串命中。
- **7** —— CI 红了先取完整日志归档:completeness check 绿 ≠ 测试通过、
  turbo 并发输出相邻 ≠ 因果、不要只看 tail。
- **8** —— 共享基础设施类修复按症状复查 main,并写明
  `duplicate-fix-guard.yml` 只覆盖「同仓 + 同一个 `Fixes #N`」。

另在 Operational notes 1 上补了「不在 main 上」是二义读数、队列分支 base sha 串成
链、转 draft 会同时掉 auto-merge 与队列成员资格;并在 step 7 之后新增「入队与落地」
小节,写清 `merge=os-regen` 的七条路径与四步同步协议,以及「跟到 MERGED 为止」。

`spec-property-retirement` 新增「四张 ratchet 的可见性按路线相反」一节(枚举值收窄
不可见 vs 整 def 删除必须变化),并修好第 2 节指向 `plugin-runtime.zod.ts:243-248`
的先例引用 —— 那个文件已被 #4878 整体删除。
