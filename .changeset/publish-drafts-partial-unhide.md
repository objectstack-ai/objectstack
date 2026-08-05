---
"@objectstack/runtime": patch
---

fix(runtime): 可见性翻转中途失败时,已落盘的 app 不再从响应里整批消失 (#5242)

`POST /packages/:id/publish-drafts` 的 ADR-0045 可见性翻转是一个**循环**:每个 app 一次
独立的 `saveMetaItem`,每次成功各自落盘。但 `unhidden` 数组声明在 `try` 之内、
`result.unhiddenApps` 又只在整个循环跑完之后才赋值 —— 5 个 app 里第 3 个抛异常时,前 2 个
**确实已经翻转并持久化**,却随栈一起被丢弃:响应里 `unhiddenApps` 压根不存在。

后果有两层,都指向同一个「机器可读面在撒谎」:

1. **响应少报了真实发生的事。** 调用方看到的是「翻转失败」,看不到「其中 2 个已经生效」。
2. **`metadata:reloaded` 对这 2 个 app 漏播。** 紧随其后的重绑定段读的正是 `unhiddenApps`,
   字段缺失 → 这 2 个已经变可见的 app 不进 `changed` → boot-cached 的消费者(首当其冲是
   automation engine)不重新同步它们,要等下一次重启。

修法按 PM 裁定取**增量累积**而非预校验:`unhidden` 与它的赋值一并提到 `try` 之外,名字只在
对应的 `saveMetaItem` **兑现之后**才 push,因此这个列表在任意时刻恰好等于「已经落盘的那些」。
赋值移到 `try/catch` 之后,成功与中途失败两条路径都会执行,并且仍在 announce 段之前 ——
部分失败时 `unhiddenApps` 与 `unhideError` **并存**:前者说什么翻成功了,后者说还有没翻完的。
`unhidden` 是每请求的局部量,不引入任何共享可变状态,符合 #5385 确立的显式传参姿态。

同时修掉那条 `error` 日志的措辞:它原先断言「其 app **全部**仍以 `hidden: true` 存着」,
一旦有翻转已落盘这句话就是假的。现在按两半如实点名 —— 哪些确实翻了(列出名字)、哪些仍然
是隐藏的,以及一如既往的后果与修复动作。

响应契约不变:仍然 200,字段还是原来那两个,只是部分失败时它们可以同时出现;重跑依旧幂等
(已翻转的 app `hidden !== true`,循环会跳过)。
