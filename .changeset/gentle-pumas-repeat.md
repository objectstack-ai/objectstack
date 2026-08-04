---
'@objectstack/driver-sql': patch
'@objectstack/spec': patch
---

fix(driver-sql): `$field` 跨字段比较改为按 ADR-0112 响亮拒绝,不再抛裸 TypeError

`{ amount: { $gt: { $field: 'budget' } } }`(spec `FieldReferenceSchema`,由 `compileCelToFilter` 在转译含字段间比较的 CEL 权限/RLS 规则时产出)此前被 SqlDriver 当作**绑定值**交给驱动,sqlite 抛出无 `code`、无 `status` 的裸 `TypeError` —— 落在 `INVALID_FILTER` 信封之外,到客户端表现为不透明的服务端错误。更隐蔽的是列表位置:`$in` / `$between` 里的 `$field` 成员连报错都没有,直接静默返回零行。

现在两者都以完整信封拒绝(`error.code = INVALID_FILTER`、HTTP 400、无 `[sql-driver]` 前缀),报错点名字段、运算符与被引用字段,并说明跨字段比较**当前仅内存求值路径(`matchesFilter`)支持**。三个比较发射点统一处理,Filter Protocol 与数组三元组两种写法得到同一答案。

同一处闸门补上了 issue 指出的通用臂:**已知运算符 + 无法绑定的值形态**(标量比较位上的普通对象 / 数组)此前同样是裸 `TypeError`,现在也返回 `INVALID_FILTER`。`$in` / `$nin` / `$between` 的正常数组绑定不受影响。

`FieldReferenceSchema` 声明保留,JSDoc 补注执行支持面(内存求值 ✅ / SQL 下推 ❌ 响亮拒绝);SQL 列对列编译实现见 #5222。
