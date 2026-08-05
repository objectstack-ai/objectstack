---
"@objectstack/cli": patch
---

fix(cli): `os doctor` 按 `os serve` 的环境载入 `objectstack.config.ts`(#5397)

#5387 让 doctor **读**到了 `os serve` 的那份 `.env*` cascade,但 overlay 只套在一处读取上:
env 派生检查(posture,以及以它为闸门的 ADR-0120 D5e 建议)。`loadConfig()` 留在了外面。
于是两条命令仍然在**两份不同的环境**下打包同一个配置文件:

```
# .env
OS_DATABASE_URL=postgres://…

# objectstack.config.ts —— 顶层读环境变量是常见写法,不是刁钻写法
const url = process.env.OS_DATABASE_URL;
if (!url) throw new Error('OS_DATABASE_URL is required');

$ os serve    # dotenvFlow.config()(serve.ts:520)→ 之后才 bundleRequire → 正常启动
$ os doctor   # 无 overlay 直接 bundleRequire → 抛错 → 被 config 分析那个很宽的 try 吞掉
              # → 「⚠ Could not load config for analysis (config checks skipped)」,warning,exit 0
```

两种危害,安静的那种更糟:

1. **响的** —— 上面那句话把责任推给配置文件,而配置文件没问题,同一个目录 `os serve`
   正常启动。它正是 #5382 判定为「归因错误」的那句,残存在 #5387 刻意没动的这条路径上。
2. **哑的** —— 配置文件只要**按环境值分支**(条件声明的 object / datasource),它对 doctor
   和对服务器就声明了不同的形状,于是下面每一项检查(循环依赖、未引用对象、孤儿视图、
   仪表盘完整性、spec 版本)判定的都是一份**服务器不会运行**的配置。全程不打印任何东西。
   这一半没有任何 warning 会浮现出来。

**现在的行为。** `loadConfig()` 套上 `run()` 顶部已经解析好的**同一份** `dotenvReading`
(不是第二次 `readDotenvFiles()` —— 一轮 doctor 只解析一次 cascade,否则 `Environment files`
那一行就未必是 config 载入真正看到的那份)。

`withDotenvOverlayAsync` 而不是既有的同步版:配置文件的顶层跑在 `bundleRequire` 的动态
`import()` 里面,同步版的 `finally` 会在 `loadConfig()` 交回 pending promise 的那一刻就把
overlay 摘掉 —— 套上了,又在被读之前摘掉,等于没套。两者共用同一套 apply/revert
(dotenv-flow 自己 `unload()` 的判定:只删掉仍然等于写入值的那些),不是抄一份。

**判定面的变化是本单的修复内容,不是副作用**(与 #5398 对 D5e 建议的处理同一姿态)。
可观察的差异有三类,都如实呈现:

- 此前因缺值抛错而被跳过的配置,现在**载入成功**,那句归因错误的 warning 不再出现,而
  下面那一整组 config 检查**开始运行** —— 因此可能新增此前从未打印过的 warning
  (真机复现:`⚠ Object "account" is defined but not referenced by any view, flow, app, or lookup field`,
  在修复前整块被跳过,一条都看不到);
- 按环境值分支的配置,doctor 判定的对象/视图集合改为与 `os serve` 一致;
- 配置**确实**坏掉时,`Could not load config for analysis (config checks skipped)`
  **照旧触发**。套上 cascade 之后仍然载入不了的配置,`os serve` 同样载入不了 —— 这句话
  从此归因正确,而不是被消音。把它一并静默,等于用「没有 warning」换掉「归因错误的
  warning」。

**来源口径不变:只报来源,从不报值。** 这一点在本次改动后更吃重:overlay 现在携带的是
配置文件想读的**任意**变量,而不再是 `DOCTOR_ENV_INPUTS` 这个声明过的子集,而 `.env` 正是
密钥的常见住处。变量名无法预先枚举,提供它们的**文件**可以 —— `Environment files` 仍是
报告 cascade 的唯一一处,并在其中说明这些文件同样施加于配置载入:

```
      These files are also applied while objectstack.config.ts is loaded, so a config
      that reads process.env at top level sees the values `os serve` gives it.
```

overlay 的边界也照旧:它在配置文件**载入**期间有效,而不是常驻整轮运行 —— doctor 分析的
一切都是模块求值时读出的普通值,载入结束即摘除(回调抛出时同样摘除,有测试钉住)。
