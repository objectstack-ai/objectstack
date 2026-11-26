---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

fix(plugin-chatbot): the AI quota notice offers an upgrade only when the refusal names one

Clause-②: no
Metadata-protocol: none

- The composer's AI quota notice and the confirm card's blocked state now read the 429's `upgrade` / `topUp` flags. `upgrade: true` keeps the "Upgrade needed" title and the "Upgrade plan" action; `topUp: true` shows a neutral "AI limit reached" title and the "Buy a credit pack" action; a refusal with neither (a paid plan's five-hour limit, a developer organization) shows "AI limit reached", the server's sentence about when it frees up, and no action. Before, every refusal was titled "Upgrade needed" and offered "Upgrade plan" unless `topUp` was set, so a paying team at its five-hour limit was told to upgrade.
- New locale key `chatbotQuota.limitTitle` in every `@object-ui/i18n` locale.
