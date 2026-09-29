---
'@objectstack/plugin-webhooks': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-security': patch
---

fix(plugin-webhooks,plugin-audit,plugin-security): the ja-JP, es-ES and zh-CN object help, descriptions and labels that contradicted their current English source are re-translated (#20653)

Clause-②: no

A translated object leaf that a translator wrote by hand is kept as written
when its English source changes later, so some leaves went on saying what the
old source said. On a ja-JP, es-ES or zh-CN console the `sys_webhook` record
page told an admin that `definition_json` carries the full headers / auth /
retry / payload configuration, where the English help says credentials are not
stored there: the signing secret and the custom headers live in the encrypted
`signing_secret` and `headers_secret` fields.

Eighteen leaves (six paths, in all three locales) whose meaning contradicted
the current English now match it:

- `@objectstack/plugin-webhooks`: the `sys_webhook.definition_json` help (no
  credentials in the JSON) and the `sys_webhook` description (dispatched by the
  webhook auto-enqueuer onto the shared HTTP outbox, not executed by an HTTP
  connector plugin; declared through `defineStack({ webhooks })` too);
- `@objectstack/plugin-audit`: the `sys_activity.environment_id` label and help
  (Environment, not Project), and the `sys_audit_log.user_id` label (User: the
  object's separate `actor` field is the actor);
- `@objectstack/plugin-security`: the `sys_position` description (positions
  distribute capability, not definitions for RBAC access control).

Leaves whose English source only gained detail, was reworded, or was
title-cased (the `@objectstack/plugin-approvals` status and action options)
are unchanged. Values only: no key is added or removed, and no provenance
table changes.
