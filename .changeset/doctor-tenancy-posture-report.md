---
"@objectstack/cli": patch
---

fix(cli): `os doctor` 指名道姓报告非法 `OS_TENANCY_POSTURE` 并以非零码退出,不再报成一句「Could not load config」(#5382)

`resolveTenancyPosture()`(`@objectstack/types`)对无法识别的值抛错。doctor 有两处读
posture —— ADR-0120 D5e 的 unique-scope 闸门,以及 `findUnscopedGlobalUniques()` ——
**两处都在 config 分析那个很宽的 `try` 里**,而它的 catch 只会打印

```
  ⚠ Could not load config for analysis (config checks skipped)
```

并记一个 warning。于是一个 `os serve` 会**拒绝启动**的环境,`os doctor` 报成:

```
⚠️  Environment is functional but has some warnings.     EXIT=0
```

全程不出现 `OS_TENANCY_POSTURE` 这个词。一行里两个缺陷:**归因错了**(配置本身没问题,
被指着的是配置),**严重级也错了**(exit 0 意味着任何把 `os doctor` 放进 CI/健康检查的
地方,都不会因为这个「环境根本起不来」的配置错误变红)。这正是 #4801 / cloud#1020 那类
「诊断面与运行时不一致」,而且落在最糟的位置 —— `os doctor` 就是运维在 `serve` 起不来
之后会去跑的那条命令。

**现在的行为。** posture 在 `run()` 顶部、**任何 `try` 之外**解析一次。非法值产出一条
普通的 `error` 体检项:

```
  ✗ Tenancy posture      OS_TENANCY_POSTURE="isolatd" is not a recognized tenancy posture — `os serve` refuses to boot this environment
      → Set one of the accepted values:
        • OS_TENANCY_POSTURE=single — one organization, no organization wall — the default
        • OS_TENANCY_POSTURE=group — organization wall enforced by the open engine, one shared database
        • OS_TENANCY_POSTURE=isolated — organization wall + the enterprise @objectstack/organizations runtime …
        • or unset OS_TENANCY_POSTURE entirely — the posture then derives from
          OS_MULTI_ORG_ENABLED (true ⇒ isolated, anything else ⇒ single)
      Read from this process's environment only: unlike `os serve`, `os doctor` does not
      load `.env*` files, so a value set in one is not visible here.
      cause: Invalid OS_TENANCY_POSTURE="isolatd". …
```

修法清单由 `@objectstack/spec/security` 的 `TENANCY_POSTURES` 生成,不是第二份字面量,
新增一个 posture 不会让这段建议悄悄过期;`cause` 直接引用解析器自己的那句话,doctor 不
维护会跟它跑偏的第二份措辞。

**与 #5359 / PR #5381 给 `serve` 加的闸门同形,但裁决不同,且是刻意的**:serve 是**拒绝**
(FATAL + 在任何启动动作之前 `process.exit(1)`),doctor 是**报告** —— 报告照常跑完,由
doctor 自己的错误汇总给出非零退出码。doctor 的语义是「把所有问题一次说清」,不是「停下」。

两处读 posture 的地方现在复用同一个已解析值,不再各自重新解析。

**顺带修好的一个更大的洞:** 那两处读取此前都在 `if (configExists())` 之内 —— 一个没有
`objectstack.config.ts` 的环境**从来没读过** posture,连那句归因错误的 warning 都不会有。
现在与是否存在配置文件无关。

**一个如实说明的残留:** `os doctor` 不加载 `.env*`(`serve`/`dev`/`start` 用 dotenv-flow
加载),所以写在提交进仓库的 `.env` 里的非法 posture 仍然到得了服务器、到不了这份报告。
文案里明说了这一点,不冒充自己检查过 —— 该跨命令不一致另行记录为 #5387。
