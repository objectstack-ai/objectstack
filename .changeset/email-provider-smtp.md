---
"@objectstack/spec": minor
---

feat(spec): `EmailProviderSchema` 补上 `smtp`,并把 SMTP 的 TSDoc 与实际能力对齐 (#5104)

`EmailProviderSchema` 停在 `log` / `resend` / `postmark`,而它自己的 TSDoc 还在
告诉作者「Self-hosted SMTP is intentionally NOT shipped in plugin-email; apps
that need SMTP register a custom `IEmailTransport` themselves」。#5087 之后这两
句都不成立:`@objectstack/plugin-email` 已内置 `SmtpTransport`(ADR-0012,
`nodemailer` 惰性 import),CLI 接受 `OS_EMAIL_PROVIDER=smtp` 并读取
`OS_EMAIL_SMTP_HOST` / `_PORT` / `_SECURE` / `_USER` / `_PASSWORD`。

结果是 declared ≠ implemented,而且是 **spec 落后于运行时** 的那一侧:用
`EmailServiceConfig` 标注 `objectstack.config.ts` 的作者,写
`provider: 'smtp'` 会拿到类型错误 —— 而这个 provider 早就能正常投递;生成的参考
文档 `system/email-config` 也只列三个值,读到的 AI 作者会认为 SMTP 不受支持。

**改动(纯加值,非破坏性):**

- `EmailProviderSchema` 增加 `'smtp'`。已有配置不受影响,无需 ADR-0087
  conversion / migration。
- 重写该段 TSDoc:SMTP 由 plugin-email 内置,`nodemailer` 惰性加载;并写明
  `sendgrid` / `ses` **不是**成员 —— 两者从未实现 HTTP-API transport,都通过
  `provider: 'smtp'` 连各自的 SMTP 端点(#5094)。
- `provider` 与 `options` 补 `.describe()`,所以参考文档现在正面说明:
  `provider: 'smtp'` 的连接参数放在 `options` 的 `host`(必填)/ `port` /
  `secure` / `user` / `password`,与 `OS_EMAIL_SMTP_*` 一一对应,env 优先。

**运行时零改动。** 这一单只把契约追平既成事实;plugin-email 与 CLI 未被修改。

新增的跨包契约测试把这份 provider 词表与 `@objectstack/plugin-email` 的
`EMAIL_TRANSPORT_PROVIDERS`(`makeTransport` 实际 switch 的数组)双向锁死,
两侧任一方单独增删都会红 —— 下一个 provider 必须两边都有意识地改。
