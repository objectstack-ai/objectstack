---
"@objectstack/plugin-audit": minor
---

`AuditPluginOptions` gains `getLocale`, an optional host locale resolver asked before the settings-derived locale, so a multi-organization host can write each organization's activity summaries in its language

Clause-②: yes (widening)

- **The option.** `new AuditPlugin({ getLocale })`, where `getLocale` is `(tenantId?: string, userId?: string) => string | undefined | Promise<string | undefined>`. It picks the language of `sys_activity.summary` and of the @mention notification title the plugin emits, and is called with the write's organization and user (for an @mention title, the mentioned recipient).
- **Precedence: host first, settings second.** An answer that is a well-formed BCP-47 tag is used, in its canonical form (`zh-cn` → `zh-CN`). `undefined`, `null` or a blank string falls back to the settings-derived `localization.locale` (ADR-0053) the plugin used before this option. So do a malformed answer (`zh_CN`, a non-string) and a throw or rejected promise; each of those two faults is logged once at `warn`, and neither fails the audited write. There is no other locale source.
- **Without the option, nothing changes.** The settings-derived locale stays the only source, as before.
- The locale only picks the message catalog, and a summary is rendered once, when its row is written. Rows already written keep their text.
