---
'@objectstack/plugin-email': minor
'@objectstack/spec': patch
'@objectstack/service-automation': patch
---

feat(plugin-email)!: email templates resolve from the registry; the built-in seed, the declared-template boot sweep and the live projector retire

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling or stored shape is removed, renamed or re-shaped, and no stored row is rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What changes is where @objectstack/plugin-email reads a template (the email_template metadata in the registry instead of the sys_email_template rows it used to copy there) and which runtime exports and plugin options exist. The retired names are runtime functions, two types, a string constant and two EmailServicePluginOptions members of @objectstack/plugin-email, each with its one-line fix below; measured consumers in this repository outside the package (a showcase test and three dogfood tests) are rewritten here. The legacy sys_email_template rows stay where they are, untouched: promoting the customized ones to environment-level templates is the v18 migration ceremony's (ADR-0131 C7), not this change's. The other categories are closed on facts: every bumped package publishes (not unpublished); no ADR-0087 id covers these paths and this diff adds none (not registered / already-registered); and the retired names include runtime functions, not only a type surface (not runtime-interface-only / type-surface-only). -->

**BREAKING** (retired exports and plugin options of `@objectstack/plugin-email`), graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, so this ships in an `18.0.0-next.N`. It carries ADR-0131 D6/D10 and the maintainer's ruling C on ADR-0131 §6 Q1.

**What changes.**

- **Templates resolve from the registry.** `sendTemplate` and `renderTemplate` read `email_template` metadata by `(name, locale)` at every send: the protocol's layered list (`GET /meta/email_template`'s items — the environment's item over each code package's declaration), or the ObjectQL registry on a host with no metadata door. The locale ladder is unchanged: the named locale exactly, then `en-US`, then — only for a call that named none — the bundle's lowest locale tag.
- **The built-in auth templates are code-declared items** of the email plugin's own package (`com.objectstack.service.email`), registered at plugin init, so they now appear in Studio's email-template list. An app that declares the same `(name, locale)` wins over the built-in; the built-in still serves the locales the app leaves out; a Studio save overrides either at environment level. Every built-in renders byte-identical to the row it used to be seeded into, in every locale (pinned on the rendered subject, HTML and text).
- **A Studio save is live on the next send**, with no projection and no restart. The `PUT /meta/email_template/:name` response no longer carries `projectionApplied`, because nothing is projected.
- **No `sys_email_template` row is written at boot or read at send.** The table and its rows stay; the organization door stays closed.
- **A malformed template fails its send loudly** with the schema's own message, instead of falling through to the built-in copy of the same slot.

**What moves for consumers.**

- FROM `createSysEmailTemplateLoader(engine, options?)` TO `createRegistryEmailTemplateLoader(sources)`, where `sources` is `{ protocol?, registry? }` (type `EmailTemplateRegistrySources`) or a function returning it. FROM the types `TemplateLoaderEngine` / `CreateTemplateLoaderOptions` TO `EmailTemplateRegistrySources`.
- FROM `bootstrapDeclaredEmailTemplates(...)`, `upsertDeclaredEmailTemplate(...)` or `deactivateDeclaredEmailTemplate(...)` TO nothing: templates are not copied into rows any more. Delete the call.
- FROM `mapTemplateToRow(tpl)` TO nothing: there is no row projection. To resolve a template the way the mailer does, call `createRegistryEmailTemplateLoader(...).load(name, locale)`.
- FROM `EMAIL_TEMPLATE_OBJECT` TO the literal `'sys_email_template'`, only if you still address the legacy table. FROM the type `BootstrapDeclaredEmailTemplatesResult` TO nothing.
- FROM `new EmailServicePlugin({ seedTemplates: false })` TO `new EmailServicePlugin()`: there is no seed to switch off. Delete the option.
- FROM `new EmailServicePlugin({ templates: [...] })` TO the stack's `emailTemplates: [...]` (or a `*.email-template.ts` file): declared templates resolve from the registry. Delete the option.

**What a deployment observes.** A `sys_email_template` row an organization customized before its door closed is no longer what sends: the template's code declaration (or an environment-level Studio save) is. The v18 migration ceremony promotes those rows to environment-level templates; to make such an edit live before it runs, re-save the template in Studio.

**`@objectstack/spec`** (patch): the `email_template` liveness ledger is re-anchored to the registry loader, and `category` and `isSystem` are graded `dead` — their only consumer was the retired row projection. The `notify` node's `template` description and refusal messages, and the `IEmailService` contract's documentation, name the email templates rather than `sys_email_template` rows. No schema shape changes.

**`@objectstack/service-automation`** (patch): the notify node's `template` help text served at `GET /api/v1/automation/actions` names the email templates rather than `sys_email_template` rows.
