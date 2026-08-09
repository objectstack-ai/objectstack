---
"@objectstack/rest": minor
---

feat(rest): `PUT /api/v1/meta/:type/:name` 要求 `manage_metadata` 能力 (#6603)

**这是一次访问面收紧,线上可见。** 保存单个元数据项的这条路由此前只有
`enforceAuth` —— 任何已认证会话都能写任意元数据项。现在它与隔壁的
`POST /api/v1/meta/_migrate-stored` 用同一道门、同一套机制:调用方必须持有
ADR-0066 D1 的 `manage_metadata` 能力,`isSystem` 照例放行。

## 谁开始吃 403,需要什么

**任何不持 `manage_metadata` 的已认证调用方**,对这条路由的 `PUT` 一律
403 `FORBIDDEN`(匿名调用方仍先吃 `/meta` 伞下的 401,门是第二层)。
平台自带的 `admin_full_access` 权限集本就带 `manage_metadata`,所以
Studio / Setup 里的管理员与 CLI 的 dev admin **不受影响**;受影响的是
自建集成、自建权限集,以及只持 `setup.access` 的 `organization_admin`。

**要恢复写入:给该调用方的权限集加上 `manage_metadata`**(Setup →
Permission Sets → `systemPermissions`),而不是绕过这条路由。

## 为什么必须收紧

ADR-0106 D1 会把调用方不可读的字段**整个**从服务出的对象 schema 里摘掉,
而这条路由原样持久化收到的 body。于是一次最普通的
GET → 改个 label → PUT,就把调用方**从来没被允许看见的字段删掉了**,
整个交互过程中没有任何东西提示。GET-改-PUT 正是 AI agent 编写元数据的
标准动作,原先这个动作会静默销毁它看不见的字段;现在它在写入时得到一个
**响亮的 403**。

同时这也关掉一个与掩码无关、更早就存在的洞:任何已认证会话都能覆写
任意 schema。

## 尚未关闭的部分

本次只收紧这一条路由。同形的 `PUT /meta/:type/:section/:name`(复合名)
与运行时 dispatcher 自己的 `/meta` PUT 仍无能力门,同一次往返丢失仍可经
它们复现 —— 已另立 #7019 跟踪,不在本次范围内。
