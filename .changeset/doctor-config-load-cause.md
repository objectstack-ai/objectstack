---
"@objectstack/cli": patch
---

fix(cli): `os doctor` 说出配置载入失败的**原因**,不再只说一句「载入不了」(#5403)

config 分析那个很宽的 `catch` **不带绑定**(`catch {`),error 对象在被捕获的那一刻当场丢弃。
于是配置真坏掉时,报告里没有任何线索:

```
$ cat objectstack.config.ts
throw new Error('this config is genuinely broken');

$ os doctor
  → Loading configuration for analysis...
  ⚠ Could not load config for analysis (config checks skipped)

⚠️  Environment is functional but has some warnings.
```

`this config is genuinely broken` 一个字都不出现,`--verbose` 也没有 —— 这句话是裸
`printWarning` 直接打的,不是 `HealthCheckResult`,所以根本没有 `fix` 可供展开,没有任何
旗标能让操作者看到更多。而 `os serve` 在同一个目录会把这个错误**完整**打出来。诊断命令在
它最该出力的一刻(配置坏了),给出的信息**严格少于**直接跑 `os serve`。

这与前三单是同一句话的不同侧面:#5382 / #5387 / #5397 修的是这句话的**归因**(先把
posture 的抛错挪出这个 catch,再让 env 派生检查读到 serve 的环境,最后让配置载入也在
serve 的环境下进行)。三单之后这句话触发时配置**确实**坏了。本单修的是它归因正确之后
**说了什么**。

**现在的行为。** 这条路径不再是裸 `printWarning`,而是一条常规 `HealthCheckResult`,与
`Environment files` / `Tenancy posture` 走**同一个渲染器**、同一条 `--verbose` 展开规则:

```
$ os doctor
  → Loading configuration for analysis...
  ⚠ Config load          Could not load config for analysis (config checks skipped) — this config is genuinely broken

$ os doctor --verbose
  ⚠ Config load          Could not load config for analysis (config checks skipped) — this config is genuinely broken
      → `os serve` loads this same file the same way — bundle-require, under the `.env*`
        cascade named above (#5397) — and prints this error in full, so a config that
        lands here is one the server cannot boot either.
        The config-aware checks were SKIPPED, not passed: spec version, circular
        dependencies, unused objects, orphan views, dashboard integrity.
        cause: this config is genuinely broken
```

四条刻意的取舍:

- **原话照引,不改写。** 与 #5390 引 `resolveTenancyPosture()` 原话同一体例:抛错方拥有措辞。
  配置载入的失败可能来自四个不同的权威(用户自己的 `throw`、esbuild 的打包诊断、Node 的
  模块解析、`loadConfig()` 自己的 "no default export"),doctor 没有立场把它们总结得比它们
  自己更好。
- **cause 进 `message`,而不只进 `fix`。** `Environment files` 把 cause 只放在 `fix` 里是对的
  —— 那一行本身已经把结论说完整了,cause 是脚注。这里 cause **就是**结论:没有它,这一行
  只说了「出了点没被指名的问题」。所以平铺一行放收敛后的引文(多行折叠成一行、超长截断),
  `--verbose` 给未截断的原文。折叠而不是取首行,是因为 esbuild 的首行恰好是它最没信息量的
  一句(`Build failed with 1 error:`,文件与原因在下一行)。
- **档位不变。** 仍是 warning,doctor 仍然跑完其余检查,仍然 exit 0。本单让这句话说得更多,
  不是说得更响。
- **那句话本身原样保留**,作为该行的开头。它被两份 changeset 引用、被本文件四处注释引用,
  也是操作者会去 grep 的字符串;更要紧的是,兄弟测试用它的**缺席**来表示「配置载入成功」,
  改写它会让那些断言在「没有任何东西能匹配」的空理由下继续变绿。

顺带消掉的是一条旁路:渲染规则此前只存在于环境检查那个 `forEach` 的循环体里,任何在它之后
产生的结论都只能自己再手打一遍格式 —— 而手打的那份没有 `fix` 通道,`--verbose` 对它无效。
渲染规则现在是一个具名函数,两处共用。
