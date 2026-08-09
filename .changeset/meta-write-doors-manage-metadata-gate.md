---
"@objectstack/rest": minor
"@objectstack/runtime": minor
---

feat(rest,runtime): 元数据写入的其余三扇门同样要求 `manage_metadata` 能力 (#7019)

**这是一次访问面收紧,线上可见。** #6603 只给 `PUT /api/v1/meta/:type/:name`
一条路由落了 `manage_metadata` 门,而同一个写操作还有另外三扇门没有门。本次
把它们补齐,用的是**同一道门、同一套机制**(各自照抄所在文件的既有先例):

- `PUT /api/v1/meta/:type/:section/:name` —— 复合名保存(`@objectstack/rest`);
- `DELETE /api/v1/meta/:type/:name` —— 重置为构件默认值(`@objectstack/rest`);
- 运行时 dispatcher 自己的 `/meta` PUT —— 同一操作的**第二条传输**(`@objectstack/runtime`)。

## 谁开始吃 403,需要什么

**任何不持 `manage_metadata` 的已认证调用方**,对上述三条路径的写入一律 403
(匿名调用方仍先吃 `/meta` 伞下的 401,能力门是第二层)。`isSystem`(引擎自调)
照例放行。平台自带的 `admin_full_access` 权限集本就带 `manage_metadata`,所以
Studio / Setup 里的管理员与 CLI 的 dev admin **不受影响**;受影响的是自建集成、
自建权限集,以及只持 `setup.access` 的 `organization_admin`。

**要恢复写入:给该调用方的权限集加上 `manage_metadata`**(Setup →
Permission Sets → `systemPermissions`),而不是绕过这些路由。

## 为什么必须收紧

两条**各自独立成立**的理由:

1. **ADR-0106 的读写不对称。** D1 会把调用方不可读的字段**整个**从服务出的对象
   schema 里摘掉,而这些路由原样持久化收到的 body。#6603 落地后**实测**:同一次
   GET → 改个 label → PUT 的字段丢失,经复合名这扇门可原样复现 —— 缺陷没有被修复,
   只是换了一扇门。本次复测的前后对照:

   ```
   加门前: compound PUT status : 200 | saveMetaItem calls : 1 | STORE after PUT : id, name
   加门后: compound PUT status : 403 | saveMetaItem calls : 0 | STORE after PUT : bonus_formula, id, name, salary_grade
   ```

2. **一个与掩码无关、更早就存在的洞:** 任何已认证会话都能覆写(或重置)任意
   元数据项。`DELETE` 这条尤其是这个理由而**不是**掩码理由 —— 它不往返、不掩码,
   只是把定制覆盖层整个丢掉,`?dropStorage=true` 还会连对象的物理表一起拆掉。

三处门都落在解析 protocol **之前**,所以未授权调用方无法用 501-vs-200 指纹探测
内核能力,且拒绝时**什么都没写、什么都没删**。

## 不在本次范围

只收紧写入面;读路径的姿态(ADR-0106 掩码)不变。#7020 记录的「门要求的能力集
与 D4 掩码豁免集不是同一个集合」仍然成立,本次不替维护者选对齐方向。
