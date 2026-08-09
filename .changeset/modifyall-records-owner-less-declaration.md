---
"@objectstack/spec": patch
---

fix(spec): `modifyAllRecords` 的声明不再承诺它在无 owner 字段对象上做不到的 bypass(#6698)

`ObjectPermissionSchema.modifyAllRecords` 的 `.describe()` 此前只写
`Modify All Data (Bypass Sharing)`,旁边的文档注释更进一步宣称它
"Bypasses Sharing Rules and Ownership checks"。在**没有 owner 字段**的对象上,
两样都不成立:记录共享在这类对象上根本不参与判定 —— `checkEdit` / `checkDelete`
在探测 bypass 之前就返回 `abstain`(#6428 的三态),于是平台自己的行级写入底线
`created_by == current_user.id`(#1985 的 `owner_only_writes` /
`owner_only_deletes` 通配策略)继续生效,按 id 写别人创建的行仍然被 403 拒绝。
这一格是 #6684 明确测量并钉住的既定行为(plugin-security 的
`row-write-widener-composition.test.ts`),不是缺陷 —— 缺陷在于声明比实现讲得多,
正是 ADR-0049 `declared ≠ enforced` 那一类残留。

这次改的只有**声明**:describe 把 bypass 限定在"记录共享真正参与判定的对象"上,
并披露 owner-less 对象上仍然生效的平台 `created_by` 写入底线。带 owner 字段的
对象 —— 也就是授予这个位的常见场景 —— bypass 依旧是真的,措辞刻意保留了这一半,
以免矫枉过正成相反的谎;新增的 pin 对两半都会变红。

**没有任何运行时行为变化**,合法元数据集合逐字节不变(只有描述字符串变了),
`plugin-sharing` / `plugin-security` 一个文件都没有碰。生成的
`content/docs/references/security/permission.mdx` 随之重算。
