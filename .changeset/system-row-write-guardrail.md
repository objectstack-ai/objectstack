---
'@objectstack/plugin-security': patch
---

内置行写护栏：`sys_position` / `sys_capability` 的平台/应用托管行不再可被客户管理员删改。

`sys_permission_set` 早有两道门写护栏（`assertPackageManagedWriteGate`）拦截对 package 托管行的写入，但 `sys_position` / `sys_capability` 缺失对应保护——平台/应用发布的系统岗位与能力（provenance 记录在 `managed_by`）可被管理员直接 delete / update 直达驱动，静默破坏应用的授权基线（ADR-0049：provenance 字段存在却无强制 = 正是要补的 enforcement gap）。

新增 **`assertSystemRowWriteGate`**（`packages/plugins/plugin-security/src/security-plugin.ts`，data-write hook 接线与 package 门同处），对这两个对象的托管行施加一道无条件的数据层边界：

- **禁止伪造托管来源**：管理员门的 insert / update 载荷（单对象或数组）不得把 `managed_by` 盖成平台/应用值——只有携带 `isSystem` 的平台 seeder / 包发布路径可写；同时封堵 update-to-forge（把自建行改badge成托管行）。
- **拒绝改删托管行**：对 `managed_by` 已是平台/应用值的行，`delete` / `update` / `transfer` / `restore` / `purge` 一律拒绝。与 `sys_permission_set` 不同，这两个对象没有 ADR-0094 overlay write-through，故写护栏必须在此层直接拒绝，而非下放给下游翻译。
- **管理员自建行不受限**：`managed_by` 为 `user`/∅（sys_position）或 `admin`（sys_capability）的行完全归管理员所有（含委派管理员在自己 subtree 内的自建行）。

护栏 fail-closed 且不依赖调用方授权——持 `modifyAllRecords` 的超管也无法删除平台岗位。两对象的 `managed_by` 词表不同（sys_position：`system`/`config` 托管，`user`/∅ 自建；sys_capability：`platform`/`package` 托管，`admin` 自建），网关按对象分别判定。错误信息仅含业务文案（"此岗位/能力由 平台|应用包 提供，不可删除/修改"）。

与 delegated-admin 边界不冲突：`GOVERNED_OBJECTS` 本就不含这两个对象，委派管理仍治理 RBAC 链接表而非定义对象。
