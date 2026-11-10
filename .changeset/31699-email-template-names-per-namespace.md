---
'@objectstack/objectql': minor
'@objectstack/core': minor
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/plugin-email': minor
'@objectstack/service-automation': minor
'@objectstack/service-messaging': minor
'@objectstack/cli': minor
---

feat(objectql)!: two packages of two namespaces may each ship an email template of the same name, a send resolves the name from the package it is made from, and `?package=` reads an email template exactly (ADR-0150 child B)

Clause-②: yes (narrowing) — three refusals where a template was served before. (1) `GET /meta/email_template/NAME?package=X` (and `getMetaItem` with a `packageId`) for a name package X does not hold is refused `409 RESOURCE_CONFLICT` (`not-held-by-qualifier`, naming every holder), where it served the first registered package's template; first-party callers that name a package: 0. (2) The bare `GET /meta/email_template/NAME` of a name two packages already held before the one-holder rule (a clash the cold boot seals with a warning) is refused `409` naming both, where it served the first registered one (ADR-0150, covered types). (3) A flow's `notify` node now sends its template as the flow's own package (`SendTemplateInput.callerPackageId`): from a package whose own flow body is armed, a template name no holder in that package's declared dependency closure holds (another package's template outside it, or a template only the environment authored) is refused `409` naming the holders, where the send served the one holder; first-party packaged flows that send a template: 0. Widened beside it: the engine's package door (`SchemaRegistry.installPackage`), its item seam (`SchemaRegistry.registerItem`) and the cold boot's holder seal (`SchemaRegistry.sealBareNameHolders`) accept, for an email template, a second package holder they refused before: one that declares a namespace other than the holder's.
Metadata-protocol: added

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is which email template a by-name read or a send answers, and which second package an install admits; the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for three callers. A caller of `GET /meta/email_template/NAME?package=X` (or `/meta/email_template/NS/NAME`) whose package X does not hold the template now answers `409 RESOURCE_CONFLICT` naming the holders instead of another package's template: name the package that holds it, or read with no package. A deployment that already held one template name under two packages reads `409` naming both on the bare address: read each by its package. A packaged flow whose `notify` template is held only outside its package's declared dependencies (or only in the environment) now fails its delivery with `409` naming the holders: declare a dependency on the package that ships the template (ADR-0141), or ship the template in the flow's package. Nothing in the workspace is in any of the three positions.

The bare-name one-holder rule (`bare-name-one-holder.ts`) has narrowed for `email_template` from one package holder per deployment to one per namespace (ADR-0150 D2, D9). Its readers answer by `(package, name)`:

- `GET /meta/email_template/NAME` refuses `409 RESOURCE_CONFLICT` naming every holder when two packages hold the name, at every locale; `?package=ID` and `GET /meta/email_template/NS/NAME` serve that package's own.
- A send (`IEmailService.sendTemplate` / `renderTemplate`) resolves the name from `callerPackageId`, a new optional member of `SendTemplateInput` and `RenderTemplateInput` (`@objectstack/spec`): that package's own template, else the one holder in its declared dependency closure, else `409` naming every candidate. A name two packages hold is then read at the resolved holder's own address only (its members, its pair's added members, its environment overlay), never mixed with the other holder's. A send that names no package keeps the bare-name meaning: the environment's own template, else the one package holder, else `409` naming every holder. The eight platform-requested `auth.*` mails resolve environment-wide whatever is passed.
- The flow `notify` node records the package whose own flow body is armed (`AutomationEngine.flowCallerPackage`, now public) beside its template reference, as the delivery payload's `templateCallerPackageId`; the email and inbox channels hand it to the send. An environment-authored flow, or an environment override of a packaged one, records none; a `templateCallerPackageId` key in the node's literal `payload` is dropped, never forwarded. A delivery row queued before this release carries no such key and sends as before, with no package.

So a package no longer has to rename an email template because a package of another namespace already ships one of that name, and each package's flows keep sending their own.

A customization pair's member row (a locale Studio added in an App's pair) that two or more holders of the name could own, because two packages of the App each ship the template and the row declares no `overrides` naming its base, is no package's own: each such holder's exact read refuses it `409` naming every one, the list scoped to a holder leaves it out (a send there takes the locale ladder's next rung), and `os migrate stored-references` lists it under `pairMembers`. With one such holder it is that holder's, as before (#28390 ruling A); the App's own address keeps serving it; once the row declares the base it customizes (`overrides.package`), only that base serves it.

Not changed, and declared: a legacy package-less environment row of a name two packages now hold stands in for both holders' slot, so both exact addresses serve it, as `main` already does for the nine presentation and AI types. A package-less row is the customization of one holder and cannot say which; it is recorded on the epic as an open item, to be refused for every covered type before that type narrows.

Unchanged, and still refused with the same `422 NAMESPACE_CONFLICT` envelope and sentence:

- a second package of the SAME namespace (a co-owner) holding the name (at `install-local`, a co-owner depends on the holder, so the ADR-0146 D2 override write gate refuses it first, `403 NOT_OVERRIDABLE`, as before);
- a package that declares no namespace, beside any other holder of the name, and any holder beside it;
- two packages of one shareable namespace (`base`, `system`, `sys`) holding the name;
- a built-in name;
- the eight platform-requested `auth.*` templates the authentication plugin sends with no package (`auth.password_reset`, `auth.verify_email`, `auth.magic_link`, `auth.invitation`, `auth.account_invitation`, `auth.two_factor_otp`, `auth.email_change_notice`, `auth.existing_account_sign_up`). They join core's `PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE`, so they resolve environment-wide and keep one overriding package per deployment: an app may still override the built-in, and a second app's override is refused naming the first.

A package that ships only locales its base does not ship (an addition to the base's template) is still judged against the base whatever the namespaces, and refused naming it, as before; a send made from it resolves the name from its closure, as any other package of it would. A dependent's locale authored in Studio stays under the dependent: the exact qualifier (`?package=ID`) now reads it, and a customization pair's added locale on its base's address, as that package's own (`@objectstack/metadata-protocol`).

Every other covered type still on one package holder per deployment (flow, action, webhook, connector, and the rest) keeps it. The webhook and connector halves of this child follow in their own changes.
