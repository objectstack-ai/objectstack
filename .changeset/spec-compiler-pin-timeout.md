---
---

test(spec): 给 13 个 compiler-API 导出面 pin 一个符合真实工作量的超时(#4796)

发布面零变化 —— 只改 `packages/spec/vitest.config.ts` 的 `testTimeout`,不影响任何
产物内容,故为空 changeset。

这一族 pin(每个退役/双源 PR 各留一个,现有 13 个)都要对全部 16 个公共入口建一次
`ts.createProgram`,天然是秒级工作。实测:空闲机器 ~2-3s;CI 分片上 turbo 把
`@objectstack/spec#build` 与 `#test` 并发跑在同 4 vCPU 上,争抢把它推到
5.0-5.6s —— 恰好骑在 vitest 默认 5s 超时线上。一个上午三条 pin 超时
(state-machine / sync-retirement / tenant),每次都把一个不相干的 PR 踢出合并队列,
并被误诊为构建 OOM(#4845 记录了那次误诊与更正)。

30s 约为实测争抢峰值的 5 倍;真挂死仍由 CI 的 10 分钟 stall guard 兜底 —— 这个
数字只阻止「健康但受争抢」的运行被读成失败。长期修法(把导出面做成构建期产物、
pin 只比对不现场解析)在 #4796 跟踪。
