---
name: dogfood-verification
description: >
  Internal process for dogfooding the ObjectStack platform — booting a real
  example app (showcase / CRM) and driving it in a browser as a real user or
  admin to find runtime bugs that static checks and unit tests miss, then
  fixing and shipping cleanly. Use whenever the task is "verify in the browser",
  "act as a real admin/user", "dogfood the Setup/Studio app", or browser-verify
  a change in the running app. NOT a customer-published skill — this is internal
  agent tooling (lives in .claude/, never in the published `skills/` dir).
metadata:
  # Hides this skill from interactive `npx skills add objectstack-ai/objectstack`
  # discovery. NOTE: the skills CLI's `--all` implies `--skill '*'`, which
  # includes internal skills — so the hard boundary against leaking into
  # customer projects is the `/skills` subpath in every advertised install
  # command (scaffolder, docs). Every SKILL.md outside `skills/` must carry
  # this marker — template-consistency.test.ts enforces both layers.
  internal: true
---

# Dogfood verification

启动并驱动真实应用的实战流程,教训换来的。三根支柱:**隔离环境**、**吃透构建模
型**、**断言前先做视觉/权威核验**。烧掉时间的地方都在跳过支柱 1 或 3。

## 0. 起飞前 —— 先隔离环境(第一件事)

dev 工作树、dev-server 端口、preview 浏览器全是**共享的**:并行的 Claude/dogfood 会
话会抢走浏览器标签页、留下挡住导航的未保存草稿、弄脏工作树。开工前先隔离:

- [ ] **自有端口**:挑一个空闲的非默认端口(不要 3000/3001/3210)。先查:
      `lsof -nP -iTCP:<port> -sTCP:LISTEN`。在 `.claude/launch.json` 加一条指向**本**
      工作目录的具名配置,例如
      `pnpm -C <abs>/examples/app-showcase exec objectstack dev --ui --seed-admin -p <port> -d file:/tmp/<run>/data.db`。
- [ ] **自有数据**:`--seed-admin` 在空 DB 上给出 `admin@objectos.ai / admin123`。持
      久化 `-d file:/tmp/<run>/data.db` 重启后仍在(适合多步配置的运行);`--fresh`
      给全新首跑(退出即清)。
- [ ] **确认独占控制**:`preview_start` 后检查 `location.origin` === 你的
      `http://localhost:<port>`。标签页不断漂到你没导航过的应用/路由、或出现你没写过
      的草稿 → **有并行会话占着浏览器**。别跟它抢;把所有检查钉到你的绝对 origin,
      靠 API + 源码(支柱 3)。
- [ ] 还要开 PR 的话,在**基于 `origin/main` 的独立 git worktree** 里做(见 §5)——
      永不从共享的脏分支提交。

## 1. 启动

- [ ] `preview_start` 你在 `.claude/launch.json` 的具名配置;轮询就绪:
      `curl -s -m3 -o /dev/null -w '%{http_code}' http://localhost:<port>/api/v1/health` → 200。
- [ ] Console UI 在 `/_console/`;应用在 `/_console/apps/<appId>`(如
      `com.objectstack.setup`、`com.objectstack.studio`)。API 根 `/api/v1`,设置
      `/api/settings`,合并后的应用/导航 `/api/v1/meta/app?id=<appName>`。
- [ ] ⚠️ **`?id=` 键的是应用 `name`,不是包 id。** 真实 name 是 `showcase_app` /
      `setup` / `studio` / `account` —— 不是上一行那种 `com.objectstack.setup` /
      `com.example.showcase`(那是包 id,只在 `/_console/apps/` 的路径段上成立)。传
      包 id 得到的是 `{"items":[]}`,读起来和「应用元数据没了」一模一样 —— 最高价值
      的假 P0 形状。**先不带 query 取一次 `/api/v1/meta/app`,读它真正返回的 name,
      再去过滤。**

## 2. 构建/运行时模型 —— 攒一批,然后一次重启

- [ ] 包从 **`dist`** 加载,不是 `src`(`pkg.main = dist/index.js`)。编辑
      `packages/*/src` 在重建该包**并重启服务**之前对运行时**零效果**。`os dev` 的
      watcher 只重编译示例应用自己的 `objectstack.config.ts` / `src`,不管工作区的包。
- [ ] 所以:先做完**全部**源码编辑 → `pnpm --filter <pkg...> build` →
      `preview_stop` + `preview_start`。不要每修一处就编辑→构建→重启一遍。
- [ ] ⚠️ **消融验证(predict-then-mutate)以最危险的方式继承这一条 —— mutate 与运行
      之间要重建,并在报告里写明重建过。** 忘记重建*修复*是假红:费一圈,但会被发
      现。忘记重建**消融**跑的是突变前的构建,套件保持**绿**,而这份绿会被记成「测试
      已被证明有区分度」—— 给一条可能根本红不了的断言发了证书,之后任何 CI 都暴露不
      了它(CI 构建正确,在那边永远绿)。每一腿都是 mutate →
      `pnpm --filter <pkg> build` → **证明突变已到达 `dist/`** → 运行:
      `node scripts/ablation-dist-preflight.mjs <pkg> '<marker>'` 只在被消费的
      `dist/` 真带着突变时才退 0(消融删除守卫时用 `--absent`;restore 腿也要跑它 ——
      留在 `dist/` 里的 marker 会让突变代码对该树之后的每次运行保持生效)。
- [ ] `dist/` 已 gitignore —— 安全;永不提交构建产物。
- [ ] **`/_console` UI 是 *vendored objectui 构建*,与框架 `dist` 是两回事。** 它由
      `.objectui-sha` 钉住、按预构建 bundle 提供。已合并的 objectui 修复 —— *甚至
      bump 过的 `.objectui-sha`* —— 在 vendored console 重建之前**不会活在 :3000
      上**:运行中的服务器继续提供旧构建产物(BUILD 陈旧 ≠ PIN 陈旧)。所以**在宣布
      :3000/_console 上发现 console/Studio UI 缺陷之前,先对当前 objectui 源码或全新
      构建核一遍** —— vendored bundle 可能是旧的,缺陷可能上游已修。最快的权威核验 =
      objectui 的 HMR console 指向你的服务器:
      `VITE_SERVER_URL=http://localhost:<port> DEV_PROXY_TARGET=http://localhost:<port> pnpm --filter @object-ui/console dev`
      (独立 origin → 需要它自己的 `admin@objectos.ai/admin123` 登录)。跳过这步曾在
      一个 objectui main 已修掉的 action-create 死路上白付一整圈 spawn-a-fix。
- [ ] **漂移的构建不再静默启动(#7752)。** `build-console.sh` 把它构建所用的 SHA 盖
      进 `packages/console/dist/.objectui-sha`;当这个章与仓库的 `.objectui-sha` pin
      不一致时,`os dev` **拒绝挂载 `/_console`** 并打印补救 —— `/_console/` 404,横
      幅不再宣传 console URL。那是要修的前置条件,不是产品缺陷:跑
      **`pnpm objectui:build`**(在*钉住的* SHA 上重建 —— `objectui:refresh` 会把
      pin 重新 bump 到你本地 `../objectui` 的 HEAD)再重启。`pnpm check:console-sha`
      不启动也能报同一比较。`OS_ALLOW_CONSOLE_DRIFT=1` 是故意启动陈旧 bundle —— 那之
      后你做的每个 console 观察,描述的都是一个仓库没有钉住的 commit。

## 3. 核验 —— 视觉 / API 先行,DOM 殿后(防误报规则)

最大的陷阱:**导航刚结束**就用 `preview_eval` 查 DOM,拿到的是过渡态/空结果(React
还没水合)→ 你得出「导航是空的 / 功能坏了」,而这是谎言。

- [ ] **断言任何「缺失 / 坏了 / 不可达」的发现之前**,用**截图**(视觉真相)或**权威
      服务端响应**(`/api/v1/meta/...`、`/api/settings` —— 服务器真正下发的元数据)
      确认。永不凭一次导航后的 DOM dump 上报严重发现。
- [ ] 确认页面渲染完成*之后*(先截图,再查 selector),DOM dump 没问题。
- [ ] **门的两侧都要测**:`requiresService`/`requiresObject`/权限门要在依赖存在*与*
      缺席两种状态下各验一次。
- [ ] 服务端是权威可见性门(ADR-0057 D10)—— 客户端过滤只是「礼貌」。元数据开关不改
      UI 时,先查强制在服务端(框架,可在本仓修)还是客户端(objectui console,另一
      个仓)。
- [ ] 用 `preview_screenshot`(API 改动用 `preview_network`)向用户证明;loading
      spinner / 异步数据状态要显式写明,而不是声称你没等到的最终值。

## 4. 浏览器逃生舱(坑)

- **页面卡死 / 导航被挡**(未保存草稿的 `beforeunload`、共享标签页):先解除再导航 ——
  ```js
  Object.defineProperty(Event.prototype,'returnValue',{configurable:true,get:()=>undefined,set:()=>{}});
  const op=Event.prototype.preventDefault;
  Event.prototype.preventDefault=function(){ if(this&&this.type==='beforeunload')return; return op.apply(this,arguments); };
  window.onbeforeunload=null; location.replace('<url>');
  ```
- **登录 / React 受控输入**:`preview_fill` 设了 `.value` 但不触发 React `onChange`
  → 表单空提交。用原生 setter + 派发 `input`+`change`,或干脆在页面里 `fetch` POST
  认证端点。
- **跨 origin**:把 `fetch` 钉到你的绝对 `http://localhost:<port>`,漂移的标签页才不
  会打到错的服务器;cookie 认证的路由带 `credentials:'include'`。

## 5. 交付 —— 隔离的 PR(工作树共享/脏时)

- [ ] 只捕获你自己的文件:`git diff -- <explicit paths…> > /tmp/fix.patch`
      (用**显式路径**,不用多行 shell 变量 —— 后者会静默产出空 patch)。
- [ ] `git worktree add -b <branch> /tmp/pr origin/main` → `git -C /tmp/pr apply /tmp/fix.patch`
      → 确认 `git -C /tmp/pr status` *只*列你的文件。
- [ ] 加 **changeset**(`.changeset/<slug>.md`,`"@objectstack/<pkg>": patch`)——
      发布包的改动过不了 CI 的「Check Changeset」门。
- [ ] 提交(信息末尾带 `Co-Authored-By:` trailer)、推送、`gh pr create`,然后
      `gh pr merge --squash --auto --delete-branch`(先移除 worktree,本地分支才不被
      锁:`git worktree remove /tmp/pr --force`)。

## 6. Shell 卫生

- glob 匹配不上时 zsh 会吃掉 `--include=*.ts` → 用专门的 **Grep 工具**,或给 glob
  加引号。
- 复合 `git` 命令里,显式参数优于多行 `VAR="a b c"`。

---

**黄金法则**:一个发现若属严重级(「整个设置面不可达」),先把你的第一读当假设,用
截图或服务器自己的元数据推翻它,再往下写。这样找到的「P0」多数是水合伪影。
