---
'@objectstack/formula': minor
'@objectstack/plugin-email': minor
'@objectstack/spec': minor
'@objectstack/service-messaging': minor
'@objectstack/service-automation': minor
'@object-ui/core': minor
'@object-ui/react': minor
'@object-ui/plugin-grid': minor
---

feat(formula, plugin-email, messaging, automation, ui)!: a template `currency` hole with no argument formats in the organization's default currency, and with none the render refuses it; nothing formats in US dollars by default any more (#26939)

Clause-②: no (narrowing) — a mail send or render (`sendTemplate`, `renderTemplate`, and the messaging email and inbox channels on them), a flow text slot (notify, http, screen, end) and a templated formula evaluation refuse a `{{ amount | currency }}` hole with no argument when no default currency reaches the render, which they formatted in US dollars before. Authoring is unchanged: the hole is still accepted at save and publish. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: updated here — `content/docs/automation/email-templates.mdx`, `content/docs/automation/flows.mdx` and `content/docs/data-modeling/formulas.mdx` state the tenant default and the refusal; no skill under `skills/**` taught the dollar default (the formula skill names the formatter grammar only), so no skill line changes.

<!-- adr-0087: registered template-currency-no-argument-tenant-default -->

**BREAKING** semantic change of the `currency` formatter's no-argument form (`@objectstack/formula`), served by every template dialect: mail templates, flow text slots, and action / bulk-action confirm and success copy.

- **Before.** `{{ amount | currency }}` formatted the amount in US dollars (`$1,234.50`) whatever currency the amount was in and whatever the organization's default currency was.
- **Now.** It formats in the organization's default currency, the `localization.currency` setting (Setup → Localization) that a currency field and a dashboard measure already display in: `CN¥1,234.50` for an `en-US` reader and `¥1,234.50` for a `zh-CN` reader when the default is CNY. Every server-side read goes through `resolveLocalizationContext` (`@objectstack/core`); the UI reads `useLocalization().currency`.
- **With no default currency.** The render refuses the hole by name and names the remedy (set the default, or write `currency:CODE`). A mail send or render fails with `TEMPLATE_INVALID` and nothing is sent; a messaging delivery records it as a permanent failure. A flow node with such a hole in a text slot fails with the refusal, which no fault edge routes. An action's confirm or success sentence is shown as written, the existing fallback for a sentence the template engine refuses.
- **How each host hands the default over.** `SendTemplateInput.currency` / `RenderTemplateInput.currency` (`@objectstack/spec/contracts`), filled by the messaging email and inbox channels from the delivery's organization; `AutomationContext.currency`, seeded once at run setup from the run's tenant (`AutomationEngine.setTenantCurrencyResolver`, which the automation plugin wires), persisted with a suspended run and inherited by a subflow; `EvalContext.currency` in `@objectstack/formula`, a reserved channel like `locale`, never bound as a root; `ActionRunner.setTenantCurrency` in `@object-ui/core`, installed by the React action providers.
- **Unchanged.** `{{ amount | currency:EUR }}` formats in the code it names, with or without a default. A variable, field or root named `currency` is a value, never the default. Compile, `validateExpression` and the publish gates accept the no-argument form as before. A template with no no-argument currency hole needs no default.
- **Who sees it.** An organization with a default currency other than USD sees its own code where it saw dollars. An organization with no default currency that sends a mail, runs a flow or shows an action sentence with a no-argument `currency` hole now gets the refusal instead of dollars.

**The remedy.** None where the amount is in the organization's default currency: set it in Setup → Localization. Where the amount is in one fixed currency, name it in the hole: `{{ amount | currency:USD }}`.
