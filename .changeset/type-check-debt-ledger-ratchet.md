---
---

ci(dx): `scripts/check-type-check-coverage.mjs` 的 DEBT / TEST_DEBT 台账数字现在会被**重测**——实测 > 记录即红(#5278)。Dev scripts / CI only;releases nothing。

原来的闸门只断言「有一条台账、数字为正」:

```js
if (!entry || typeof entry.errors !== 'number' || entry.errors <= 0) { ... }
```

也就是说 `errors: 28` 和 `errors: 1` 对它完全等价,台账**从不复测**。包这一层对新增 debt 是关着的,错误**条数**这一层不是——一个新测试文件带进来的错误没有任何一道闸会看见。AGENTS.md 写着「DEBT is frozen debt, not a permission slip. Every entry below was measured」,而一个已经悄悄漂了 2.25 倍的数字不再描述它声称冻结的那笔债:记 28 的条目读起来像「快毕业了」,实际成本是它的两倍多。

本次在 `5ab08428` 上把 34 条台账**全部重测**,漂移比 issue 报的更普遍:

| | 记录 | 实测 |
|:---|---:|---:|
| `@objectstack/metadata-protocol` | 28 | 63 |
| `@objectstack/spec-monorepo`(仓库根) | 50 | 80 |
| `@objectstack/objectql`(TEST_DEBT) | 219 | 333 |
| `@objectstack/plugin-approvals`(TEST_DEBT) | 467 | 547 |
| `@objectstack/service-analytics` | 3 | 7 |
| `@objectstack/service-automation` | 2 | 5 |
| …… 共 17 条低估 | | |
| `@objectstack/runtime`(TEST_DEBT) | 220 | 218 |
| `@objectstack/driver-mongodb`(TEST_DEBT) | 44 | 43 |

17 条低估、2 条高估、15 条精确。**没有一条**是因为债在缩小而失真的。

## 新的 MEASURED 不变式

`--re-measure` 对每条 DEBT 跑该包自己的 `tsc --noEmit -p <pkg>/tsconfig.json`,对每条 TEST_DEBT 生成一份 `extends` 原配置、只去掉 test 排除项的临时兄弟配置再跑(临时文件在 `finally` 里删除)。判定是**不对称**的,这是本次的核心:

- 实测 **>** 记录 → **红**。这才是棘轮。
- 实测 **<** 记录 → 打印一行 `ℹ … can be lowered`,**不红**。修错误不应该还要先改一个记账数字才能让 CI 变绿,否则台账就是在对它本该鼓励的工作收费。
- 实测 **= 0** → 报告为 graduation candidate(毕业仍然是一次显式 PR:加 `typecheck` script + 删台账条目,由 COVERED / RECONCILED 两个方向共同强制)。

## note 的成分也要跟着重写

漂的不只是数字,还有 note 描述的**成分**——这是 `service-automation` 这个标本的价值所在:它记 2,note 逐字点名 `engine.test.ts:2547/2577` 的两条 TS2741 是「全部的债」,而实测 5 条里多出来的 3 条是 `nested-region-parity.test.ts` 里测试直接点号读私有字段 `engine.flows` 的 TS2341——不同文件、不同错误码、不同性质。一个「两个字面量缺字段」的 note 读起来是顺手就能毕业,实际却还夹着「测试到底该不该读私有状态」这一类判断。

所以每条被抬高的 note 都按实测成分重写了(错误码直方图 + 集中的文件),闸门的报错文案也直接要求这件事;确实归因不了的(本仓库 clone 是浅的,拿不到逐文件 blame)就明说「re-measured N at 5ab08428」,不编造成分。

另外记录两个重测才看得见的事实:`@objectstack/driver-mongodb` 净变化是 -1,但成分换掉了三分之二(老 note 归咎于缺 `types:["node"]` 的 15 条 TS2591 全没了,冒出 7 条 TS1309)——单看数字会以为什么都没发生;`@objectstack/http-conformance` 的 4 条里有 2 条报在 `node_modules` 的 `.d.ts` 上,所以这条会随 lockfile 动而不只随本包代码动,已在 note 里写明。

## 落点与成本

便宜的结构检查留在原地(只读 package.json / tsconfig.json,亚秒级,跑在 build 之前)。重测这一半需要各包依赖的 `dist/*.d.ts`,所以挂在 `lint.yml` 的 `typecheck` job 里、build 步骤**之后**——这个 job 本来就付了构建的钱。build filter 顺带扩到嵌套包组(`packages/services/*` 等):多数台账包没有 `typecheck` script,从来没进过 turbo 的任务图,它们的依赖也就不会被建。

实测重测本身 **~4 分钟**(34 个 project,顺序执行;并行 tsc 是拿 wall clock 换一个刚建完整个 workspace 的 job 上的 OOM 风险)。

## 反向验证

方向是先定后验的,两个方向都验了:把一条台账改到**低于**实测(`service-analytics` 7 → 4)、另一条改到**高于**实测(`service-automation` 5 → 9),同一次运行 exit=1,恰好 1 条红(前者)+ 恰好 1 条 `ℹ`(后者)——增长判红、缩小不判红、逐条独立,三件事一次落实。改动前的台账(即 origin/main 的数字)在新闸门下是 17 条红,重测后为绿。

self-test 新增 11 个用例:6 个钉住三个方向(涨/缩/归零)与逐条独立性,5 个钉住计数器本身——多行 elaboration 缩进行不能被重复计数(一条 TS2322 能打印 5 行),无文件前缀的全局诊断要计数,而正文里出现「error TS」字样但没有错误码的散文不能计数。
