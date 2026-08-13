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
 * boundary and stash the validated envelope in `definition_json` (whence the
 * enqueuer reads headers / timeout):
 *   - `object`     → `object_name`
 *   - `isActive`   → `active`
 *   - `triggers` / `url` / `method` / `label` / `description` → same-named columns
 *   - `secret`     → `signing_secret` (ENCRYPTED — see below)
 *   - `headers`    → `headers_secret` (ENCRYPTED — #7986, same channel)
 *   - the rest of the parsed {@link Webhook} → `definition_json` (JSON string)
 *
 * ## Neither credential goes in `definition_json` (#7799, #7986)
 * It used to: `definition_json: JSON.stringify(wh)` serialized the whole
 * envelope, key included, into an ordinary textarea on an admin-authorable
 * object — so `GET /api/v1/data/sys_webhook` returned the receiver's only proof
 * of origin to anyone who could read the object. The authored key now goes to
 * `sys_webhook.signing_secret`, a `type: 'secret'` column the engine encrypts
 * into `sys_secret` and masks on read; `definition_json` carries the same
 * envelope MINUS `secret`. Nothing about the authoring surface changes —
 * `webhook.zod.ts` still declares `secret` and authors still write it.
 *
 * Fail-closed: with no CryptoProvider registered the engine REFUSES the write
 * (it will not store cleartext), so a secret-bearing webhook is skipped with an
 * actionable log line instead of being seeded with an exposed key.
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
import {
  WEBHOOK_SECRET_FIELD,
  WEBHOOK_SECRET_REFUSAL_CODE,
  WEBHOOK_SECRET_REFUSAL_STATUS,
  canResolveSecrets,
  isSecretProtectionFailure,
  splitWebhookSecret,
} from './webhook-secret.js';
import {
  WEBHOOK_HEADERS_FIELD,
  headersPatch,
  serializeHeaders,
  splitWebhookHeaders,
} from './webhook-headers.js';

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
 *
 * [#8378] Both reads hand back the authoring document itself. The sentence that
 * used to stand here — "Items may be wrapped as `{ content }` — unwrap to the
 * raw authoring object" — described an envelope with **no producer**:
 * `registerMetadataCollections` (objectql `engine.ts`) registers each
 * `stack.webhooks` element as-is, `loadMetaFromDb` registers the parsed body
 * rather than the `sys_metadata` row, and `MetadataFacade` shed its own copy of
 * this unwrap in #7519. `WebhookSchema` declares no `content` key and rejects
 * one as unrecognized, so wherever the key did appear the unwrap replaced the
 * whole webhook with one of its values — and `''` (falsy, non-nullish) passed
 * `??` and then died at `filter(Boolean)`, dropping the webhook silently.
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
        where: { name: wh.name },
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
          ...(await secretPatch(engine, wh, row, subscriptionsObject)),
          ...(await headersPatch(
            engine,
            splitWebhookHeaders(wh as Record<string, unknown>).headers,
            row,
            subscriptionsObject,
          )),
          // Adopt pristine/legacy (pre-provenance) rows so future boots
          // recognize them as package-managed.
          managed_by: 'package',
          updated_at: now,
        };
        await engine.update(subscriptionsObject, patch, { context: SYSTEM_CTX } as any);
        seeded += 1;
        continue;
      }

      const { secret } = splitWebhookSecret(wh as Record<string, unknown>);
      const { headers } = splitWebhookHeaders(wh as Record<string, unknown>);
      const newRow = {
        id: uid('whk'),
        ...mapWebhookToRow(wh),
        // Cleartext goes in exactly once, into the `secret`-typed column; the
        // engine's write path wraps it into `sys_secret` and leaves an opaque
        // ref behind. Omitted entirely when unauthored, so a webhook with no
        // secret costs no crypto and needs no CryptoProvider.
        ...(secret ? { [WEBHOOK_SECRET_FIELD]: secret } : {}),
        // [#7986] Same channel, same rule, for the header map — omitted when
        // unauthored so a header-less webhook still seeds on a host with no
        // CryptoProvider wired.
        ...(headers ? { [WEBHOOK_HEADERS_FIELD]: serializeHeaders(headers) } : {}),
        managed_by: 'package',
        customized: false,
        created_at: now,
        updated_at: now,
      };
      await engine.insert(subscriptionsObject, newRow, { context: SYSTEM_CTX } as any);
      seeded += 1;
    } catch (err: any) {
      // [#7799] The engine refuses to persist a `secret` field with no
      // CryptoProvider wired, rather than falling back to cleartext. Say so in
      // those words — "seed failed" would read as a transient glitch, when what
      // actually happened is that the deployment has nowhere safe to put a key.
      const protection = isSecretProtectionFailure(err);
      logger?.warn?.(
        protection
          ? '[webhook] declared webhook NOT seeded — its signing secret cannot be stored encrypted (#7799)'
          : '[webhook] declared webhook seed failed',
        {
          name: wh.name,
          ...(protection
            ? { code: WEBHOOK_SECRET_REFUSAL_CODE, status: WEBHOOK_SECRET_REFUSAL_STATUS }
            : {}),
          error: err?.message ?? String(err),
        },
      );
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
 * Decide what a RE-SEED should do with an existing row's `signing_secret`.
 *
 * Re-seeding runs on every boot, and a `secret`-typed write always mints a
 * fresh `sys_secret` ciphertext row — so blindly restating the declared key
 * would leak one orphan cipher row per webhook per restart. Compare against the
 * stored plaintext first (via the engine's privileged dereference) and write
 * only on an actual change:
 *
 *  - declared key differs from stored ⇒ write it (rotation in code propagates,
 *    exactly as it did when the whole envelope was rewritten every boot);
 *  - identical ⇒ omit the key entirely, leaving the existing ref untouched;
 *  - declared key removed, row still holds one ⇒ write `null` to CLEAR it
 *    (code remains the authority for package rows);
 *  - engine cannot dereference (older engine, or the compare threw) ⇒ fall back
 *    to writing the declared value. Correct signatures beat tidy storage.
 */
async function secretPatch(
  engine: IDataEngine,
  wh: Webhook,
  row: any,
  subscriptionsObject: string,
): Promise<Record<string, unknown>> {
  const { secret } = splitWebhookSecret(wh as Record<string, unknown>);
  const hasStored = row?.[WEBHOOK_SECRET_FIELD] != null && row[WEBHOOK_SECRET_FIELD] !== '';

  if (!secret) return hasStored ? { [WEBHOOK_SECRET_FIELD]: null } : {};
  if (!hasStored || !canResolveSecrets(engine)) return { [WEBHOOK_SECRET_FIELD]: secret };

  try {
    const current = await (engine as any).resolveSecretField(
      subscriptionsObject,
      String(row.id),
      WEBHOOK_SECRET_FIELD,
    );
    return current === secret ? {} : { [WEBHOOK_SECRET_FIELD]: secret };
  } catch {
    return { [WEBHOOK_SECRET_FIELD]: secret };
  }
}

/**
 * Translate a validated {@link Webhook} into `sys_webhook` column values.
 * `object → object_name`, `isActive → active`; the envelope MINUS its two
 * credential passengers — `secret` (#7799) and `headers` (#7986) — is stashed
 * in `definition_json` for the enqueuer's advanced-config read (`timeoutMs`).
 * Both credentials are written separately, into their own encrypted columns.
 */
function mapWebhookToRow(wh: Webhook): Record<string, unknown> {
  const { envelope: withoutSecret } = splitWebhookSecret(wh as Record<string, unknown>);
  const { envelope } = splitWebhookHeaders(withoutSecret as Record<string, unknown>);
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
    definition_json: JSON.stringify(envelope),
  };
}
