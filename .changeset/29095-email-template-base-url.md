---
'@objectstack/plugin-email': patch
---

feat(plugin-email): every email template can read the deployment's address as `{{baseUrl}}`

Clause-②: yes (widening)
Metadata-protocol: none

The default template context gains a fixed `baseUrl` key beside `appName`, so a template can write an absolute link to a record or an app route: `{{baseUrl}}/crm_deal/{{deal.id}}`. It is resolved by the chain `os serve` uses for the deployment's address, env first: `OS_AUTH_URL` (or its legacy `BETTER_AUTH_URL`), then `OS_BASE_URL`, then `config.email.defaultTemplateContext.baseUrl`, then `http://localhost:<port>` (`OS_PORT`, `PORT`, `3000`). It never ends in a slash. A send that passes its own `baseUrl` in `data` still wins.

No new config key and no spec change: the template context stays a free-form record. In `bodyHtml` the prefix may sit in element text but not inside an `href` (the hole-placement rule refuses that); pass a whole URL as a `type: 'url'` variable for an `<a>` link.
