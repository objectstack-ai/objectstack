---
"@objectstack/types": minor
"@objectstack/cli": minor
"@objectstack/verify": minor
---

feat(types,cli,verify)!: 只解析 host app 声明过的包 —— `NODE_PATH` 不再算数,ADR-0093 D5 那道墙从此与启动方式无关 (#4719)

**问题:契约写下了,但从没被检查过。** `@objectstack/types/node` 的
`createHostRequire` 返回一个 CJS `createRequire`,而 CJS 解析认 `NODE_PATH`
(`Module.globalPaths`)。pnpm 生成的 bin shim 第一件事就是
`export NODE_PATH=<workspace>/node_modules/.pnpm/node_modules`,于是任何被工作区里
**任意一个包**传递依赖到的包都能"从 host app 解析成功" —— 跟这个 app 声明了什么毫无关系。

实测(cloud `apps/objectos-ee`,当时未声明 `@objectstack/organizations`):
`pnpm start`(经 shim)boot 成功、插件表里有 `Organizations`、ADR-0093 D5 一声不吭;
`node node_modules/@objectstack/cli/bin/run.js serve`(不经 shim)则
`✖ FATAL: tenancy posture 'isolated' was requested…` 并 exit 1。同一个 app、同一份
`package.json`、同一个 posture,**只因为进程是怎么被拉起来的**,走出两种结果。
而 D5 的报错一直在教 operator "declare it in the app's package.json" —— 那正是
CLI 从来没检查过的那件事。

**改法:声明即执行。** 解析前先读 `<hostRoot>/package.json`;只有包名出现在
`dependencies` / `devDependencies` / `optionalDependencies` / `peerDependencies`
的 **键**里,才去 host 的 `node_modules` 里查它。仅仅"能被解析到"不再算数 ——
那正是让契约失效的那个偶然。未声明的包退回到 importing package 自身的解析
(ESM,不认 `NODE_PATH`),框架自有的包加载路径不受影响。

**两种失败从此分开报。** 今天它们都塌成同一条 `MODULE_NOT_FOUND`,补救办法却相反:

- **未声明** —— 指向"在 app 的 `package.json` 里声明并安装",并说明为什么
  hoisting / `NODE_PATH` 不被接受;
- **声明了但解析不到** —— 明确说这是**安装**问题(`pnpm install`、生产 prune
  砍掉了它、dist 没构建),别再让人回去重看那份已经写对的 `package.json`。

分类经新导出的 `hostImportFailureKind(err)` 暴露给调用方;两种错误都仍带
`code: 'MODULE_NOT_FOUND'`,`isModuleNotFoundError` 的既有判定不变。

**BREAKING — 哪类部署会从假绿变红,以及怎么修。**

1. **靠 hoisting 苟着的部署。** 一个 app 请求了 walled tenancy posture
   (`OS_TENANCY_POSTURE=group` / `isolated` 或 `OS_MULTI_ORG_ENABLED=1`)、
   却没在自己的 `package.json` 里声明 `@objectstack/organizations`,过去经 pnpm
   shim 启动能正常 boot —— 现在会命中 ADR-0093 D5 并 exit 1。
   **修法:在那个 app 的 `package.json` 里声明该依赖并安装。**
   这些部署本来就在未声明状态下运行,红的是一直存在的事实,不是新引入的故障:
   同一个 app 不经 shim 启动今天就已经是 exit 1。
   (同样适用于 `@objectstack/service-ai` / `@objectstack/service-ai-studio`,以及
   `bootStack({ multiTenant: true })`、dogfood 的 enterprise 门。)

2. **`createHostImporter` 的签名变了**,因为它现在需要 host 的**根目录**才能读到
   那份 manifest,而一个 `NodeRequire` 无法被问出它锚在哪里:

   ```diff
   - createHostImporter(createHostRequire(hostRoot))
   + createHostImporter(hostRoot)                     // 省略参数 = process.cwd(),同旧默认
   ```

   `createHostRequire` 本身保持不变,仍然导出。

新增导出(`@objectstack/types/node`):`HOST_DECLARATION_FIELDS`、
`HostDeclarationField`、`HostDeclaration`、`readHostDeclaration`、
`isDeclaredByHost`、`packageNameFromSpecifier`、`HostImportFailureKind`、
`HOST_IMPORT_FAILURE_KIND`、`hostImportFailureKind`。
