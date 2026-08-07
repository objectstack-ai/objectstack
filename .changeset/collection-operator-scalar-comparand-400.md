---
"@objectstack/objectql": patch
---

fix(objectql): 集合算子的标量比较值答 400 INVALID_FILTER 并点名期望形状,不再 500 DATABASE_ERROR

`FieldOperatorsSchema` 声明 `$in` / `$nin` 的比较值是数组、`$between` 是 `[min, max]` 二元组,但入口处没有任何一层强制这条声明:`isFilterAST` 只看算子,`parseFilterAST` 照单下降,于是 `['status', 'not_in', 'done']` 变成 `{ status: { $nin: 'done' } }` 一路走到驱动。

**行为变化(用户可见)**:此前 `driver-sql` 把标量交给 `whereIn(field, scalar)`,答 **500 `DATABASE_ERROR`** —— 用服务端故障码报告一个调用方能自己改好的过滤器,且不说明是哪个算子、哪个字段、该写成什么。现在引擎在唯一收口点拒收,答 **400 `INVALID_FILTER`**,信息点名算子(同时给出 `not_in` / `nin` / `notin` 这类作者实际书写的拼法)、字段、收到的值与位置、以及可直接粘贴的正确形状,并声明该过滤器**未被应用**。

覆盖两道门:直接调用引擎(`FilterArray` 下降路径)与 HTTP 面(协议层已自行下降成 `FilterCondition` 对象后再交给引擎)—— 后者正是本问题实测到的那道门。`find` / `findOne` / `count` / `aggregate` / `update` / `delete` 六个入口一致。

`$between` 的非二元组比较值一并收在同一处:`driver-sql` 与 `driver-memory` 各自已经拒收(措辞保持逐字一致),`driver-mongodb` 的分支则直接落空、不发射区间谓词 —— 收在收口点后三家答案一致。

**不变的**:`$in: []` / `$nin: []` 仍是合法谓词(分别表示「不匹配任何行」与「匹配所有行」);列表**成员**的类型不在此处复判(那是 #5234,另一个面);非集合算子的标量比较值不受影响,包括 `$gt` 的 ISO 日期字符串这类 `FieldOperatorsSchema` 声明更严、而各后端一致接受的形状。
