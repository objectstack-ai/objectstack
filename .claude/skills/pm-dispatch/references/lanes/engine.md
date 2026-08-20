# 车道岗位说明:domain:engine(references/lanes —— 座位贴指针指向本文件)

岗位说明版本化于此,升级走技能 PR;现值状态恒在座位贴,⛔ 不迁入本文件。本车道
2026-08-19 由 engine-core+metadata+drivers 合并(裁决引文在 SKILL.md 域车道表)。

## 范围

- `packages/objectql`(含 SchemaRegistry)、`packages/core`、`packages/formula`
  (CEL / `matches-filter` / RLS 谓词求值)、`plugin-pinyin-search`(落点在编译/查
  询核心)。⚠️ `objectql/src/metadata-facade.ts` 名字带 metadata,归本车道。
- `packages/metadata*`(加载、注册、持久化、缓存、目录)、`packages/platform-objects`。
- `packages/drivers/driver-*`(driver-memory / driver-mongodb / driver-sql /
  driver-sqlite-wasm / driver-turso)。
- 红线:改元数据**格式/接受面**(判据是「**改变**接受面」,不是「碰到 spec」)⇒
  `domain:spec`;`/meta` 路由本体在 `packages/rest` ⇒ `domain:cli`;
  `packages/services/**` ⇒ `domain:services`;`content/docs/**`、`packages/lint`
  ⇒ `domain:devx`。

## 常设承诺

- **每轮巡检第一判据**:先读半状态巡查锚(`half-state-patrol.yml` 置顶 issue)点名本道卡/PR/座位贴的 H 行,逐行认领或处置,再做其余判据;锚行未处置 ⛔ 不开新派发。
- **投入冻结随包不随车道**:维护者 2026-08-05 对 `driver-memory` /
  `driver-mongodb` 族的投入冻结继续有效;能穿过冻结的形状是「消除静默失败模式」与
  清账/对齐既有能力,形如**能力投资**的卡派发前须取裁决;`formula` / `driver-sql`
  不受影响。
- **driver conformance 台账只降不升**:任何 driver 卡的派发令要求 dev 前后各读一
  次 covered/DEBT 读数,写进报告。
- 改变契约接受/拒绝行为的卡按条款②处理(判据与档位在 SKILL.md,⛔ 不另抄)。

## 席内判断

- **区域 ≠ 文件**:区域放行只能来自对方卡**真实改动行程**(有 PR 读 diff,没有就
  申报 UNKNOWN);**做删除的卡,其行程没人能从「它加了什么」的名字推出**。行号数
  小时内即腐烂,恒按符号定位。
- **五个 driver 列只有约三个独立实现**:`driver-sqlite-wasm` 与 `driver-turso`
  local 都继承 `SqlDriver` 的 filter 编译器 —— 把一致性表当五方佐证会高估证据;同
  理,单点修 SQL 家族共享 seam 即可覆盖三个 driver。
- **元数据合并语义按键类各不相同**(fields 展开 / validations+indexes 连接 / 标量
  last-writer-wins)—— 评审 pin 时先问它**没有**覆盖什么;标量的 last-writer-wins
  是跨机制重复立卡的老源头,同 seam 的第三张分歧卡优先裁**类**,不裁实例。
- 元数据接受面形状的卡先问「生产者在哪」—— 答案常改变卡的范围与域标签,回分诊。
