---
"@objectstack/platform-objects": minor
"@objectstack/plugin-email": minor
"@objectstack/objectql": minor
"@objectstack/spec": patch
---

feat(email): declared email templates reach the mail service (#4509)

Authoring an `email_template` was a silent no-op. `EmailService.sendTemplate`
resolves `(name, locale)` against **`sys_email_template` rows**, and the only
writers of those rows were the built-in auth templates plus a code-constructed
`EmailServicePluginOptions.templates` that no bootstrapper ever passed. Every
door an author can actually use — a stack's `emailTemplates:`, an
`*.email-template.ts` file, Studio's metadata-admin list, `PUT /meta` — parked
items in a metadata store nothing read back. So an admin could "fix" the
password-reset email in Studio, get a success toast, and watch users keep
receiving the built-in copy: ADR-0078 false compliance on **authentication
mail**. This is the shape #3461 had for webhooks, closed the same way (ADR-0049
enforce-or-remove, route: enforce).

**`bootstrapDeclaredEmailTemplates`** now materializes declared templates into
`sys_email_template` at boot. Each item is validated through
`EmailTemplateDefinitionSchema.parse()` — the spec schema finally has a real
consumer, defaults and all — and projected with `mapTemplateToRow`, which is the
**same** mapping the built-in seeder uses, extracted and shared so the two doors
cannot drift apart. A malformed template warns and is skipped rather than
crashing boot.

**Runtime writes take effect immediately.** Unlike `webhook`, `email_template`
is `allowRuntimeCreate: true`, so a boot-only bridge would have left a Studio
save inert until the next restart — the same bug, half-fixed. The plugin also
subscribes to `email_template` metadata changes and re-materializes the single
changed item; withdrawing a template deactivates its rows (across locales)
rather than deleting them.

**Three breaks sat on this path, not one**, and closing any two of them would
still have shipped a template that never sent:

- `@objectstack/objectql` never registered a manifest's `emailTemplates:` into
  the metadata registry at all — the key was simply missing from the generic
  ingestion list, so the bridge's own source was empty.
- The built-in seeder left `managed_by` at the column's `'admin'` default, which
  made platform templates masquerade as admin-authored. Since the bridge refuses
  to overwrite admin rows, a built-in would have permanently outranked the
  template an app declared. Built-ins now stamp `managed_by: 'platform'`.
- Nothing materialized declared metadata into rows.

**Seed-not-clobber** mirrors `sys_webhook` (#3489) and `sys_sharing_rule`
(#2909): `sys_email_template` gains `managed_by` / `customized`. Declared
templates re-seed every boot as `managed_by: 'package'`; a row an admin created
(`admin`) or edited (`customized`, stamped by a `beforeUpdate` hook) is never
overwritten, so reworded transactional mail survives redeploys. This is a
separate axis from `is_system`, which keeps its existing meaning for built-ins.

The `email_template` liveness ledger flips from 13 dead properties to fully
live, with an ADR-0054 runtime proof bound on `subject`
(`email-template-materialization`): it boots a real stack, authors a template
that overrides a built-in auth template, and asserts the **authored** wording is
what reaches the transport.
