---
---

docs(pm-dispatch,os-dev): 发现类 issue 纪律 —— 查重、归挂、`finding` 分级与分诊出水口 (#4949)

维护者观察「issue 越开发越多」后的复盘产物（cloud 分片一日数据：关 14 开 19）。
病根不在 Prime Directive #10（发现即立单）—— 返工全部来自大而含糊/过时的
issue，小而精确的单派发成功率近 100% —— 而在循环只有生产者、没有出水口。

- **os-dev 立单纪律三条**：立单前按关键词 + 文件路径查重（cloud#1054 与
  cloud#1031 同日重复）；属已排队 issue 完成范围的开 sub-issue、仅依赖的
  独立立单 + `Blocked-by:`；观察类打 `finding` 标签、不自行判级压单
  （立单时判级最不准：cloud#1004 的「转义细节」实为 P0 过滤器旁路）。
- **SKILL.md**：setup 增 `finding` 标签；step 0 分类增 Hold 类（评论/台账
  是 ADR-0049 的 silent state 与 rule 5 的 second tracker，记录必须留在
  issue 层）；新增**发现分诊轮** —— 每 ~5 轮批量过一遍 `finding`，晋级 /
  关闭 not planned（否决窗口）/ 持有，判级责任归此轮；轮次报告增三个有界
  健康度指标（可派发库存、决策收件箱、`finding` 中位年龄），总 open 数
  刻意不设为指标。
