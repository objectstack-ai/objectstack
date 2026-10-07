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
 *
 * ## What the boot sweep projects (#21785)
 * The EFFECTIVE template — what the metadata door serves, a Studio overlay
 * included — not the package's declaration. The live path already projects
 * the overlay when the admin saves it, so a boot sweep reading the package
 * layer reverted the sending row on every restart while `GET /meta` kept
 * serving the admin's wording. See {@link readDeclared}.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import type { GetMetaItemsRequest, GetMetaItemsResponse } from '@objectstack/spec/api';
import { stripReadDecorations } from '@objectstack/spec/kernel';
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
 * The two kernel services the boot sweep reads the EFFECTIVE templates through
 * (#21785). Both are optional: a host that registers no `protocol` has no
 * metadata door, so nothing can overlay a declaration there and the registry
 * read below is already the effective one.
 *
 * Module-internal: exported for EmailServicePlugin's boot wiring only and
 * deliberately NOT re-exported from the package entry — see
 * {@link bootstrapEffectiveEmailTemplates}.
 */
export interface EffectiveEmailTemplateSources {
  /** The `protocol` service. `getMetaItems` is the layered list `GET /meta/email_template` serves. */
  protocol?: { getMetaItems(request: GetMetaItemsRequest): Promise<GetMetaItemsResponse> };
  /** The `tenancy` service. `defaultOrgId()` is the organization an org-less read resolves in. */
  tenancy?: { defaultOrgId(): Promise<string | null> };
}

/** {@link readDeclared}'s answer when the effective read did not happen. */
const EFFECTIVE_READ_FAILED = Symbol('email-template-effective-read-failed');

/**
 * Read the `email_template` items the boot sweep projects: the EFFECTIVE
 * items, as the metadata door serves them, when a `protocol` is registered;
 * otherwise the declared items from the ObjectQL registry (where the manifest
 * decomposition parks `stack.emailTemplates`), falling back to the metadata
 * service. Every read hands back the authoring document itself.
 *
 * ## [#21785] Why the effective read, and in which organization
 *
 * The registry holds the package's declaration and only the ENV-WIDE overlays
 * boot hydration (`loadMetaFromDb`) registers. `email_template` is
 * `allowOrgOverride: true`, so an admin saving through `PUT /meta` with an
 * active organization — every Studio save on a `single`-posture deployment,
 * where the Default Organization is bootstrapped — writes an ORG-SCOPED
 * overlay, which hydration deliberately leaves out of the process-wide
 * registry. The live path projected that overlay into the sending row at save
 * time; this sweep then read the package layer and wrote the package wording
 * back on every boot, while `GET /meta/email_template/:name` kept serving the
 * admin's wording. Measured on the showcase before the fix: the env-wide
 * overlay survived (the registry lists it after the package entry), the
 * org-scoped one reverted.
 *
 * So the sweep reads what the door reads — `protocol.getMetaItems`, the
 * layered list (org overlay over env-wide overlay over package), one item per
 * `(name, locale)` slot — and resolves the organization the way every other
 * org-less reader of org-overridable metadata does: `tenancy.defaultOrgId()`,
 * as the anonymous form doors read a form (`@objectstack/rest`). That answers
 * the Default Organization under `single` (ADR-0131: the organization IS the
 * environment there) and `null` whenever a walled posture was requested (the
 * tenancy contract never guesses an organization there), where the read is
 * env-wide. The sending row stays org-agnostic: template resolution keys on
 * `(name, locale)` only, and per-organization template rows are a capability
 * no ruling has opened.
 *
 * The served items carry read decorations (`_diagnostics`) the strict schema
 * refuses, so each is passed through the shared `stripReadDecorations` — the
 * same treatment the plugin's single-item effective read applies.
 *
 * A failed effective read is NOT answered from the registry. The registry
 * holds the package wording, so falling back would revert every overlay
 * projection on a transient storage error — this defect again, by a second
 * route. It answers {@link EFFECTIVE_READ_FAILED} and the sweep projects
 * nothing; every row keeps its last projection until the next boot.
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
async function readDeclared(
  engine: any,
  metadataService: any,
  type: string,
  sources: EffectiveEmailTemplateSources | undefined,
  logger: Logger | undefined,
): Promise<unknown[] | typeof EFFECTIVE_READ_FAILED> {
  const protocol = sources?.protocol;
  if (typeof protocol?.getMetaItems === 'function') {
    try {
      const organizationId = typeof sources?.tenancy?.defaultOrgId === 'function'
        ? await sources.tenancy.defaultOrgId()
        : null;
      const listed = await protocol.getMetaItems({ type, ...(organizationId ? { organizationId } : {}) });
      return listed.items.filter(Boolean).map(stripReadDecorations);
    } catch (err: any) {
      logger?.warn?.(
        '[email] effective email-template read failed — no declared template re-materialized this boot; '
        + 'every sys_email_template row keeps its last projection',
        { error: err?.message ?? String(err) },
      );
      return EFFECTIVE_READ_FAILED;
    }
  }
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
 * [#22062] How many declared names one bulk read of the boot sweep carries in
 * its `$in` list. Module-internal; exported for this package's own tests.
 */
export const SWEEP_NAMES_PER_READ = 200;

/**
 * [#22062] The row bound of one bulk read. Module-internal; exported for this
 * package's own tests.
 *
 * The bound is not a completeness claim. A read that comes back holding this
 * many rows may have been cut short, and a key the read did not answer is never
 * taken as "no row": the sweep looks that template up on its own before it
 * inserts anything (see {@link bootstrapEffectiveEmailTemplates}). Five rows per
 * name is room for the usual locale and organization spread, so a steady boot
 * pays that fallback only where a name really carries more rows than that.
 *
 * The bound also does a second job: it makes the read PAGED. A paged read with
 * no `orderBy` is the very shape of the per-template lookup
 * (`find(…, { where: { name, locale }, limit: 1 })`), so a driver orders both
 * the same way, and the first row a key meets in the bulk read is the row that
 * lookup returns. Measured on `ObjectQL` over `SqlDriver` (better-sqlite3): both
 * statements go out as `… order by id asc limit ?`; the same read with no
 * `limit` gets no ORDER BY at all and walks rows in storage order, which chose
 * a different row for a `(name, locale)` held by several organizations.
 */
export const SWEEP_ROWS_PER_READ = SWEEP_NAMES_PER_READ * 5;

/** [#22062] A stored template's key: a template is unique per `(name, locale)`. */
function templateRowKey(name: unknown, locale: unknown): string {
  return JSON.stringify([name, locale]);
}

/**
 * The per-template lookup: the stored row for one `(name, locale)`, or
 * `undefined`. The live doors read through it, and so does the boot sweep for
 * every key its bulk read did not answer.
 */
async function findTemplateRow(
  engine: IDataEngine,
  object: string,
  name: string,
  locale: string | undefined,
): Promise<any> {
  const existing = await (engine as any).find(object, {
    where: { name, locale },
    limit: 1,
    context: SYSTEM_CTX,
  });
  return Array.isArray(existing) ? existing[0] : (existing as any)?.data?.[0];
}

/**
 * [#22062] Read the stored rows for the declared names in bulk, one read per
 * {@link SWEEP_NAMES_PER_READ} names, instead of one lookup per template.
 *
 * Each key keeps the FIRST row it meets, in the read's own order — the order
 * the per-template lookup is answered in (see {@link SWEEP_ROWS_PER_READ}). A
 * read cut short at its bound keeps that property for every key it answered:
 * the rows it returned are a prefix of one order, so a key's first row is in
 * it whenever any of its rows is.
 *
 * Answers `undefined` when a read fails or does not answer a row list. The
 * sweep then looks every template up on its own, exactly as it did before this
 * read existed — the read is an optimization, and no answer is made up for it.
 */
async function readStoredTemplateRows(
  engine: IDataEngine,
  declared: unknown[],
  object: string,
  logger: Logger | undefined,
): Promise<Map<string, any> | undefined> {
  const names = [...new Set(declared.map((item) => (item as { name?: unknown } | null)?.name))]
    .filter((name): name is string => typeof name === 'string');
  const byKey = new Map<string, any>();
  try {
    for (let start = 0; start < names.length; start += SWEEP_NAMES_PER_READ) {
      const found = await (engine as any).find(object, {
        where: { name: { $in: names.slice(start, start + SWEEP_NAMES_PER_READ) } },
        limit: SWEEP_ROWS_PER_READ,
        context: SYSTEM_CTX,
      });
      if (!Array.isArray(found)) throw new Error('the read answered no row list');
      for (const row of found) {
        const key = templateRowKey(row?.name, row?.locale);
        if (!byKey.has(key)) byKey.set(key, row);
      }
    }
  } catch (err: any) {
    logger?.warn?.(
      '[email] bulk read of stored email templates failed — each declared template is looked up on its own instead',
      { error: err?.message ?? String(err) },
    );
    return undefined;
  }
  return byKey;
}

/**
 * [#22062] Does a stored value already hold what the projection would write?
 *
 * Errs toward "no": a false "yes" keeps a stale template silently, while a
 * false "no" costs one write. So a value is held only when it is the projected
 * value itself, or one of the two storage spellings a driver may hand back for
 * it: `1`/`0` for a boolean column, and — for `variables_json`, a JSON text
 * column — the parsed value whose `JSON.stringify` is the projected text
 * exactly. Anything else, an absent or `null` column included, is not held.
 */
function storedValueHolds(column: string, stored: unknown, projected: unknown): boolean {
  if (stored === projected) return true;
  if (typeof projected === 'boolean') return stored === (projected ? 1 : 0);
  if (column === 'variables_json' && typeof projected === 'string' && stored !== null && typeof stored === 'object') {
    return JSON.stringify(stored) === projected;
  }
  return false;
}

/**
 * [#22062] True when the row already holds EVERY column the projection writes —
 * exactly the column set the update below would write, so "held" means the
 * update would change nothing the sender reads. A column the projection omits
 * (an optional key the author left unset) is not compared, as the update does
 * not write it either.
 */
function rowHoldsProjection(row: Record<string, unknown>, projected: Record<string, unknown>): boolean {
  return Object.entries(projected).every(([column, value]) => storedValueHolds(column, row[column], value));
}

/**
 * Materialize ONE declared template into `sys_email_template`, honouring
 * seed-not-clobber. Shared by the boot sweep and the live subscribe path.
 *
 * @returns `true` when the row was written, `false` when deliberately not
 *   written: an admin-owned or customized row, or a package-managed row that
 *   already holds the template's projection.
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
  const row = await findTemplateRow(engine, object, tpl.name, tpl.locale);
  return writeTemplateRow(engine, tpl, row, object, logger);
}

/**
 * The one write step behind both doors: write a validated template against the
 * row already read for its `(name, locale)` (`undefined` when there is none).
 *
 * [#22062] A `managed_by: 'package'` row that already holds the projection is
 * not rewritten. Before, every boot rewrote every effective template — one
 * UPDATE and the engine's read-backs each — whether or not anything changed.
 * A row with any other provenance takes exactly the path it took before: an
 * admin-owned or customized row is never written, and a legacy row with no
 * `managed_by` (or a `platform` one) is rewritten and adopted.
 */
async function writeTemplateRow(
  engine: IDataEngine,
  tpl: EmailTemplateDefinition,
  row: any,
  object: string,
  logger: Logger | undefined,
): Promise<boolean> {
  const now = new Date().toISOString();
  const projected = mapTemplateToRow(tpl);

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
    if (row.managed_by === 'package' && rowHoldsProjection(row, projected)) return false;
    await (engine as any).update(object, {
      id: row.id,
      ...projected,
      // Adopt pristine/legacy (pre-provenance) rows so future boots recognize
      // them as package-managed.
      managed_by: 'package',
      updated_at: now,
    }, { context: SYSTEM_CTX });
    return true;
  }

  await (engine as any).insert(object, {
    id: uid('etpl'),
    ...projected,
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
 * Materialize every declared email template into `sys_email_template` from the
 * ObjectQL registry (falling back to the metadata service). Idempotent and safe
 * to run on every boot.
 *
 * The published signature, unchanged: an external caller reads the registry
 * exactly as before — the declarations plus the env-wide overlays boot
 * hydration registered.
 */
export async function bootstrapDeclaredEmailTemplates(
  engine: IDataEngine,
  metadataService: any,
  logger?: Logger,
  object = EMAIL_TEMPLATE_OBJECT,
): Promise<BootstrapDeclaredEmailTemplatesResult> {
  // [#21785] The one sweep body, with no sources. The plugin's own boot wiring
  // calls the effective form directly. Said here, not in the docblock above:
  // the docblock ships in the published `.d.ts`, and the module-internal name
  // is not part of that surface.
  return bootstrapEffectiveEmailTemplates(engine, metadataService, undefined, logger, object);
}

/**
 * [#21785] The boot sweep EmailServicePlugin runs: materialize every
 * `email_template` into `sys_email_template` as the metadata door serves it —
 * an overlay of the declaration included — when `sources.protocol` is given,
 * and from the registry otherwise (see {@link readDeclared}). The one sweep
 * body; {@link bootstrapDeclaredEmailTemplates} is this with no sources.
 *
 * Module-internal: NOT re-exported from the package entry (`src/index.ts`),
 * and the package's `exports` map names only that entry, so this function and
 * {@link EffectiveEmailTemplateSources} add nothing to the published surface.
 * No caller outside this package needs them.
 *
 * ## [#22062] What a boot costs
 *
 * The stored rows are read in bulk ({@link readStoredTemplateRows}), and a
 * package-managed row that already holds its projection is not rewritten (see
 * `writeTemplateRow`). Measured on `ObjectQL` over `SqlDriver` (better-sqlite3),
 * a steady boot over 450 unchanged templates went from 1,800 statements (a
 * lookup, an UPDATE and its two read-backs per template) to 3 reads and no
 * write.
 *
 * A key the bulk read did not answer — a template new since the last boot, a
 * read cut short at its bound, or a failed read — is looked up on its own
 * BEFORE anything is inserted, so no row the bulk read missed is ever inserted
 * twice. A steady boot has no such key and pays nothing for the lookup.
 */
export async function bootstrapEffectiveEmailTemplates(
  engine: IDataEngine,
  metadataService: any,
  sources: EffectiveEmailTemplateSources | undefined,
  logger?: Logger,
  object = EMAIL_TEMPLATE_OBJECT,
): Promise<BootstrapDeclaredEmailTemplatesResult> {
  const declared = await readDeclared(engine, metadataService, 'email_template', sources, logger);
  if (declared === EFFECTIVE_READ_FAILED || declared.length === 0) return { seeded: 0, skipped: 0 };

  let seeded = 0;
  let skipped = 0;

  const stored = await readStoredTemplateRows(engine, declared, object, logger);

  for (const raw of declared) {
    try {
      const tpl: EmailTemplateDefinition = EmailTemplateDefinitionSchema.parse(raw);
      const key = templateRowKey(tpl.name, tpl.locale);
      const row = stored?.has(key)
        ? stored.get(key)
        : await findTemplateRow(engine, object, tpl.name, tpl.locale);
      const written = await writeTemplateRow(engine, tpl, row, object, logger);
      // A write leaves the bulk read's copy of this key stale. The list can
      // name one slot twice — the registry lists an env-wide overlay after the
      // package entry it overrides — and the later item must meet the row as
      // it is now, so it is looked up again rather than compared to the copy.
      if (written) stored?.delete(key);
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
