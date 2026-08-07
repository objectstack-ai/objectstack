---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): `/sso/register` 的管理员门禁改用唯一那把等级尺,不再手抄一份大小写敏感的判据 (#5942)

ADR-0024 的 `POST /sso/register` 门禁问的是「这个 membership 是不是本组织的管理员」。
它此前用的是一份手抄判据:

```ts
raw.split(',').map((s) => s.trim()).some((r) => r === 'owner' || r === 'admin')
```

同一个问题在 plugin-auth 内还有另一把尺 —— `invitation-role-cap.ts` 的等级尺
(`parseOrgRoles()` 会 `.trim().toLowerCase()`,`isOrgAdminGrade()` 据此评级),
break-glass ban 守卫(`last-admin-ban-guard.ts`,ADR-0024 D5.2)用的就是它。
两把尺在大小写上不一致:`sys_member.role` 若存成 `Owner` / `ADMIN`,ban 守卫把这一行
算作**管理员**,而 `/sso/register` 门禁算作**非管理员**。同一条安全路径上的两个答案
互相矛盾,而且两个方向的错都不出声。

现在门禁改问 `isOrgAdminGrade(m.role)` —— 「哪种 membership 算管理员」在 plugin-auth
内只剩一个答案,两处自此同尺。

**用户可见的行为变化,只有一个方向:放宽,且只放宽在此前判错的取值上。**
`sys_member.role` 为大小写非常规值(`Owner` / `ADMIN` / ` Admin `,以及
`member,Owner` 这类逗号拼写)或数组拼写(`['owner']`)的成员,此前会被
`/sso/register` **误拒**,现在正确判为管理员并放行。**没有任何收窄**:此前被判为管理员
的取值,换尺后仍然是管理员(已逐值实测,见 PR)。

ADR-0108 的封闭词表(`owner` / `admin` / `delegated_admin` / `member`)全为小写,UI 与
better-auth 写入的也是小写,所以正常部署下答案逐值不变 —— 这也是为什么它此前只是一条
静默分歧,而不是线上故障。要撞上分歧得有一条绕过表单的写入(导入、外部写入、手工 SQL)。

`isOrgOrPlatformAdmin` 名字里的 platform_admin 半边**未改动**,仍由
`packages/core/src/security/resolve-authz-context.ts` 权威推导;那几处实现的合流是
另一个决策件。
