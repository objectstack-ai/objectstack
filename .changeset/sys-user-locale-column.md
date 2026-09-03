---
"@objectstack/platform-objects": minor
"@objectstack/plugin-auth": patch
---

feat(platform-objects): `sys_user.locale` — the user's own notification language as a first-class column (#13881)

Maintainer ruling 2026-09-01, quoted verbatim and untranslated:

> **A**:`sys_user` 加 `locale` 一等列(用户语言是主流平台的一等用户属性;B 的 preference 袋会把一等概念藏进键值对并孕育第二种拼法,排除)

`sys_user` gains `locale` — a BCP-47 tag (`zh-CN`, `ja-JP`), optional, in the
Profile group. The 2026-08-13 ruling had deferred it "until measured pull";
hotcrm measured the pull (4 published languages × 16 notify nodes × 0
localizable, two independent lanes agreeing), so the deferral lifted on its own
terms. The preference-bag alternative (`sys_user_preference`) was rejected by
the ruling and nothing reads it as a fallback.

The column is owned by objectql exactly like `ai_access`: better-auth is
oblivious to it, and it is deliberately NOT declared as a better-auth
`additionalFields` entry — better-auth SELECTs explicit columns, so declaring
it there would make `getSession` query a column an environment that has not
yet run schema-sync does not have. Boot schema-sync (additive) provisions it.
plugin-auth registers it in `MANAGED_EXTENSION_FIELDS.sys_user`, whose ADR-0105
D7 collision guard proves better-auth's own user schema owns no `locale` at
the pinned version.

Who may write it is unchanged: the column is `readonly` on the object (ADR-0092
D4, so the standard edit form does not advertise a write the runtime refuses)
and is NOT added to `MANAGED_EXTENSION_EDITABLE_FIELDS` or to the ADR-0092 D2
self-service whitelist (`{name, image}`). Widening that whitelist so a user can
set their own language is a security-boundary decision recorded on #13881, not
made here; until then the column is written only by system-context callers (no
admin surface writes it today).

Who reads it: the messaging channels, per recipient, after fan-out — see the
`@objectstack/service-messaging` changeset in the same release.
