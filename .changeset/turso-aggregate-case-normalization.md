---
'@objectstack/driver-turso': patch
---

drivers(turso): remote 聚合函数名不再大小写归一化,两面只认协议声明的小写拼写 (#6203)

`TursoDriver` 按连接串 `url` 选面:本地/副本继承 `SqlDriver`,远程委派 `RemoteTransport`。
两面此前对聚合函数名的归一化不一致 —— remote 先 `.toLowerCase()` 再查自己的编译表,local
拿到什么查什么。于是同一个驱动、同一条查询,答案取决于连接串:

```
COUNT   REMOTE -> RESOLVED "SELECT count(\"stage\") AS \"n\" FROM \"deal\""
        LOCAL  -> THREW    INVALID_QUERY / 400
```

本次删掉 remote 侧的 `.toLowerCase()`。`AggregationFunction` 是**大小写敏感**的 `z.enum`
(`AggregationFunction.parse('COUNT')` 直接抛错),`COUNT` 是协议从未声明的拼写,remote
多认的是一种私有方言;按契约优先(PD#12)收紧消费端,而不是把方言固化成第二套事实契约。

**升级说明(user-visible)**:remote 连接不再接受大写或混合大小写的聚合函数名。
`COUNT` / `Count` / `SUM` 等此前在 remote 能编出 SQL 的拼写,现在与 local 一样统一落
`INVALID_QUERY` / 400(「不是已声明的聚合函数」)。**作者侧修法是改用小写** —— 把
`aggregations[].function` 写成协议声明的 `count` / `sum` / `avg` / `min` / `max`
(以及已声明但本后端未实现的 `count_distinct` / `array_agg` / `string_agg`)。

经 REST/协议门进来的查询不受影响:大写拼写在 `AggregationNodeSchema` 就被拒,到不了驱动;
仓内亦无任何发送大写拼写的调用方。受影响的只有绕过 spec 校验、直接调用远程驱动且依赖该
归一化的进程内调用方。

`#5907` 落地的拒收信封(第 1 类 `INVALID_QUERY`/400、第 2 类 `NOT_IMPLEMENTED`/501、
按调用方原始拼写分类)与默认 alias 的拼法均未改动。
