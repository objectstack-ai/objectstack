---
'@objectstack/plugin-email': minor
'@objectstack/plugin-auth': minor
'@objectstack/platform-objects': patch
---

feat(plugin-email,plugin-auth)!: an organization can no longer create or edit an email template row; the template provenance stamp and the auth SMS template seed retire

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling or stored shape is removed, renamed or re-shaped, and no stored row is read, rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime write door (an organization's create and update of a sys_email_template row are refused) and a boot seed (no sys_notification_template row is written). The three retired names are runtime functions and a string constant of @objectstack/plugin-email with no metadata surface and no replacement: a direct caller meets the compiler's missing-export error and deletes the call. Measured consumers in this repository outside the package: one audit script, updated here. The other categories are closed on facts: every bumped package publishes (not unpublished); no ADR-0087 id covers these paths and this diff adds none (not registered / already-registered); and the retired names are functions and a constant, not a type surface (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing and three retired exports), shipped as `minor` under the launch-window convention for breaking changes. It carries ADR-0131 D6 and the maintainer's ruling C on ADR-0131 §6 Q1: email templates are not overridden per organization.

**What stops being accepted.**

- **The `sys_email_template` organization door is closed.** An organization's create and update of a template row are refused with `403 PERMISSION_DENIED`, and the message names the closed door: every engine `insert` / `update` whose context names a caller and is not system-elevated. That covers `POST` / `PATCH /api/v1/data/sys_email_template`, the Studio record editor, batch and import routes, and scripts and flows that run as a user or a service principal. System-context writes still pass: the built-in seed, the declared-template boot sweep, the live projection of a Studio `email_template` save into its row, and the v18 migration ceremony's promotion. Delete is not part of this door.
- **The template provenance stamp is retired.** It marked a package- or platform-seeded row `customized: true` when a non-system caller updated it. With the door closed no such update reaches the engine's write, so nothing marks a row any more. Rows already marked keep their mark and are still never overwritten by the boot seeders; they are the population the v18 migration ceremony promotes to environment-level Studio templates.
- **Retired exports of `@objectstack/plugin-email`:** `bindEmailTemplateProvenanceStamp`, `unbindEmailTemplateProvenanceStamp` and `EMAIL_TEMPLATE_PROVENANCE_PACKAGE`. They have no replacement. `EmailServicePlugin` closes the door itself, and there is no stamp left to bind, so a direct call is deleted, not rewritten.
- **The auth SMS template seed is retired.** A boot with phone sign-in on no longer writes the built-in OTP and invitation texts into `sys_notification_template` as rows. It was internal to `@objectstack/plugin-auth` and exported nothing.

**What renders unchanged.**

- Every email template renders as before: the template loader still reads `sys_email_template`, and a Studio edit of an `email_template` still reaches the mail at once and survives a restart.
- Every auth SMS text renders byte for byte as the seeded store rendered it, for every built-in text and every recipient locale. Each locale rung renders an operator's active row when one exists, and the built-in text where no row exists at that locale. A deactivated or blank row passes its rung on, as it did before.
- A `sys_notification_template` row an operator already has still wins, and no existing row is touched.

**What changes for you.** To change what an email template sends, edit the `email_template` in Studio. A script or integration that wrote `sys_email_template` rows through the data API now receives `403 PERMISSION_DENIED`. `@objectstack/platform-objects` corrects the `is_system` and `customized` field help on `sys_email_template`, which said an organization may edit a row.
