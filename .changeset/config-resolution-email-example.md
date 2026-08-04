---
---

docs(protocol/kernel): config-resolution 的 email 示例改用真实存在的键与取值 (#5105)

`content/docs/protocol/kernel/config-resolution.mdx`「Example 3: Development Overrides」的示例有三处不对应任何真实配置面:生产段写 `provider: 'sendgrid'` + `fromAddress`,开发覆盖写 `provider: 'console'`,env 覆盖写 `OS_EMAIL_PROVIDER=mailhog`。对照 `packages/spec/src/system/email-config.zod.ts`:`EmailProviderSchema` 是 `z.enum(['log','resend','postmark'])`,`sendgrid` / `console` / `mailhog` 三个取值一个都不在里面;承载发件人的键叫 `defaultFrom`,不叫 `fromAddress`,而且它是 `{ name?, address }` 对象(`EmailAddressConfigSchema`),不是字符串。照这一页粘贴出来的 `email` 配置,`fromAddress` 会被静默丢弃,provider 则要到 `makeTransport` 才抛 unknown provider —— 错误全部推迟到运行时,正是 Prime Directive #10 说的「advertise a capability the runtime doesn't deliver」。

这一页本身带着一条 warn callout,说明 `database` / `http` / `secrets.provider` 等嵌套形状只是意图示意、并非 paste-ready。但 `email` 恰恰**不在**那份豁免名单里,而且它是真实配置面:`packages/cli/src/commands/serve.ts` 的 `cap === 'email'` 分支实打实地读 `config.email.{provider,apiKey,defaultFrom,retries}`,并按 `OS_EMAIL_*` 覆盖它们。所以这段示例不该靠「示意」免责,它应当是真的。

改法是把三处换成今天在 `main` 上就成立的取值,而不是改讲一个与 email 无关的例子 —— 这一页要讲的是配置层叠,email 只是载体,换载体会连累上下文。生产段用 `provider: 'resend'` + `defaultFrom: { name, address }`,并补上 `apiKey`:非 `log` 的 provider 缺 key 时 `serve.ts` 会打 warning 并回落到 LogTransport,示例不写它就等于示范一份「看着配好了、其实没发出去」的配置,是同一个缺陷换个方向再犯。开发覆盖用 `provider: 'log'`。

**没有写 `smtp`。** `EmailProviderSchema` 目前仍是三值枚举,把 `smtp` 加进去是 #5104 的工作、尚未落地;此刻写它就是把本单刚修掉的 declared ≠ implemented 重新引入一遍。等 #5104 落地后这一页要不要提 SMTP,是那一单自己的事。

env 覆盖层顺带修实:原文只有一行 `OS_EMAIL_PROVIDER=mailhog`,若单纯改成 `=log`,而开发配置段已经选了 `log`,这一层就退化成一条无效果的示例,「further override」讲不通。现按本页 §Merge Strategies 自己教的「对象深合并、原始值替换」把语义补全:开发文件只替换了 `provider`,`apiKey` / `defaultFrom` 仍从生产配置继承,于是再加一行 `OS_EMAIL_FROM=Dev Mailer <dev@example.com>` 覆盖 `defaultFrom`。`OS_EMAIL_FROM` 是真实变量(`content/docs/deployment/environment-variables.mdx` 有登记),`serve.ts` 也确实解析 `Name <addr>` 两种写法。层叠要点(生产配置 → 开发覆盖 → env 覆盖的优先级)因此比改之前更完整,而不是被讲丢。

该代码块未加 `{/* os:check */}` 标记:它是把 shell 赋值行混在 `typescript` 围栏里的伪代码片段,本就不可编译,加标记只会让 `check:skill-examples` 变红。纯文档,releases nothing。
