---
'@objectstack/platform-objects': patch
'@objectstack/lint': patch
---

fix: the Business Unit page and the `security-private-no-readscope` hint say what needs the enterprise edition

Clause-②: no
Metadata-protocol: none

- **Business Unit page (`sys_business_unit` description, en and zh-CN).** It used to say units are "used to scope data and reports". It now says what a unit does in the open edition: sharing rules can share records with a unit, or a unit and the units under it, and members get that access and lose it when they leave. It also says that letting a permission set read every record of a unit (read scope `unit`) needs the enterprise edition. That matches the compile refusal, which is unchanged.
- **Business unit Timezone help (en and zh-CN).** It used to say date boundaries are computed in this zone. Nothing reads the column, so the help now says it changes no date calculation and that Settings → Localization → Default timezone is the one in effect, as the organization's Timezone help already does.
- **`security-private-no-readscope` hint (`os validate`, `os lint`).** The hint now offers only the scopes the stack can compile. When `requires` lists `hierarchy-security`, nothing changes: it offers `own_and_reports`, `unit`, `unit_and_below` and `org`. Without it, the hint offers `org` (or widening the object's `sharingModel`), and says that the three hierarchy scopes need `requires: ['hierarchy-security']`, which `@objectstack/security-enterprise` provides. The rule still fires on the same grants at the same severity.
