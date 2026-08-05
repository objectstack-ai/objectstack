---
'@objectstack/rest': patch
---

REST 的显式状态直通:4xx 错误消息超过 500 字符时**截断**,不再整条替换成 `Request failed`

`mapDataError` 与 `resolveErrorResponse`(`sendError` 的取值端)两处 4xx 直通分支,过去都以 500 字符为界把整条 message 换成字面量 `Request failed` —— `status` 和 `code` 照常落地,正文一个字不剩。这把激励方向弄反了:驱动层那些拒收信息**唯一的存在意义**就是告诉作者哪个操作符/字段写错了、协议是怎么声明的,而 driver-sql 里写得最细的两条(#5158 未降解的 `FilterArray`、#5347 非布尔 `$null` 比较值)恰好都越过 500 字符,于是客户端只收到 `{ "code": "INVALID_FILTER", "error": "Request failed" }`。更反直觉的是:这两条**不带** `status` 时反而能原文直达(走 `mapDataError` 末尾的 `{ status: 400, body: { error: raw } }`),#4436 给它们加 `status: 400` 是为了赋予 ADR-0112 的 wire 身份,却在这一档让可读性变差了。

现在超长消息按 `message.slice(0, 499) + '…'` 截断,与驱动侧 `safeShapePreview` 同源。这些消息把主句(操作符、字段、path、收到了什么、协议怎么声明)放在最前,被截掉的是尾部的归因和 issue 号 —— 本就该留在日志里而非响应里的部分。上限仍是 500,变的是**到达上限时的处理方式**;短于 500 的消息逐字不变。

影响面不止过滤器:任何携带 4xx `status` 的领域错误同享此修复,包括 metadata save 校验的 422(实测一条五 issue 的 `INVALID_METADATA` 就在这条线上下)、plugin-sharing 的 record-scope 403 等。

`sendError` 一侧的直通区间是 400–599,其中 **5xx 的整条替换刻意保持不变**:4xx 的正文是写给调用方的补救说明,5xx 的正文是服务端故障的日志诊断 —— 这与 `mapDataError` 同族分支「deliberately limited to 4xx」的既有取向一致。
