---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): 短信日配额拒发时,OTP / 邀请短信按 429 TOO_MANY_REQUESTS 作答,不再是 500 (#6039)

#2814 把短信总量成本闸落在 `SmsService.send()` —— 它是内核服务,不知道调用方是谁,
所以超限时**返回**一条失败结果,把码写在服务层既有的 `CODE: message` 信封上:
`TOO_MANY_REQUESTS: daily SMS quota exhausted`。把 HTTP 语义还原回去是 auth 端点的
职责,而 `AuthManager` 此前没有做:`deliverPhoneOtp()` / `sendPhoneInviteSms()` 对
任何 `status === 'failed'` 一律抛普通 `Error`。

better-auth 的路由层 better-call 只把 `APIError` 映射成真实状态码
(`isAPIError = err instanceof APIError || err?.name === 'APIError'`,
better-call@1.3.7 `dist/utils.mjs:57`,消费点在 `dist/router.mjs:93`),其余一律走
`console.error` + **500、响应体 `null`** 的分支。于是配额拒发对外是 500,
`TOO_MANY_REQUESTS` 只留在服务端日志里;而**同一个端点**上按号码冷却闸
(`assertPhoneOtpSendAllowed`,在 admission hook 里)抛的是
`APIError('TOO_MANY_REQUESTS')`,正常回 429 —— 一个端点两种口径,正是 #2814
「两道墙从外面看应当一样」的反面。

现在两处失败分支都先识别信封上的 `TOO_MANY_REQUESTS:` **前缀**,改抛
`APIError('TOO_MANY_REQUESTS')`:

- **只有码跨包**。识别用的 `TOO_MANY_REQUESTS` 在 plugin-auth 本地写死并注明出处
  (`SMS_QUOTA_EXCEEDED_CODE`,`packages/services/service-sms/src/sms-daily-quota.ts`)——
  `@objectstack/service-sms` 已经依赖本包(它的日计数器从这里 import
  `InProcessCounterStore`),反向 import 会成环;这与 service-sms 里
  `normalizeSmsRecipient` 就地重述 plugin-auth 形状规则是同一个取舍的另一半。
  跨包重述的只是一个 ADR-0112 闭集错误码,冒号后的措辞归服务层所有,可以自由改写。
- **不泄露预算**。429 文案沿按号码闸的措辞形状,不含上限、剩余量与重置时刻
  (按号码闸报自己的重试窗口,是因为它算得出;配额闸不承诺它给不出的时间)。
- **不顺手收紧**。传输故障(provider 宕机等)仍抛普通 `Error`,500 语义原样不变;
  仅仅在文中提到该码而不以之开头的 provider 报错同样保持 500。

对外可见的变化:`POST /phone-number/send-otp`、
`POST /phone-number/request-password-reset` 在部署日配额耗尽时,由
**500 + 空响应体**变为 **429 TOO_MANY_REQUESTS**,与按号码冷却闸同形。
邀请短信路径同样返回 `APIError`;仓内唯一调用方(admin import-users)按行捕获它并
记为 `INVITE_SMS_FAILED`,该路径的变化是行内报错不再携带服务层原始信封。
