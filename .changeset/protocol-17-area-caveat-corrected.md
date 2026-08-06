---
'@objectstack/spec': patch
---

fix(spec): protocol-17 迁移步骤的 rationale 不再声称「服务端不走 `areas`」—— 该边界已由 #4722 在同一大版本内关闭 (#5337)

`MIGRATIONS_BY_MAJOR[17].rationale` 里的 app-area 段落还带着 #4651 退役当时写下的
caveat:

> per-item gating INSIDE an area is enforced by the shell only, since the server
> does not walk `areas`, so anything that must never reach the browser belongs in
> the top-level tree or in its own app.

**#4722 之后这句已不成立**,而且它是以现在时写给读者的操作建议。`filterAppForUser`
现在对每一棵 `areas[].navigation` 跑同一个 `filterNav`(`packages/rest/src/rest-server.ts`),
导航**项**的 `requiredPermissions` / `requiresService` 在两棵树被同等强制、被门禁掉的条目
根本不会出现在 `/meta` 响应体里。

这段 prose 不是注释:`docs/protocol-upgrade-guide.md` 是它的纯投影(ADR-0087 D4,
`gen:upgrade-guide`),也就是**正在从 16 升到 17 的作者**读的那一页。原句会劝他为一个如今
可以就地写下的门禁去重构整棵导航树。#4722 与 #4651 落在同一个 17.0.0 窗口内,所以读这份
指南的人所处的世界已经是「服务端走两棵树」。

改后措辞与 PR #5336 落地的 schema 侧处方(`AREA_VISIBLE_RETIRED` /
`AREA_REQUIRED_PERMISSIONS_RETIRED`)、以及 `packages/spec/liveness/app.json` 的
`areas.navigation` 记录一致:

- **保留历史**:退役当时的状态叙述(为什么选 route B 而非 route A)原样保留,只是把时态
  锚在「At the time of the retirement」,免得历史被读成现状;
- **点名 #4722**:命名两棵树、命名 `areas[].navigation`;
- ⛔ **不复活 area 级键**:`app.areas[].visible` / `app.areas[].requiredPermissions`
  依然退役,#4722 强制的是 area **内部的项**,area 自身没有门;
- ⛔ **不带歪 `visible` 的口径**:`visible`(CEL)与 `requiresObject` 在**每一层**仍然只在
  客户端求值 —— 服务端 CEL 需要一个读取层没有的 `user` 绑定 —— 所以绝不可到达浏览器的东西
  写在 `requiredPermissions`,永远不要写在 `visible`。

未发布的 `.changeset/app-area-fail-open-gates-removed.md` 里同一句一并订正(仓库处于
changesets pre 模式,该文件仍是 v17 GA 发布说明的法定输入)。`docs/protocol-upgrade-guide.md`
由 `gen:upgrade-guide` 重新生成,未手改。
