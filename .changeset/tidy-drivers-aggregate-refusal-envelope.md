---
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
---

drivers(sql,turso): 聚合函数拒收带上 ADR-0112 信封,并把两类条件分开措辞

`SqlDriver.mapAggregateFunc()` 与 `RemoteTransport.aggregate()` 此前对同一条件各抛一个裸
`Error`(`code`/`status` 皆 `undefined`),`mapDataError` 因此落默认分支——一条本该 4xx 的
调用方错误以不透明 500 到达客户端。两处同时改,同一信封体例、首句逐字一致(#5240):

- **协议未声明的函数名**(如 `median`)→ `INVALID_QUERY` / 400。这正是协议门
  (`metadata-protocol` 的 `invalidQueryError`,#4254)对同一条件已经给出的码,于是
  进程内调用方与 REST 调用方读到同一个答案。
- **协议已声明、本后端编不出**(`count_distinct` / `array_agg` / `string_agg`)→
  `NOT_IMPLEMENTED` / 501。这是能力缺口而不是调用方的错(`driver-mongodb` 编得出这三个),
  措辞明确说明查询拼写无误,不把作者说成打错字。

两面都只改拒收的身份:编得出的五个函数生成的 SQL 逐字节不变。
