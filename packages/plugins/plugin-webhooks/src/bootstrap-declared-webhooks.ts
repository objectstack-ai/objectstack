// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapDeclaredWebhooks — materialize stack/connector-declared `webhooks`
 * into `sys_webhook` rows so the dispatcher can actually see them (closes #3461).
 *
 * ## The disconnect this closes
 * The spec authoring surface (`WebhookSchema` — `defineStack({ webhooks })`,
 * `@objectstack/spec/automation/webhook`) declares `object` / `isActive`, and
 * is generically decomposed into the ObjectQL registry at boot as metadata
 * type `webhook`. But the runtime dispatcher ({@link AutoEnqueuer}) reads
 * `sys_webhook` DATA rows (`object_name` / `active`), which until now were only
 * ever written by hand through the object's CRUD UI. Nothing bridged the two —
 * so authoring `webhooks:` on a stack produced metadata artifacts that never
 * became dispatchable rows (a silent no-op; ADR-0078). This seeder is that
 * missing ingestion path.
 *
 * ## Shape translation (authoring → runtime row)
 * The spec shape diverges from the runtime column names; we map only at this
 * boundary and stash the full validated envelope in `definition_json` (whence
 * the enqueuer reads headers / secret / timeout):
 *   - `object`     → `object_name`
 *   - `isActive`   → `active`
 *   - `triggers` / `url` / `method` / `label` / `description` → same-named columns
 *   - the entire parsed {@link Webhook} → `definition_json` (JSON string)
 *
 * Each item is validated through `WebhookSchema.parse()` first — this gives the
 * spec schema a real consumer (defaults for `method`/`isActive`/`timeoutMs` get
 * applied) and rejects malformed authoring with a warning instead of crashing
 * boot.
 *
 * ## Seed-not-clobber (mirrors sys_sharing_rule, #2909)
 * `sys_webhook` is admin-editable (`managedBy: 'config'`). Declared webhooks
 * ship with the app/package, so they seed with `managed_by: 'package'`
 * provenance and re-seed on every boot — but a row an admin has created
 * (`managed_by: 'admin'`) or edited (`customized: true`, stamped by
 * {@link bindWebhookProvenanceStamp}) is never overwritten. Most importantly,
 * an admin's `active: false` on a noisy webhook survives redeploys.
 *
 * MUST run before {@link AutoEnqueuer.start} so the enqueuer's first cache
 * refresh already sees the declared rows.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import { WebhookSchema, type Webhook } from '@objectstack/spec/automation';

/** System write context — the boot seeder is not an admin authoring action. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

interface Logger {
  info?: (msg: string, meta?: unknown) => void;
  warn?: (msg: string, meta?: unknown) => void;
}

/** Random id with a stable prefix — mirrors the sharing-rule seeder. */
function uid(prefix: string): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `${prefix}_${g.crypto.randomUUID()}`;
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Read declared `webhook` items from the ObjectQL registry (where the manifest
 * decomposition parks `stack.webhooks`), falling back to the metadata service.
 * Items may be wrapped as `{ content }` — unwrap to the raw authoring object.
 */
function readDeclared(engine: any, metadataService: any, type: string): any[] {
  try {
    const reg = engine?._registry;
    if (reg?.listItems) {
      const items = (reg.listItems(type) ?? []).map((i: any) => i?.content ?? i).filter(Boolean);
      if (items.length > 0) return items;
    }
  } catch {
    /* fall through to metadata service */
  }
  try {
    const listed = metadataService?.list?.(type);
    const arr = typeof (listed as any)?.then === 'function' ? [] : (listed ?? []);
    return Array.isArray(arr) ? arr.map((i: any) => i?.content ?? i).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export interface BootstrapDeclaredWebhooksResult {
  seeded: number;
  skipped: number;
}

/**
 * Materialize declared webhooks into `sys_webhook`. Idempotent and safe to run
 * on every boot.
 */
export async function bootstrapDeclaredWebhooks(
  engine: IDataEngine,
  metadataService: any,
  logger?: Logger,
  subscriptionsObject = 'sys_webhook',
): Promise<BootstrapDeclaredWebhooksResult> {
  const declared = readDeclared(engine, metadataService, 'webhook');
  if (declared.length === 0) return { seeded: 0, skipped: 0 };

  const now = new Date().toISOString();
  let seeded = 0;
  let skipped = 0;

  for (const raw of declared) {
    // Validate + fill defaults through the canonical spec schema. A real
    // consumer at last — a malformed webhook warns and is skipped, never
    // crashing boot.
    let wh: Webhook;
    try {
      wh = WebhookSchema.parse(raw);
    } catch (err: any) {
      logger?.warn?.('[webhook] declared webhook failed validation — skipped', {
        name: (raw as any)?.name,
        error: err?.message ?? String(err),
      });
      skipped += 1;
      continue;
    }

    try {
      const existing = await engine.find(subscriptionsObject, {
        filter: { name: wh.name },
        limit: 1,
        context: SYSTEM_CTX,
      } as any);
      const row: any = Array.isArray(existing) ? existing[0] : undefined;

      if (row) {
        // Admin owns a same-named row, or has edited this seeded one — never
        // clobber. `active: false` on a noisy webhook must survive redeploys.
        if (row.managed_by === 'admin') {
          logger?.warn?.('[webhook] declared name collides with an admin-authored row — seed skipped', {
            name: wh.name,
          });
          skipped += 1;
          continue;
        }
        if (row.customized === true) {
          skipped += 1;
          continue;
        }
        const patch = {
          id: row.id,
          ...mapWebhookToRow(wh),
          // Adopt pristine/legacy (pre-provenance) rows so future boots
          // recognize them as package-managed.
          managed_by: 'package',
          updated_at: now,
        };
        await engine.update(subscriptionsObject, patch, { context: SYSTEM_CTX } as any);
        seeded += 1;
        continue;
      }

      const newRow = {
        id: uid('whk'),
        ...mapWebhookToRow(wh),
        managed_by: 'package',
        customized: false,
        created_at: now,
        updated_at: now,
      };
      await engine.insert(subscriptionsObject, newRow, { context: SYSTEM_CTX } as any);
      seeded += 1;
    } catch (err: any) {
      logger?.warn?.('[webhook] declared webhook seed failed', {
        name: wh.name,
        error: err?.message ?? String(err),
      });
      skipped += 1;
    }
  }

  logger?.info?.('[webhook] declared webhooks materialized into sys_webhook', {
    seeded,
    skipped,
    total: declared.length,
  });
  return { seeded, skipped };
}

/**
 * Translate a validated {@link Webhook} into `sys_webhook` column values.
 * `object → object_name`, `isActive → active`; the full envelope is stashed in
 * `definition_json` for the enqueuer's advanced-config read (headers/secret/…).
 */
function mapWebhookToRow(wh: Webhook): Record<string, unknown> {
  return {
    name: wh.name,
    label: wh.label ?? wh.name,
    object_name: wh.object ?? null,
    triggers: wh.triggers ?? [],
    url: wh.url,
    // Store lowercase to match the object's Field.select option values
    // (get/post/…); the enqueuer upper-cases before delivery either way.
    method: String(wh.method ?? 'POST').toLowerCase(),
    description: wh.description ?? null,
    active: wh.isActive !== false,
    definition_json: JSON.stringify(wh),
  };
}
