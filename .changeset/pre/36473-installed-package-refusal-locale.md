---
'@objectstack/cloud-connection': patch
'@objectstack/runtime': patch
---

fix(cloud-connection): an installed package answers its declared hook and action refusals in the caller's language

Clause-②: no
Metadata-protocol: none

A package installed into an environment (`POST /api/v1/marketplace/install-local`, and the same package bound again when the server restarts) now answers its declared hook and action refusals (`refusals`, with `reasons` and `params`) in the caller's language, from the translations the package ships under `hooks.HOOK.refusals.CODE[.reasons.REASON].message` and `objects.OBJECT._actions.ACTION.refusals.CODE[.reasons.REASON].message`. A `zh-Hans` caller reads the `zh-CN` pack, as on a boot. Before, the install door bound the package's body hooks and script actions without the `i18n` service, so every caller read the declared sentence on every door that runs them (`POST /api/v1/batch`, a record update, an action), while the same package booted as an app (`objectstack dev`, `objectstack start`) answered in the caller's language. The refusal body, its code and its status do not change.

The same binding now also hands an installed package's bodies the kernel's services, as a boot does: `ctx.text` answers in the organization's language, and `ctx.email.send` and `ctx.activity.append` reach the email and audit services.

`@objectstack/runtime` exports `hookRefusalI18nReader`, the `i18n` reader both binder doors pass to `bindAppArtifactHandlers`.
