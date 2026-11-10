---
'@objectstack/objectql': minor
'@objectstack/core': minor
'@objectstack/metadata-protocol': patch
'@objectstack/plugin-email': patch
---

feat(objectql)!: two packages of two namespaces may each ship an email template of the same name, and `?package=` reads an email template exactly (ADR-0150 child B)

Clause-②: yes (narrowing) — `GET /meta/email_template/NAME?package=X` (and `getMetaItem` with a `packageId`) for a name package X does not hold is refused `409 RESOURCE_CONFLICT` (`not-held-by-qualifier`, naming every holder), where it served the first registered package's template; first-party callers that name a package: 0 (the send reads with no package). Widened beside it: the engine's package door (`SchemaRegistry.installPackage`), its item seam (`SchemaRegistry.registerItem`) and the cold boot's holder seal (`SchemaRegistry.sealBareNameHolders`) accept, for an email template, a second package holder they refused before: one that declares a namespace other than the holder's.
Metadata-protocol: added

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is which email template a by-name read naming a package answers, and which second package an install admits; the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a caller of `GET /meta/email_template/NAME?package=X` (or `/meta/email_template/NS/NAME`) whose package X does not hold the template: it now answers `409 RESOURCE_CONFLICT` naming the holders instead of another package's template. Name the package that holds it, or read with no package. Nothing in the workspace reads an email template that way: the send (`IEmailService.sendTemplate` / `renderTemplate`) reads with no package, and the Studio reads of a pair and of a dependent's added locale (#28802, #28830) keep their answers.

The bare-name one-holder rule (`bare-name-one-holder.ts`) has narrowed for `email_template` from one package holder per deployment to one per namespace (ADR-0150 D2, D9). Its by-name readers answer by `(package, name)`: `GET /meta/email_template/NAME` refuses `409 RESOURCE_CONFLICT` naming every holder when two packages hold the name, at every locale; `?package=ID` and `GET /meta/email_template/NS/NAME` serve that package's own; and a send of the name (`IEmailService.sendTemplate` / `renderTemplate`) refuses `409` naming both, never the first registered. So a package no longer has to rename an email template because a package of another namespace already ships one of that name.

Unchanged, and still refused with the same `422 NAMESPACE_CONFLICT` envelope and sentence:

- a second package of the SAME namespace (a co-owner) holding the name (at `install-local`, a co-owner depends on the holder, so the ADR-0146 D2 override write gate refuses it first, `403 NOT_OVERRIDABLE`, as before);
- a package that declares no namespace, beside any other holder of the name, and any holder beside it;
- two packages of one shareable namespace (`base`, `system`, `sys`) holding the name;
- a built-in name;
- the eight platform-requested `auth.*` templates the authentication plugin sends with no package (`auth.password_reset`, `auth.verify_email`, `auth.magic_link`, `auth.invitation`, `auth.account_invitation`, `auth.two_factor_otp`, `auth.email_change_notice`, `auth.existing_account_sign_up`). They join core's `PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE`, so they resolve environment-wide and keep one overriding package per deployment: an app may still override the built-in, and a second app's override is refused naming the first.

A package that ships only locales its base does not ship (an addition to the base's template) is still judged against the base whatever the namespaces, and refused naming it, as before. A dependent's locale authored in Studio stays under the dependent: the exact qualifier (`?package=ID`) now reads it, and a customization pair's added locale on its base's address, as that package's own (`@objectstack/metadata-protocol`).

Every other covered type still on one package holder per deployment (flow, action, webhook, connector, and the rest) keeps it. The webhook and connector halves of this child follow in their own changes.
