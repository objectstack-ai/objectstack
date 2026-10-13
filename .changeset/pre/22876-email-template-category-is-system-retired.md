---
'@objectstack/spec': minor
'@objectstack/plugin-email': patch
'@objectstack/platform-objects': patch
---

feat(spec)!: retire an email template's `category` and `isSystem` — the grouping and the built-in flag nothing read (#22876)

**BREAKING** — `category` and `isSystem` on an email template (`EmailTemplateDefinitionSchema`, the `email_template` metadata type) are now refused at parse. Nothing read either key once templates stopped being copied into `sys_email_template` rows: the Studio listing never offered the filter facet `category` promised, and no door refused deleting a template that set `isSystem`. Delete both keys. A template is found by its `name`, so group templates with a dotted namespace prefix (`auth.password_reset`, `crm.welcome`). A built-in template is a code package's declaration: a Studio save overrides it for the environment, and discarding that save restores the package's copy.

Clause-②: no (narrowing)

Measured before removal: no reader of either key in `@objectstack/plugin-email`, `@objectstack/service-messaging`, `@objectstack/plugin-auth`, the metadata protocol, ObjectQL, the runtime or the REST layer, and none in the Studio console at its pinned commit beyond a fallback form input, which the console's own companion change removes. Both keys carried a schema default (`category: 'custom'`, `isSystem: false`), so every parsed template carried them and the liveness advisory fired on every template, with no way for an author to clear it.

## FROM → TO

| you wrote (17.7 and earlier) | write instead |
| --- | --- |
| `category: 'auth'` (or `'notification'`, `'workflow'`, `'marketing'`, `'custom'`) | nothing — delete the key; group by the `name` prefix |
| `isSystem: true` | nothing — delete the key |
| `isSystem: false` | nothing — delete the key |
| `import { EmailTemplateDefinitionCategorySchema } from '@objectstack/spec/system'` | nothing — the enum is removed with its key |
| `type EmailTemplateDefinitionCategory` | nothing — the type is removed with its key |

**The one-line fix:** delete `category` and `isSystem` from every email template.

**What an author who still writes either sees.** `tsc` fails at the authoring site (`EmailTemplateDefinition` types both keys as retired), and the parse — `defineEmailTemplateDefinition()`, `defineStack({ emailTemplates })`, `PUT /api/v1/meta/email_template/:name` — refuses each at its own path with the prescription:

> `email_template.category` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — nothing read it: the Studio listing never offered the filter facet it promised, and delivery never depended on it. Delete the key. A template is found by its `name`, so group templates with a dotted namespace prefix instead (`auth.password_reset`, `crm.welcome`). Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.

> `email_template.isSystem` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — nothing enforced it: no door refused deleting a template that set it. Delete the key. A built-in template is a code package's declaration: a Studio save overrides it for the environment, and discarding that save restores the package's copy. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.

## The retirement kit

- **Two `retiredKey()` tombstones** on `EmailTemplateDefinitionSchema`, a `strictObject` — so the refusal carries the prescription rather than a bare unknown-key report, and `tsc` fails first. `RETIRED_KEYS_BY_MAJOR[18]`: `system/EmailTemplateDefinition:category`, `system/EmailTemplateDefinition:isSystem`. The `category` enum, `EmailTemplateDefinitionCategorySchema`, had no other consumer and leaves with it: `RETIRED_DEFS_BY_MAJOR[18]`: `system/EmailTemplateDefinitionCategory`.
- **The D2 conversion `email-template-category-is-system-removed`** (protocol 18, retired from the load path) deletes both keys from every `emailTemplates[]` entry, one notice per key, as a lossless delete. Because both keys carried a default, every built artifact and every stored `email_template` row written under 17.x carries them; both load through the rehydration seams, which replay this conversion. The retired-default residue stage is not adopted: the replayed conversion heals those populations, and an authored source that still writes either key meets the prescription.
- **The D3 entry `email-template-category-is-system-retired`** asks the author whether anything they built read either key — a report or integration that filtered templates by `category`, or one that treated `isSystem: true` as protection against deletion. Nothing ever enforced that.
- **Studio:** the email-template form drops the `category` select and the `isSystem` checkbox.
- **Ledger:** both rows stay `dead`, re-noted as tombstones (a tombstone keeps the key in the walked shape).
- **No deprecation window**, per the project's startup-stage posture.

**`@objectstack/plugin-email`:** the six built-in auth templates (in every locale) no longer write `category: 'auth'` or `isSystem: true`. They render and send exactly as before.

**`@objectstack/platform-objects`:** the metadata-form translation bundles drop the two retired form inputs' labels (`email_template.fields.category`, `email_template.fields.isSystem`). The `sys_email_template` object and its `category` / `is_system` columns are unchanged.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is published, so this is breaking for consumers no telemetry was consulted for.

<!-- adr-0087: registered email-template-category-is-system-removed, email-template-category-is-system-retired -->
