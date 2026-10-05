---
'@objectstack/platform-objects': minor
---

fix(platform-objects)!: retire the `sys_account` `link_social` action, which was dead on every boot; `unlink_account` stays

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) The withdrawn action is platform-shipped metadata on sys_account, not something an author writes: no spec key, spelling, export name or config field is retired or renamed, and nothing an author wrote needs rewriting. No stored shape carries it either: sys_account is lock full, so no sys_metadata overlay of the object can be saved, and an action is not a stored row. No reachable member of an exported type carries it, measured on the built declarations: SysAccount's declared type keeps only fields from its literal, so its action names already resolved to string, and the bundles are typed as TranslationData objects with no key types. -->

**BREAKING**: `sys_account` no longer declares the `link_social` action, so the "Link Social Account" toolbar button is gone from the Account app's Linked Accounts list and from Setup's Identity Links. It never completed a link on any boot: it navigated to a `GET` of the social sign-in route, which is served as `POST` only, and it offered a fixed list of seven providers whatever the boot had configured. It is retired under ADR-0049 (enforce or remove) and ships as `minor` under the launch-window convention for narrowings.

**What stays.** `unlink_account` is unchanged: the same type, target, placement and row-id parameter. Its confirm question no longer says the user can re-link "from their account settings", because no console surface offers that now. The `sys_account._actions.link_social` leaves are gone from the `en`, `zh-CN`, `ja-JP` and `es-ES` bundles.

**What to do after upgrading.** Linking a social or OIDC identity stays available through the signed-in `POST /api/v1/auth/link-social`, which is `auth.accounts.linkSocial({ provider, callbackURL })` in `@objectstack/client`: call it and navigate to the `url` it answers.
