---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): break-glass 守卫扩到 `sys_permission_set`,并把「零管理员」从引导期豁免里分辨出来 (#6084)

break-glass 不变量(cloud ADR-0024 D5.2)此前守三张表:`sys_user`(ban/删行,#5892/#5941)与
`sys_member`/`sys_user_permission_set`(撤销 standing,#5978)。**第四条写法绕开全部三条**:
「谁是 platform admin」是**按名字**解析的——`resolveAdminUserIds` 先
`where: { name: 'admin_full_access' }` 取那条 `sys_permission_set` 行,再去读指向它 id 的授权行。
删掉那一行、或把它改个名字,授权行、`sys_user` 行、`sys_member` 行**一个都没动**,而所有
platform admin 同时不再是管理员。

## 放大缺陷:这一条写法还会顺手关掉守卫本身

两个判据都以「这个环境有管理员吗?没有就放行」开场——引导期本就没有 break-glass 账号可保护,
在那个窗口里拒绝一切身份写会是守卫拿一个空测量值自造政策。可是 `admin_full_access` 行没了的环境
**读起来正是零管理员**,于是豁免生效,ban / 删用户 / 降级 / 撤授权**一并放行**。所以这一条写法
不只是锁死环境,还在锁死的路上把 #5892 / #5941 / #5978 三条守卫一起解除。

## 两处改动

**① 同形状扩到第四张表。** `sys_permission_set` 的 `beforeUpdate` + `beforeDelete`,复用 #5978 的
`enforceStanding` / `applyPending`,`PendingStandingWrite` 多认一张表;枚举的第一段 scan 现在也对
pending 做模拟并**重测 `name`**——与 grant 半边重测 `permission_set_id` 同理,scan 自己的 `where`
只证明了写**之前**那行叫什么。静态跳过键只有 `name` 一个:枚举只读这一列,所以每一次 projection
回填、每一次 `os meta resync`、每一次 Setup 里编辑权限集(写的是 `label`/`description`/权限 JSON)
一次读都不花。数据门自己已经拒绝改名(ADR-0094),这道守卫覆盖的是不经数据门的引擎级与
system-context 写。

**② 收紧引导期豁免。** 「零管理员」拆成它本来混在一起的两种状态:

- **真引导期**——没有任何证据说这里曾经有过 platform admin。照旧放行。
- **刚被清空**——仍存在无组织范围、有效期内的 `sys_user_permission_set` 授权行,而它指向的
  `sys_permission_set` 行已经不在了。fail-closed 拒写,并在报文里点名那些悬空授权行。

判据选的是**悬空授权行**,因为它在正常路径上根本写不出来:每一个生产者都先插权限集、再读回 id 写
授权行(`bootstrapPlatformAdmin` 第 1 步 seed 权限集、第 2 步才提拔第一个用户,权限集缺席时返回
`admin_permission_set_missing` 而不是发授权),所以**全新环境的可写性按构造不变**——测试里有一条
「真引导期照常放行」的钉专门量这一点。改名不留下悬空授权行,这条判据看不见它;那条路径改由 ① 在
写入处拦下,残留因此只剩一种状态:守卫尚未注册时落下的改名。曾考虑把判据放宽成「不存在
`admin_full_access` 行 且 存在无组织范围授权行」,被否掉——它会改变「seed 顺序先写授权行」的全新
环境的答案,而不改变全新环境的答案正是这条判据唯一不能碰的红线。

`sys_permission_set` 的拒绝报文结尾不走 SCIM 那句:IdP 不写这张表,写它的是元数据删除、
`os meta` 与包卸载,报文点名的是这些门。
