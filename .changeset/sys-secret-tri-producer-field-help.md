---
"@objectstack/platform-objects": patch
---

fix(platform-objects): `sys_secret` field help stops asserting the settings-only reading (#12550)

`sys_secret` has **three** privileged producers (#4270) — the object's own
`managedBy` note has said so for a while — but its most load-bearing field
descriptions still described a settings-only table. Those strings are not
internal comments: they are the field help an operator reads in the
`sys_secret` grid, and they compile into the shipped translation bundles.

Measured on `origin/main@f93df4db`, by producer symbol rather than by line:

| producer | `namespace` | `key` | the reference lives at |
|---|---|---|---|
| `SettingsService` (`settings-service.ts`, `secretStore.insert`) | settings namespace | specifier key | `sys_setting.value_enc` |
| engine `encryptSecretFields` (`objectql/src/engine.ts`) | **object name** | **field name** | a `secret:<id>` ref on the business row itself |
| datasource credential binder (`datasource-secret-binder.ts`) | **caller-supplied**, default `datasource` | datasource name | the artefact's `sys_secret:<id>` credentialsRef |

So `'Settings namespace this secret belongs to.'` / `'Specifier key within the
namespace.'` / `'Opaque handle referenced by sys_setting.value_enc.'` were each
true of one producer out of three, and the pair they describe was presented as
if it identified an owner. That is exactly the `(namespace, key)` attribution
reading #8103's re-measurement rejected — the reason
`sys-secret-orphan-report.ts` reports a row it cannot attribute as
`'unattributable'` rather than `'orphaned'`. Field help asserting the rejected
reading is the safety-relevant direction of this drift.

Corrected here: the object description, and the `namespace` / `key` / `id`
field descriptions, now name the producer-scoped reality and point at
`managedBy`. The `en` bundle was regenerated with the repo's own
`pnpm i18n:extract`; the three translated locales carried translations of the
superseded English, so their four affected leaves were re-translated by hand —
the action `<locale>.objects.generated.ts`'s own header prescribes when a
source string changes — and the bundles plus their `--source-hashes`
companions then come from one extract run.

Text only. No field is added, removed, renamed or re-typed; no validation,
persistence or access rule moves; every `sys_secret` payload that parsed before
parses identically. ⛔ A producer/owner column stays out of scope — that is a
persist-path change and belongs to whoever takes that decision.
