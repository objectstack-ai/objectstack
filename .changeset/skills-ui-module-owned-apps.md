---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui teaches at most one app per package, and that a module package may carry its own app

Clause-②: no
Metadata-protocol: none

`objectstack-ui` `SKILL.md` § App Navigation no longer says more audiences are "never a second app". It now states the rule of ADR-0019 (app-as-consumer-unit) D3 as amended: at most one app per package, and `defineStack` refuses a second app in a `type: 'app'` package. A suite (an app package plus its modules) may surface more than one app: a `type: 'module'` package may carry its own app, which is served under the module's package id and is gone when the module is disabled. Audiences that share one product and its objects stay `requiredPermissions`-gated groups inside one app. The `objectstack-ui` eval about a second app for the support team now grades that rule.

The new text is paid for inside `SKILL.md` by deleting asides that carried no rule: the brand comparison in the line-item grid paragraph, the lead-in sentence above the CRM UI Blueprint table, and two parenthetical notes in the `position` pitfall.
