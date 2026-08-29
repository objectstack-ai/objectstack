---
"@objectstack/plugin-security": minor
---

feat(plugin-security): the verified platform OWNER bypasses the Layer 0 org wall (#12974)

Maintainer ruling 2026-08-29, verbatim and untranslated: 「能不能简单点，对于超级管理员，
配置了环境变量邮箱的，在执行墙的时候不要强制加上 org_id 的过滤」

When plugin-security arms the Layer 0 organization wall, the `org_id` tenant
filter is no longer appended for a session whose account is the **verified
platform owner** — the `OS_PLATFORM_OWNER_EMAIL` identity, matched under the
existing #11343 verified-email predicate (the SAME comparison the
platform-admin elevation gate makes, now shared through
`platform-owner-wall-bypass.ts`; server-side `sys_user` row facts only, never
a client-supplied claim). This unblocks the one account meant to be
all-seeing: metadata-driven operator screens over PUBLIC tenant objects no
longer read EMPTY for the deployment's declared owner (the cloud#1676 shape).

Fail-closed in every direction, pinned: env unset ⇒ nobody bypasses (the wall
arms exactly as before, with no row I/O); email mismatch ⇒ walled; email
matches but the account is NOT verified ⇒ walled; only a verified match lifts
the filter. The bypass lifts ONLY Layer 0 — object/field permissions,
business RLS (Layer 1) and the write `check` path are untouched — and the
door serves the single env-declared owner (no lists, no patterns). Every
wall-bypassing computation emits a structured warn-level audit event with the
stable name `platform_owner_wall_bypass` (object, operation, userId,
suppressed filter).
