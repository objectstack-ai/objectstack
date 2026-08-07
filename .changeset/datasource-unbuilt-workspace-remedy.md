---
"@objectstack/service-datasource": patch
---

fix(service-datasource): 未构建的工作区不再被当成「配置写错了」(#5794)

datasource 的 fail-fast 报错原本只有一句收尾建议,不分成因:

```
✗ datasource 'default': connect failed — Cannot find module
  '…/@objectstack/driver-sql/dist/index.mjs' imported from …
  Fix the datasource configuration, or set OS_ALLOW_DRIVER_CONNECT_FAILURE=1
  to boot anyway and serve errors until it is reachable.
```

对「数据库真连不上」——错的 DSN、轮换掉的密码、断掉的网络——这句话是对的。
但对**驱动包没构建**这一个成因,两半都是有害建议:

- **「Fix the datasource configuration」** 把读者支去改一份本来就正确的配置。
  在那里写什么都变不出一个 `dist/` 目录。
- **「set OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway」** 比没用更糟:
  它不是绕过问题,而是**藏起**问题。半个工作区会宣称自己启动成功,然后对每个
  请求回 `ERR_DATASOURCE_UNAVAILABLE`——比诚实地拒绝启动难查得多。那个开关是
  为「数据库暂时不可达」准备的(一个关于世界的事实,可能自己好起来);缺构建产物
  是关于这份 checkout 的事实,不该有任何环境变量能启动越过它。

而唯一有效的修法(`pnpm build`)一个字都没提。

现在 connect 失败会按**成因**选收尾句。底层错误是模块解析失败时(ESM `import()`
报 `err.code === 'ERR_MODULE_NOT_FOUND'`,CJS `require()` 报 `MODULE_NOT_FOUND`;
`code` 被 re-throw 丢掉时退回 `Cannot find module` / `Cannot find package` 文本),
消息改成:

```
The driver package could not be LOADED at all — it is not installed, or its build
output is missing. That is a build precondition, not a datasource fault: the
configuration is fine, and no boot-time override can make a driver that does not
exist answer a query. Run `pnpm install && pnpm build`, then start again.
```

一个正确修法,只说一次,**不提**那个逃生开关——连「别用它」都不提:一个已经卡住的
读者会去找最短的那行看起来能让他继续的话。这与 `datasource-pool-support.ts`
(#5714 / #5931)和 `check:dev-prereqs`(#5795)是同一条消息纪律。

判据复用 `@objectstack/types` 的 `isModuleNotFoundError`(framework#3265 起的唯一
所有者),不另起一份;它先看结构化的 `err.code`、再退回文本,而这个结构化信号原本
在 `handleFailure` 只收 `reason: string` 时被丢弃了,所以抛出值本身现在也一并传入。

**纯诊断分类,零行为变化。** fail-fast 的判定、触发时机、抛出的错误类型、保留的
连接状态,以及设了 `OS_ALLOW_DRIVER_CONNECT_FAILURE` 时的降级启动路径全部不变;
其它成因(真连接失败、驱动不受支持、凭据解析不出)的消息逐字未动。
