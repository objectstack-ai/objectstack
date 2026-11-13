---
'@object-ui/i18n': patch
---

fix(i18n): the Connect page says an AI assistant connected with an API key works with records and actions only and cannot build apps

Clause-②: no
Metadata-protocol: none

The API-keys section of the Connect page (`connectAgent.apiKey.body`) and the four client hints that fall back to an API key when a client offers no browser sign-in (`connectAgent.codex.hint`, `connectAgent.workbuddy.hint`, `connectAgent.doubao.hint`, `connectAgent.qwenwork.hint`) now say, in all eleven platform locales, that an assistant connected with a key works with records and actions only and cannot build apps. That is what the server does: an API key's grant never admits the authoring tools, on every deployment. The copy promises building nowhere, so it stays true on a deployment that mounts no build door. Only values of existing keys change; zh-Hant is regenerated from zh-Hans.
