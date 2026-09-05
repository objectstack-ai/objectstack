# 车道岗位说明:domain:engine

见 SKILL.md 〈座位贴协议〉;本文是本车道岗位说明,现值状态恒在座位贴,⛔ 不迁入本文。

## 范围

- `packages/objectql`(含 SchemaRegistry)、`packages/core`、`packages/formula`
  (CEL、`matches-filter`、RLS 谓词求值)、`plugin-pinyin-search`(落点在编译与查询核心)。
- `objectql/src/metadata-facade.ts` 名字带 metadata,仍归本车道。
- `packages/metadata*`(加载、注册、持久化、缓存、目录)、`packages/platform-objects`。
- `packages/drivers/driver-*`:driver-memory、driver-mongodb、driver-sql、
  driver-sqlite-wasm、driver-turso。
- 红线:改元数据格式或接受面 ⇒ `domain:spec`,判据是改变接受面而不是碰到 spec。
- `/meta` 路由本体在 `packages/rest` ⇒ `domain:cli`;`packages/services/**` ⇒ `domain:services`。
- `content/docs/**` 与 `packages/lint` ⇒ `domain:devx`。

## 常设承诺

- driver conformance 台账只降不升:driver 卡的派发令要求 dev 前后各读一次 covered 与 DEBT。
- 改变契约接受或拒绝行为的卡按条款②处理,判据与档位在 SKILL.md,⛔ 不另抄。

## 席内判断

- 区域不等于文件:区域放行只能来自对方卡真实改动行程,有 PR 读 diff,没有就申报 UNKNOWN。
- 做删除的卡,其行程没人能从它加了什么的名字推出。
- 行号数小时内即腐烂,恒按符号定位。
- 五个 driver 列只有约三个独立实现:sqlite-wasm 与 turso local 都继承 `SqlDriver` 的 filter 编译器。
- ⇒ 把一致性表当五方佐证会高估证据;同理,单点修 SQL 家族共享 seam 即可覆盖三个 driver。
- 元数据合并语义按键类各不相同:fields 展开、validations 与 indexes 连接、标量 last-writer-wins。
- ⇒ 评审 pin 时先问它没有覆盖什么。
- 标量的 last-writer-wins 是重复立卡的老源头,同 seam 的第三张分歧卡优先裁类,不裁实例。
- 元数据接受面形状的卡先问生产者在哪:答案常改变卡的范围与域标签,回分诊。
