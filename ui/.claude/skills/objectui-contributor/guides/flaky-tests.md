# Flaky tests under `ui/` — why, and how the failure names its cause

Moved out of `ui/AGENTS.md` § 测试纪律, which keeps the rules; this page keeps the reasoning, the measurements and the incident behind them.

单跑稳定绿、全量并行下偶发红的测试,**根因几乎总是同一个**:一段**无界的模块加载被计入了一个有界的窗口**。满并行下 Vite 的 transform 管线是饱和的(单 `dom-heavy` 项目就 ~60s transform),实测一次首包 `import()` 可达 **976ms** —— 已吃掉 RTL `findBy`/`waitFor` 默认 **1000ms** 预算的 97.6%。于是断言在和模块加载器抢时间,红绿取决于机器负载而不是被测代码。

- 失败现场会直接指认根因:dump 里若仍是 Suspense fallback(如 `Loading report renderer…`),就是本条;**hook 超时表现为「失败的*文件* + 0 个失败*测试*」**(其余全部 skipped),别误读成断言失败。
- 顺手体检:别把 `keysOf(x)` 这类整体计算写在 `.filter()` 谓词里(每个元素重算一遍)。`all-locales-key-parity` 曾因此 7.51s,提升出谓词后 **25ms**。

前情:objectui#3010(一次修掉五个文件,含一个已被「超时调到 15s」糊过、满负载下依然 15021ms 超时的例子)。
