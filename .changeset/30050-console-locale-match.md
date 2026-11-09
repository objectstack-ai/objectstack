---
'@object-ui/app-shell': patch
---

fix(app-shell): the console picks a signed-in user's UI language in the server's `resolveLocale` order

Clause-②: no
Metadata-protocol: none

- **Before.** `pickRenderableLocale` matched `sys_user.locale` against the offered locales exactly, then by base language only. A row stored mis-cased (`zh-cn`, written before the server door folded case and served as stored), or a tag the deployment offers only as a variant (`zh` or `zh-Hans-CN` against `zh-CN`), matched nothing, so the console rendered English.
- **Now.** It uses the order the server's i18n routes resolve with: exact, then case-insensitive, then base language, then the first offered variant of that base language. `zh-cn`, `zh` and `zh-Hans-CN` render `zh-CN`; `en-GB` renders `en`. A tag no offered locale shares a language with still matches nothing, and the device language keeps deciding, as before.
- No schema, key or server behaviour changes.
