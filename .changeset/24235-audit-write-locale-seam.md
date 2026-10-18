---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): an activity summary written right after a workspace language change is stored in the new language, not the old one

Clause-②: no (no export, option key, signature or schema changes; the held write locale is retired sooner, and the option docs say when)

- **What was wrong.** The audit writer held the write locale for each tenant/user scope for 30 seconds, and nothing retired it when the `localization.locale` setting changed. A `sys_activity.summary` line is stored once, at write time, so every audited write in that window (a user's create, a seed publish) kept the old language for good.
- **What changes.** A write to `sys_setting` or `sys_platform_setting` through the engine now retires every held write locale. That covers a change made through the settings API, which persists through the engine, and a direct row write such as a seeder's, which emits no settings event. These are the same writes that retire `resolveLocalizationContext`'s own cache. A lookup still in flight when such a write lands is not held. The 30-second bound stays for what the writer cannot see: the storage behind a host `getLocale` resolver, and a settings write on another node.
- **Unchanged:** the host `getLocale` resolver is still asked first, and a write with no settings change between it and the last one is still answered from the held locale, without a settings read.
