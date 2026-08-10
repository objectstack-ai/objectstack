---
'@objectstack/platform-objects': patch
---

Translate the Setup app's `nav_sso_providers` navigation entry in all four
locales.

`@objectstack/plugin-auth` contributes an **SSO Providers** entry into Setup's
Access Control group (`sys_sso_provider`, priority 250), but no locale bundle
carried a label for it: measured on `origin/main` `ea1d9165d`, a grep for
`nav_sso_providers` over `en` / `zh-CN` / `ja-JP` / `es-ES` returned **0 each**,
against a control probe (`nav_positions`) that returned 1 each. A deployment
with an external IdP wired therefore rendered `SSO Providers` in English inside
an otherwise fully translated Setup menu.

| locale | label |
| --- | --- |
| `en` | SSO Providers |
| `zh-CN` | SSO 提供方 |
| `ja-JP` | SSO プロバイダー |
| `es-ES` | Proveedores SSO |

Each one matches that locale's existing `sys_sso_provider.pluralLabel`, since
the nav entry opens exactly that object's list view.

**Why no gate caught it.** `pnpm check:app-nav-i18n` (#5750) boots the real
composition and asserts every *merged* Setup nav id carries a label in every
locale — and `plugin-auth` spreads its `navigationContributions` in only when
`authManager.isSsoWired()` is true. In the composition that gate boots, this
entry is never contributed, never merged, and so never judged; the gate's header
already declared that bound. This id is consequently the one Setup entry no
boot-time check can reach, so it is pinned by hand instead, next to the dead-key
tombstone (#6660) it is the converse of: one list holds ids whose label must be
**gone**, the other ids whose label must **stay**. Making the gate itself
union-aware was considered and deliberately left unbuilt — a separate
maintainer-facing call, not a prerequisite for labelling the ids it cannot see.
