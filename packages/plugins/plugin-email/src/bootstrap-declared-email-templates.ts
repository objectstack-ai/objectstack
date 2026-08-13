// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapDeclaredEmailTemplates — materialize declared `email_template`
 * metadata into `sys_email_template` rows so `sendTemplate` can actually see
 * them (closes #4509 item 1; same disconnect class as webhook #3461).
 *
 * ## The disconnect this closes
 * `EmailService.sendTemplate` resolves templates through a {@link TemplateLoader}
 * that reads `sys_email_template` ROWS. Until now the only writers of those rows
 * were the built-in auth templates and `EmailServicePluginOptions.templates` —
 * a code-only door that no bootstrapper ever passed. Meanwhile the whole
 * authoring surface (stack `emailTemplates:`, `*.email-template.ts`, Studio's
 * metadata-admin list, `PUT /meta`) decomposed into `email_template` METADATA
 * that nothing read back. An admin could "fix" the password-reset mail in
 * Studio, get a success toast, and watch users keep receiving the built-in copy
 * — ADR-0078 false compliance on authentication email. This seeder is the
 * missing ingestion path.
 *
 * ## Shape translation (authoring → runtime row)
 * Unlike webhooks, there is no shape divergence to reconcile: the metadata
 * authoring shape and the seeding input are the SAME spec type
 * ({@link EmailTemplateDefinition}), so the mapping is exactly the one the
 * built-in seeder already uses — {@link mapTemplateToRow}, shared by both doors
 * so they can never drift apart.
 *
 * Each item is validated through `EmailTemplateDefinitionSchema.parse()` first —
 * this gives the spec schema a real consumer (defaults for `locale` / `category`
 * / `active` / `isSystem` get applied) and rejects malformed authoring with a
 * warning instead of crashing boot.
 *
 * ## Seed-not-clobber (mirrors sys_webhook #3461, sys_sharing_rule #2909)
 * `sys_email_template` is admin-editable (`managedBy: 'config'`). Declared
 * templates ship with the app/package, so they seed with `managed_by: 'package'`
 * provenance and re-seed on every boot — but a row an admin created
 * (`managed_by: 'admin'`) or edited (`customized: true`, stamped by
 * {@link bindEmailTemplateProvenanceStamp}) is never overwritten. An admin's
 * reworded transactional mail survives redeploys.
 *
 * Note this is a DIFFERENT axis from `is_system`, which the built-in auth
 * template seeder uses and which stays exactly as it was.
 *
 * ## Runtime writes
 * `email_template` is `allowRuntimeCreate: true` (unlike `webhook`), so a
 * boot-only bridge would leave a Studio save inert until the next restart — the
 * same bug, half-fixed. {@link upsertDeclaredEmailTemplate} is exported for the
 * live `metadata.subscribe('email_template', …)` path in EmailServicePlugin.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import {
  EmailTemplateDefinitionSchema,
  type EmailTemplateDefinition,
} from '@objectstack/spec/system';

/** System write context — the boot seeder is not an admin authoring action. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** Default backing object; overridable for tests. */
export const EMAIL_TEMPLATE_OBJECT = 'sys_email_template';

interface Logger {
  info?: (msg: string, meta?: unknown) => void;
  warn?: (msg: string, meta?: unknown) => void;
}

/**
 * Translate a validated {@link EmailTemplateDefinition} into
 * `sys_email_template` column values.
 *
 * Shared by BOTH doors — the built-in/options seeder (`EmailServicePlugin`)
 * and the declared-metadata bridge — so the authoring shape has exactly one
 * runtime projection. Optional keys are omitted rather than nulled so a
 * re-seed never blanks a column the author left unset.
 */
export function mapTemplateToRow(tpl: EmailTemplateDefinition): Record<string, unknown> {
  return {
    name: tpl.name,
    label: tpl.label,
    category: tpl.category,
    locale: tpl.locale,
    subject: tpl.subject,
    body_html: tpl.bodyHtml,
    ...(tpl.bodyText ? { body_text: tpl.bodyText } : {}),
    ...(tpl.fromOverride?.address ? {
      from_address: tpl.fromOverride.address,
      ...(tpl.fromOverride.name ? { from_name: tpl.fromOverride.name } : {}),
    } : {}),
    ...(tpl.replyTo ? { reply_to: tpl.replyTo } : {}),
    active: tpl.active,
    is_system: tpl.isSystem,
    ...(tpl.description ? { description: tpl.description } : {}),
    ...(tpl.variables?.length ? { variables_json: JSON.stringify(tpl.variables) } : {}),
  };
}

/** Random id with a stable prefix — mirrors the webhook seeder. */
function uid(prefix: string): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `${prefix}_${g.crypto.randomUUID()}`;
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Read declared `email_template` items from the ObjectQL registry (where the
 * manifest decomposition parks `stack.emailTemplates`), falling back to the
 * metadata service. Both reads hand back the authoring document itself.
 *
 * ## [#8378] Why there is no `i?.content ?? i` here any more
 *
 * The sentence this docblock used to end with — "Items may be wrapped as
 * `{ content }` — unwrap to the raw authoring object" — described an envelope
 * with **no producer**. Re-measured at this seam rather than inherited from
 * #7519's measurement of `MetadataFacade`:
 *
 *  - `registerMetadataCollections` (objectql `engine.ts`) registers each
 *    `stack.emailTemplates` element as-is — `registerItem(type, item, 'name')`,
 *    no boxing;
 *  - `loadMetaFromDb` (metadata-protocol) registers
 *    `convertStoredItem(JSON.parse(record.metadata))` — the parsed body, never
 *    the `sys_metadata` row (whose body column is `metadata`, not `content`);
 *  - `MetadataFacade`'s own interim boxing of non-object values, the one writer
 *    that ever produced the shape, was removed by #8349.
 *
 * ## …and why removing it is a FIX rather than a tidy-up
 *
 * `content` IS a spelling an author can write on an email template — but as a
 * **rejection alias**, not a conversion. `EmailTemplateDefinitionSchema`'s
 * `strictObject({ aliases: { content: 'bodyHtml', … } })` table feeds
 * `strictUnknownKeyError`, which runs only on the `unrecognized_keys` path and
 * only builds a *message*; it never rewrites the key. Nor does the ADR-0087
 * conversion layer — `packages/spec/src/conversions/registry.ts` has zero
 * `email_template` entries, so `normalizeStackInput` emits no notice and leaves
 * `content` exactly where the author wrote it.
 *
 * So the key survives to this read only through a door that skips validation
 * (`defineStack(…, { strict: false })`, a hand-built manifest, a direct
 * registry write) — and on precisely that path the unwrap was actively harmful,
 * in two ways:
 *
 *  1. **It destroyed the author's own prescription.** With the unwrap, the
 *     string reached `EmailTemplateDefinitionSchema.parse()` and the template
 *     was refused with `Invalid input: expected object, received string`, and
 *     the boot warning's `name` field came back `undefined` — the operator
 *     could not even tell which template failed. Without it the document
 *     reaches the parse intact and the schema answers what it was built to
 *     answer: *Unrecognized key(s) on this email template: `content`. Did you
 *     mean `content` → `bodyHtml`?*
 *  2. **`content: ''` vanished.** Falsy but non-nullish, so it passed `??` and
 *     then died at the `filter(Boolean)` below — the template was dropped with
 *     no warning, no count, nothing (the ADR-0078 silent-loss shape).
 */
function readDeclared(engine: any, metadataService: any, type: string): any[] {
  try {
    const reg = engine?._registry;
    if (reg?.listItems) {
      const items = (reg.listItems(type) ?? []).filter(Boolean);
      if (items.length > 0) return items;
    }
  } catch {
    /* fall through to metadata service */
  }
  try {
    const listed = metadataService?.list?.(type);
    const arr = typeof (listed as any)?.then === 'function' ? [] : (listed ?? []);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export interface BootstrapDeclaredEmailTemplatesResult {
  seeded: number;
  skipped: number;
}

/**
 * Materialize ONE declared template into `sys_email_template`, honouring
 * seed-not-clobber. Shared by the boot sweep and the live subscribe path.
 *
 * @returns `true` when the row was written, `false` when deliberately skipped.
 * @throws when the raw item fails schema validation, or the write itself fails
 *   — callers decide whether that warns or propagates.
 */
export async function upsertDeclaredEmailTemplate(
  engine: IDataEngine,
  raw: unknown,
  object = EMAIL_TEMPLATE_OBJECT,
  logger?: Logger,
): Promise<boolean> {
  const tpl: EmailTemplateDefinition = EmailTemplateDefinitionSchema.parse(raw);
  const now = new Date().toISOString();

  const existing = await (engine as any).find(object, {
    where: { name: tpl.name, locale: tpl.locale },
    limit: 1,
    context: SYSTEM_CTX,
  });
  const row: any = Array.isArray(existing) ? existing[0] : (existing as any)?.data?.[0];

  if (row?.id) {
    // Admin owns a same-named row, or has edited this seeded one — never
    // clobber. A reworded transactional mail must survive redeploys.
    if (row.managed_by === 'admin') {
      logger?.warn?.('[email] declared template collides with an admin-authored row — seed skipped', {
        name: tpl.name,
        locale: tpl.locale,
      });
      return false;
    }
    if (row.customized === true) return false;
    await (engine as any).update(object, {
      id: row.id,
      ...mapTemplateToRow(tpl),
      // Adopt pristine/legacy (pre-provenance) rows so future boots recognize
      // them as package-managed.
      managed_by: 'package',
      updated_at: now,
    }, { context: SYSTEM_CTX });
    return true;
  }

  await (engine as any).insert(object, {
    id: uid('etpl'),
    ...mapTemplateToRow(tpl),
    managed_by: 'package',
    customized: false,
    created_at: now,
    updated_at: now,
  }, { context: SYSTEM_CTX });
  return true;
}

/**
 * Deactivate the rows a deleted `email_template` metadata item materialized.
 *
 * Delete events carry only `(type, name)` — no locale — while a template is
 * keyed `(name, locale)`, so the sweep is by name across locales. Rows are
 * DEACTIVATED rather than deleted: withdrawing an authored template should
 * stop it being sent, not destroy a row an admin may have hand-tuned or a
 * history an operator may want to read. Admin-authored and `customized` rows
 * are left strictly alone.
 */
export async function deactivateDeclaredEmailTemplate(
  engine: IDataEngine,
  name: string,
  object = EMAIL_TEMPLATE_OBJECT,
  logger?: Logger,
): Promise<number> {
  const found = await (engine as any).find(object, {
    where: { name },
    context: SYSTEM_CTX,
  });
  const rows: any[] = Array.isArray(found) ? found : ((found as any)?.data ?? []);
  let deactivated = 0;
  for (const row of rows) {
    if (!row?.id) continue;
    if (row.managed_by !== 'package') continue;
    if (row.customized === true) continue;
    if (row.active === false) continue;
    await (engine as any).update(object, {
      id: row.id,
      active: false,
      updated_at: new Date().toISOString(),
    }, { context: SYSTEM_CTX });
    deactivated += 1;
  }
  if (deactivated > 0) {
    logger?.info?.('[email] declared template withdrawn — rows deactivated', { name, deactivated });
  }
  return deactivated;
}

/**
 * Materialize every declared email template into `sys_email_template`.
 * Idempotent and safe to run on every boot.
 */
export async function bootstrapDeclaredEmailTemplates(
  engine: IDataEngine,
  metadataService: any,
  logger?: Logger,
  object = EMAIL_TEMPLATE_OBJECT,
): Promise<BootstrapDeclaredEmailTemplatesResult> {
  const declared = readDeclared(engine, metadataService, 'email_template');
  if (declared.length === 0) return { seeded: 0, skipped: 0 };

  let seeded = 0;
  let skipped = 0;

  for (const raw of declared) {
    try {
      const written = await upsertDeclaredEmailTemplate(engine, raw, object, logger);
      if (written) seeded += 1;
      else skipped += 1;
    } catch (err: any) {
      // A malformed template warns and is skipped, never crashing boot — the
      // rest of the batch still materializes.
      logger?.warn?.('[email] declared email template failed to materialize — skipped', {
        name: (raw as any)?.name,
        error: err?.message ?? String(err),
      });
      skipped += 1;
    }
  }

  logger?.info?.('[email] declared email templates materialized into sys_email_template', {
    seeded,
    skipped,
    total: declared.length,
  });
  return { seeded, skipped };
}
