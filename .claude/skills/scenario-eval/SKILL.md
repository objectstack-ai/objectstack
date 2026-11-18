---
name: scenario-eval
description: >
  Run one round of the scenario-card eval (docs/qa/scenarios/) and file its
  `eval-run` record. Use whenever the eval seat or the maintainer says "跑一轮场景卡",
  "跑 control 卡", "跑问数日轮", "对比模型 / effort", "run an eval round", "re-score the recordings",
  or asks how a model or effort config scores on the scenario cards. Covers the round
  plan, the configs, repetitions and noise, recording and replay, the record shape and
  where findings go; runner mechanics stay in packages/qa/scenarios/README.md. The eval
  counterpart of `checklist-test`. NOT a customer-published skill — internal agent
  tooling (lives in .claude/, never in the published `skills/` dir).
metadata:
  # Hides this skill from interactive `npx skills add objectstack-ai/objectstack`
  # discovery — every SKILL.md outside `skills/` must carry this marker
  # (template-consistency.test.ts enforces it).
  internal: true
---

# Scenario eval —— 跑一轮场景卡评测,立一张 `eval-run` 记录

一轮 = 选定的场景卡 × 若干模型/effort 配置 × 若干次重复,产出**一张** `eval-run` 记录 issue。
跑法(参数、模式、评分口径、云会话设置)是 **`packages/qa/scenarios/README.md`** —— 先读它、
服从它;卡的格式与 tier 是 `docs/qa/scenarios/README.md`。本技能只管一轮怎么排、怎么配、
怎么记、发现交给谁,⛔ 不复述 runner 机制。岗位与地盘见 pm-dispatch `references/lanes/eval.md`。

**MCP 问数日轮**(`lanes/eval.md` ⑤)是本技能的一种轮:只跑 ask 模式,用通用客户端读服务端(匹配、编译、权限、标签)。
下文各节标「问数日轮」的条目是它的差异,其余照常。

## 0. 环境 —— 照 README〈Running the cards in a Claude Code cloud session〉

- 订阅登录(`claude auth status` 答 `oauth_token`),`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` 都 unset;
  ⛔ 不用 API 计费的模型。权限模式非 Auto。前台命令有时限,一轮里每条 runner 命令都放后台。
- 先建依赖:`pnpm install && pnpm --filter '@objectstack/scenarios^...' build`;
  没建就跑会停在 `ERR_MODULE_NOT_FOUND`,那是环境,不是读数。
- 记下 `claude --version`:effort 档位表随 CLI 版本变,记录的环境行要带它。
- runner 的 sha 整轮钉死:轮中 ⛔ 不拉 `main`。评分器改了,分数就不可比;要用新评分器,走 §4 回放。
- **问数日轮**:本地起应用、订阅登录,⛔ 不花 API 额度;卡、runner、评分器都在本仓,本轮 ⛔ 不读也不需要 cloud 仓。
  拒 API 计费是 runner 自己做的:`assertSubscriptionLogin`(`packages/qa/scenarios/src/runner/driver.ts`)在上面两个变量
  有值、或 `claude auth status` 报 API-key 登录时抛 `ApiBillingRefusedError`,一张卡都不跑。

## 1. 规划这一轮

- **control 卡每轮必跑**:`grep -l '"tier": "control"' docs/qa/scenarios/*.json` 读出名单,⛔ 不凭记忆列。
  三张小卡可同一条命令(`--only A,B,C`);首轮实测一次重复 haiku 约 45 分钟、opus low 约 25 分钟。
- **starter 卡只跑 scratch**(`--modes scratch`),一卡一条命令(`--only ID`):一条后台命令限 2 小时,
  starter 的搭建就要 20–30 分钟;同一容器至多两条并行,各自起各自的端口(README 原文)。
- `template` 模式要一份已验证的构建(`--template F`),不进例行;本轮的问题点名它才跑。
- **包来源**:评测量的是客户拿到的东西 —— `--packages published`(默认),并用
  `--create-version V` 把整轮所有配置与重复钉在同一个发布版本上;`workspace` 是 QA 席测未发布波的用法。
- 规划写成一张表再动手:卡 × 配置 × 重复 → 命令条数 × 预计墙钟;超出 2 小时的一条拆开。
- **问数日轮的卡** = 带数据集的卡:`grep -l '"datasetQuestions"' docs/qa/scenarios/*.json` 读出名单(写本技能时是
  `order_to_cash`、`travel_expense`),⛔ 不凭记忆列。只跑 `--modes ask --template F`:不搭建、不评 Build、不 iterate。
  `F` 是该卡入库的已验证构建 `docs/qa/scenarios/builds/ID.json`(卡库 README〈Verified builds〉),命名空间与卡不符的
  会被跳过,所以一卡一条命令(`--only ID`);同一份构建跨轮复用,换了构建(只经 PR),Reading 点名这一变量。
- **问数日轮的节奏**:每天一轮 `--ask-repeats 1`,每周一轮 `--ask-repeats 5`;操作回合不重复,只跑一次(README〈Repeats〉)。
- **问数日轮的开跑条件**:日轮在 #34911(ask 模式遇 `422 UNMANAGED_INSTALL_UNCOPYABLE` 改走托管安装)与 #34882
  (`asked-back` 不把候选个数、单写的年份算作数字)都合并之后开跑;开跑前查一次两者已合并,未合并就不开跑。
  缘由:非托管安装拒收带 `capability` 项的包(`capability` 是 `allowRuntimeCreate: false`),#34687 线程实测
  `travel_expense` 的已验证构建在非托管安装下因此一题未问。

## 2. 配置

- **跟踪配置** = 托管默认(写本技能时:`--model haiku --effort medium`);**参照配置** = `--model opus --effort low`。
  托管默认变了以座位贴为准,本技能 ⛔ 不跟着改值。其它配置只在本轮问题需要时加。
- 每条命令**显式**写 `--model` 与 `--effort`。⛔ 不用 CLI 默认模型不点名(登录不同、默认不同,还会悄悄变);
  ⛔ 不靠 `CLAUDE_CODE_EFFORT_LEVEL` 环境变量:它只是 `--effort` 缺省时的回退,命令行上看不见。
- `--author-model` / `--ask-model`(及两个 effort 对应项)只在本轮要拆开搭建与问答时用,记录里写明。
- **问数日轮**:ask 模式不搭建,每条命令显式写 `--ask-model` 与 `--ask-effort`(值照跟踪配置;换值 Reading 点名);
  开不开 `--ask-skills DIR` 是两个配置,各自成表(`summary` 拒把技能不同的运行并表)。每回合记录
  `requestedModel`、服务的 `model` 与 `requestedEffort`,计分卡 `Run · model` 行给出服务模型与 effort,照下条核对。
- 读计分卡的 `Run · model` 与 author 行核对**实际服务的模型**:出现 `⚠ asked for` / `not <model>` 的
  那次运行不属于该配置,单列说明,⛔ 不并入均值。effort 只有请求值,没有服务值可核(README)。

## 3. 重复与噪声

- **要据此定模型或 effort 的,每配置 5 次重复。** 单次运行的问数在 control 三卡 58 题上会摆动约 ±4 题:
  单次一轮只报**趋势**,⛔ 不排名次,记录的 Reading 照此措辞。
- 结果按配置报**均值 + 最小–最大**,再按卡把 5 次合并报一张表。汇总脚本 runner 里还没有:
  手算或本席脚本都行,记录写明算法(分子分母合并,还是逐次百分比再平均)。
- 只和上一张记录的**同一配置、同一组卡**比;发布版本或 runner sha 变了,Reading 点名这一变量。
- **问数日轮**:日轮一次重复,只报计数与趋势;排名次看周轮的 5 次。日轮比前一天、周轮比上一周
  (`summary` 也拒把 `--ask-repeats` 不同的运行并表)。
- 每次重复都进记录:没跑完的照实写 `not measured` 与原因(README 的超时、`error_max_turns` 等),
  ⛔ 不静默重跑顶替,⛔ 不剔除离群值;重跑了就写重跑了。

## 4. 录制与回放

- **每条命令都录**:`--record FILE`,一条命令一个文件,路径带配置与第几次重复。
  pnpm 在包目录里跑脚本,`--out` / `--record` 一律传绝对路径。
- **回放** `--driver recorded:FILE`:不调模型、不花额度,重评一轮旧运行。它把每个回合录下的写调用按序
  重发给新起的应用,所以 Build、问数、写操作三项都能重评;一回合重发不成的记 `not measured` 并点名
  那次调用,⛔ 不判 fail。回放拒收模型与 effort 参数,记录沿用录制时的驱动(`replayOf`)。
- 回放重评同样立一张 `eval-run` 记录:Scope 写明回放的是哪张记录的录音、评分器在哪个 sha;旧记录不改。

```bash
# --only 的三张 control 卡是写本技能时的名单;跑前照 §1 从卡文件重读
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
claude auth status && claude --version
pnpm install && pnpm --filter '@objectstack/scenarios^...' build
OUT=/abs/path/eval-runs/DATE-ROUND/haiku-medium/rep1 && mkdir -p "$OUT"
nohup pnpm --filter @objectstack/scenarios run-scenarios \
  --only crm_account_with_contacts,invoice_with_line_items,project_with_tasks --modes scratch \
  --model haiku --effort medium --create-version VERSION \
  --out "$OUT" --record "$OUT/run.rec.json" > "$OUT/run.log" 2>&1 &

# 问数日轮:一卡一条;卡名照 §1 从卡文件重读,--template 是该卡入库构建的绝对路径(先查 §1 的开跑条件)
OUT=/abs/path/eval-runs/DATE-ask/haiku-medium/order_to_cash && mkdir -p "$OUT"
nohup pnpm --filter @objectstack/scenarios run-scenarios \
  --only order_to_cash --modes ask --template "$(git rev-parse --show-toplevel)/docs/qa/scenarios/builds/order_to_cash.json" \
  --ask-model haiku --ask-effort medium --ask-repeats 1 --create-version VERSION \
  --out "$OUT" --record "$OUT/run.rec.json" > "$OUT/run.log" 2>&1 &
```

## 5. 记录 —— 一轮一张 `eval-run` issue

维护者令(原话):"objectstack 公开仓,像 qa-run"。据此场景卡评测记录立在本仓、带全分(问数基线 ② 的
数字仍不对外,见 `lanes/eval.md`)。运行产物 ⛔ 不进仓库树:run 记录 JSON、录音、日志留在 git-ignore 的默认
`--out` 目录或本席的项目文件里;issue 就是报告,纯文本,⛔ 不放图。轮所装的已验证构建不是运行产物而是 fixture,
在树里(`docs/qa/scenarios/builds/`),只随 PR 改,⛔ 轮不写它。

- **写入门**:立单、评论、关单全走 pm-dispatch 写入门,照 `checklist-test` §4 那一段;⛔ MCP `issue_write`。
- **标题**:`Eval run · SCOPE × N configs × R reps · SHA8 · DATE`,如
  `Eval run · control cards × 3 model configs × 5 reps · 3be13473 · 2026-11-15`;SHA8 是 runner 的 commit。
- **标签**:只带 `eval-run`;⛔ 不挂 priority / `domain:*` / `pm:*`。记录不是可派发单元,整个生命周期都不补挂。
- **正文**,按此顺序,英文:
  - `## Environment` —— runner 仓与 sha;包来源行(`packages: published 18.4.0`)与模式;驱动与登录
    (`oauth_token`,无 API key);`claude --version`;每个配置实际服务的模型与请求的 effort;花费是 CLI
    报的名义数,未计费。
  - `## Scope` —— 卡 id 与 tier、首轮加 iterate;配置清单;每配置重复次数;每次重复的题数、写操作数、
    Build 检查数;每条命令的退出码;`not measured` 的半边逐个点名原因(⛔ 不计入分母)。
  - `## Results` —— 一行一个配置:Build · 问数 · 写操作(均值,括号最小–最大)· 每次重复的泄露标记**数**
    · 搭建分钟 · 问答分钟 · 每次重复名义花费;再一张按卡合并表。泄露只写数,⛔ 不写内容。
  - `## Reading` —— 编号结论,每条按 §3 的噪声规则措辞,并与上一张记录比。
  - `## Findings filed from this run` —— 每条发现一行,写去向(§6);无则写 `none`。安全线索那一行只写
    `security-findings.md` §4 的固定一句,别无其它。
  - `## Records` —— 产物放在哪(路径),说明留在仓库树外、可回放。
- **问数日轮的记录**:标题 SCOPE 写 `daily ask round` 或 `weekly ask round`。`## Environment` 必带 runner sha(记录的
  `env.framework`)、包来源(`env.packagesLine`)、构建的文件名与 sha256(记录的 `template`)、问答回合的技能
  (`driver.askSkills` 的名字与 sha256,关则写 `none`)与每配置实际服务的模型(`Run · model`);`## Results` 加
  `Run · datasets` 一列,从计分卡抄(`summary` 还没有这一列)。
- **问数日轮的泄露数是服务端读数**:问题回合以成员人设(`role: 'user'`、卡的权限集、自己的 API key)经应用的 MCP
  (`/api/v1/mcp`)问,泄露标记数读成服务端给这把 key 放出了什么,⛔ 不读成客户端守不守口;以管理员问的
  数据集问题不进这个数。真泄露还是评分误判,照 §6 先分清。
- **收口**:§6 的每条发现都有了去向(卡号或已报的私密渠道)即由本席关 `completed`;
  ⛔ 不为等修复开着,修复的回测进下一轮。上一轮的记录不 supersede:每张都是它那个 sha 上的一次测量。
- **分诊扫描还不认 `eval-run`**(排除名单只列 `qa-run`):在它补进之前,记录在立单的同一轮关闭;
  当轮关不了,就告诉分诊席这是一张记录、不是待分诊的卡。
- 记录立好后给维护者一句话:链接 + 两行 Reading。

## 6. 发现 —— 各归各主

| 读到的 | 去向 |
|:---|:---|
| **评分误判**:评分器把对的判错、错的判对(含泄露标记误报) | 跑分器主人:`packages/qa/scenarios` 归 `domain:devx`,有开着的评分专题卡就作它的一行 / 子卡(卡号见座位贴),否则走立卡门 |
| **产品缺陷**:平台拒收合法写、probe 失败、能力缺失 | 立卡门(pm-dispatch `references/filing-gate.md`)交对应车道;probe 失败算平台,不算 agent |
| **技能文本**:agent 照着已发布技能搭错 | 以 `finding` 报 `domain:skills`;本席 ⛔ 不自改技能 |
| **泄露 / 任何安全线索** | 只照 pm-dispatch `references/security-findings.md`;Results 只写泄露标记数,Findings 只写该文 §4 的固定一句,⛔ 不写内容、不立公开卡 |

泄露标记先分清是评分误判还是真泄露;真泄露只走最后一行。

## Guardrails

- ⛔ 不派 `os-dev`、不改产品代码、不开 PR(`lanes/eval.md` 边界);runner 或卡要改,立卡交车道。
- ⛔ 不用 API 计费;花费只报 CLI 报的名义数(车道成本规则)。
- `not measured` 就是 `not measured`:⛔ 不记 pass、不记 fail、不挑重复、不剔离群。
- 一轮一张记录;回放重评另立一张,⛔ 不改旧记录的分数。
