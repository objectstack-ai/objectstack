---
'@objectstack/types': minor
'@objectstack/rest': patch
'@objectstack/metadata': patch
'@objectstack/service-analytics': patch
---

refactor(types,rest,metadata,analytics): Postgres 的 `"x" of relation "y"` 短语收归一处，三个包不再各修一遍同一个超串洞（#6615）

Postgres 把「关系内部某个子对象」的失败写成 `column "label" of relation "sys_team" does not exist`——里面**逐字包含**一句合法的「表不存在」短语 `relation "sys_team" does not exist`，含义却相反：关系正因为存在才被点名。任何对「这句话是不是在说表没了」的正则收紧都消不掉这个匹配，短语确实在里面；唯一的修法是**先问更具体的问题**。所以修的是**顺序**，不是模式。

正因为如此，这个短语被分三次教给了这个仓库，分属三个包、三个 PR，其中两次是在别处已经踩过同一个洞之后：`@objectstack/rest` 的 `mapDataError`（#5352）、`@objectstack/service-analytics` 的缺列扣除（#6035 / PR #6346）、`@objectstack/metadata` 的 `MISSING_TABLE.excludes`（#6347 / PR #6613）。本次把它收进 `@objectstack/types`，与 `isUniqueViolationError`（#6250）和 `isModuleNotFoundError`（framework#3265）同一个理由与同一个位置。

**两种宽度，故意保留成两个导出。** 三个消费者要的并不是同一条正则，差别也不是随手写的，而是**每个站点哪个方向的误差是安全的**：

- `matchMissingColumnOfRelation(message)` —— 严格提取器，锚定 Postgres 的 errmsg 模板 `column "%s" of relation "%s" does not exist`，返回列名。`rest` 用它把 42703 答成 `400 INVALID_FIELD` 而不是 `404`；`service-analytics` 用它在分类前扣除缺列。这两处**过宽**会把真正缺失的表变成硬失败、回退 #5033 刻意保留的宽容，**漏匹配**只是让消息含糊一点——所以必须严格。
- `isRelationSubObjectPhrase(message)` —— 宽检测器，丢掉 `column` / `[a-z0-9_]+` / `does not exist` 三个锚点：任意子对象、任意带引号标识符、任意判词。`metadata` 用它做排除。这一处**过宽**只会把良性判定变成响亮判定，**漏匹配**却会让 `event_seq` 从 1 重新开始、撞进一张已有行的历史表——方向正好相反。

把两者合并成一条正则，无论哪种宽度胜出都会对其中一个调用方是错的；这是卡片记录在案的风险，两个导出即为此而设，理由是承重的而非风格的。仓库里第四份拷贝（`service-analytics` 测试内用于守护 fixture 的那条正则）同时收编：它本是为「两张面孔别对不上」而写，却把断言打在其中一面的私有复述上，因而正是它要防的漂移。

行为逐字保持不变：搬进来的两条模式与原站点逐字节相同。`@objectstack/service-analytics` 因此新增一条对 `@objectstack/types` 的依赖边——这是本次唯一的依赖变化，构造上无环（`@objectstack/types` 只依赖 `@objectstack/spec`，后者无仓内依赖），且仓库 73 个包中已有 25 个、16 个 service 中已有 5 个携带同一条边。
