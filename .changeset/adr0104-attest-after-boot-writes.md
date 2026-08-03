---
"@objectstack/objectql": patch
"@objectstack/platform-objects": patch
---

fix(objectql,platform-objects): 一次启动不能证明它自己随即违反的契约 —— ADR-0104 空库自证改为在本次启动写完数据后下结论 (#4769)

一个全新部署第一次 `pnpm dev` 全绿(130 rows,0 ERROR),**第二次启动开始永久 10 条
ERROR**、10 条种子记录写不进去。数据没变、代码没变,只是重启了一次;被拒的正是首启
自己写进去的数据。

根因不是哪个值算错了,是**顺序反了**。`sys_migration` 里那两行
(`adr-0104-file-references` / `adr-0104-value-shapes`)带着
`{"attested":"datastore-created-empty"}` 写在 `kernel:ready`,而同一次启动的 seed
还在往里写行。「空库 ⇒ 没有历史值」这个推理成立的前提是**没有数据可写**,而它恰恰
写在即将写入 130 行之前 —— 证明落笔那一刻是真的,一秒之后就不是了。于是首启在
warn-first 下把数据留下,之后每一次启动读到这张证书、进入 strict、拒掉前任写下的
那批行。

## 改了什么

**证书必须覆盖它所声称的那批数据。**

- **写入时机**:新库自证改为在**本次启动自己的数据落定之后**进行 ——
  `app:seeded`(inline seed 结算点,含超出 `OS_INLINE_SEED_BUDGET_MS` 后台跑完的
  那一半),不 seed 的 kernel 仍由 `kernel:ready` 兜底。两条路径进的是同一个幂等
  调用。
- **写入前提**:`attestFreshDatastore` 先问引擎「这次启动放行过违反该契约的值吗」。
  引擎在 warn-first 放行每一个不合形状的值时,用**与 strict 模式完全相同的判定**把
  它记下来 —— 证明干净需要扫全库,证伪只需要一个反例,而这个反例写路径已经算出来
  了。任一条被本次启动证伪的迁移 id **不再自证**,部署维持 warn-first(真实且可
  恢复),并在日志里指名是哪个 `对象.字段` 让这道闸没关上、该跑哪条 `os migrate`。
  两行一起改:`adr-0104-file-references` 与 `adr-0104-value-shapes` 各自独立判定,
  一个 `cover` 不合形状不牵连 `location`,反之亦然。
- **写入之后**:证书若在签发之后被本次启动推翻(操作员显式开了
  `OS_ALLOW_LAX_MEDIA_VALUES` / `OS_ALLOW_LAX_VALUE_SHAPES`,或后台 seed 收尾晚于
  签发),引擎**撤销**它 —— `verified_at` 清空、`blocking` 记上、`details` 保留原
  `attested` 并补一条 `revoked`。只针对**本次启动亲手创建的库**上的自证行:扫过全
  库的真实迁移证据不会被一次写入的观察推翻。

**记忆化的第二张脸也一并修了。** 首启之所以「看起来是绿的」,一半靠的是进程内正好
缓存了 `false`。`sys_migration` 在 kernel init 期间才注册,而第一条写可能赶在它之
前 —— 那次读根本没读到账本,却被当成结论冻结了一整个进程的姿态。现在区分两种否定:
**问过了、账本说不**(结论,照旧缓存)与**根本问不到**(未注册 / 查询抛错 —— 依旧
答 `false`,闸依旧关着,但不记住,下一次写再问一次)。代价是账本存在之前每次写多一
次 registry 查表(在任何查询之前就短路),账本可读之后即止。

启动横幅那条 ADR-0104 建议行(`kernel:bootstrapped`)也改为直接读账本而非读记忆化
结果 —— 否则一个刚刚自证成功的新部署会被告知去跑一条已经不需要跑的迁移。

## 对既有部署的影响

- 数据本来就合规的新部署:行为不变,照旧 born-migrated,启动即 strict。
- 种子数据不合规的新部署:**不再**发出那张假证书。首启与之后每一次启动一致地停在
  warn-first,并且每次都告诉你是哪一个值、跑哪条命令。数据本身该怎么修还是怎么修
  (showcase 的 `cover` 种子值在 #4774 单独跟踪)。
- 已经跑过 `os migrate … --apply` 的部署:完全不受影响 —— 扫描得来的证据不经由本
  次改动的任何路径改写。
