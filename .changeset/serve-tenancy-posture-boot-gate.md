---
"@objectstack/cli": patch
---

fix(cli): 非法 `OS_TENANCY_POSTURE` 在 `serve` 最开头被显式拒绝,不再先伪装成「AuthPlugin 加载失败」(#5359)

`resolveTenancyPosture()`(`@objectstack/types`)对无法识别的值抛错,文案自称
「Refusing to boot rather than silently falling back to a posture with no
organization wall」。**拒绝本身一直是对的,错的是这个拒绝怎么传出去。**

`serve` 过去没有单独解析 posture,而是让抛错从「第一处读到它的地方」自然逃逸,而那个
位置恰好在 AuthPlugin 那个很宽的 `try` 里 —— 它的 catch 只打印一句黄字就继续。于是一个
env 拼写错误的第一现场是:

```
  ⚠ AuthPlugin failed to load: Invalid OS_TENANCY_POSTURE="bogus". Expected one of: …
```

把环境变量拼错报成了插件加载问题。启动随后**带伤继续**:整个 capability slate 照常装载,
本地 crypto 密钥被生成并**持久化到磁盘**,直到下一处没有被 `try` 包住的读取
(ObjectQL `SchemaRegistry` 构造,内核 bootstrap 阶段一)才让 `runtime.start()` 中止,
最终由通用 `printError` 把解析器那句话裸着打出来 —— 退出码对,别的都不对。

**现在的行为。** `serve.run()` 在 `dotenv-flow` 载入之后、读取配置文件之前、任何 `try`
之外解析一次 posture。非法值走 ADR-0093 D5 同款形状的显式拒绝 —— FATAL + 完整修法清单 +
`process.exit(1)`(不是 throw,throw 正是会被下游 catch 降级成 warning 的那种东西):

```
  ✖ FATAL: OS_TENANCY_POSTURE="bogus" is not a recognized tenancy posture.
    Refusing to boot. …

    No config has been loaded, no plugin has been mounted, and the HTTP server was
    never started — this deployment has not served a single request.

    Fix one of:
      • set OS_TENANCY_POSTURE=single — …
      • set OS_TENANCY_POSTURE=group — …
      • set OS_TENANCY_POSTURE=isolated — …
      • unset OS_TENANCY_POSTURE entirely — …

    cause: Invalid OS_TENANCY_POSTURE="bogus". …
```

修法清单由 `@objectstack/spec/security` 的 `TENANCY_POSTURES` 生成,不是第二份字面量,
所以新增一个 posture 不会让这段建议悄悄过期。文案里点名 `.env` —— 该变量常常来自提交进
仓库的 `.env*` 而不是 shell,这也是把闸门放在 dotenv 载入**之后**的原因。

`serve` 内后续所有 posture 读取(组织插件装载判断、启动横幅的 `Tenancy:` 行)改为复用
闸门解析出的那一个值,不再各自重新解析。横幅那处尤其值得说:它此前是非法 posture 的
**最后一道防线**,等于让一个诊断输出承担安全属性 —— 现在闸门拥有这个拒绝,横幅只负责
汇报闸门的结论。

**一处订正。** #5359 的静态追踪认为进程「在报错前已经 listen 过」。实测并非如此:逃逸的
抛错发生在内核 bootstrap **阶段一**(插件 init),而监听套接字在**阶段四**的
`kernel:listening` 钩子才打开,所以端口从未被绑定过 —— 修复前后都是如此。本次真正改变的
是:拒绝成为第一条也是唯一一条输出、归因正确、带处方,且启动不再留下任何副作用
(修复前那次「被拒绝」的启动会在磁盘上留下持久化的 dev crypto key)。
