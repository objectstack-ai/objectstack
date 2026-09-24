// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The retired cleartext credential location: `sys_webhook.definition_json`'s
 * `secret` and `headers` keys. Refused at BOTH doors — the write door (an
 * engine hook, below) and the delivery door (`AutoEnqueuer.attachSecret` /
 * `attachHeaders`).
 *
 * ## What changed
 * Before this file the two keys were retired for WRITES by the seeder only:
 * `bootstrapDeclaredWebhooks` splits them into the encrypted `signing_secret`
 * / `headers_secret` columns, and the boot sweep `migrateLegacyWebhookSecrets`
 * moves any row still carrying them. But the READ path kept honouring a row the
 * sweep had not converted — it warned and then delivered with the cleartext —
 * and nothing at the data API parsed the blob's CONTENT, so a raw
 * `PATCH /api/v1/data/sys_webhook` could type a bearer token straight back
 * into a textarea that `GET` returns in full to every persona that can read the
 * object. Warn-and-accept is declared-but-not-enforced: an author (human or
 * AI) who puts `Authorization: Bearer …` there gets a working delivery and a
 * warning nobody reads.
 *
 * Maintainer ruling (2026-09-23): refuse it now, on the 17.x line, with no
 * transition path for a deployment that has no `CryptoProvider` — 「不考虑旧的」.
 * So:
 *
 *  - **write door** — a `sys_webhook` insert/update whose `definition_json`
 *    carries either key is refused with a located ADR-0112
 *    `VALIDATION_ERROR`/400, while the author is still standing there;
 *  - **delivery door** — a row whose ONLY copy of a credential is the legacy
 *    key is PARKED, exactly like a row whose encrypted credential cannot be
 *    recovered: nothing is sent, every matching event is recorded as a dead
 *    `sys_http_delivery` row carrying the refusal, and the drop is reported
 *    once at `error`.
 *
 * `readLegacySecret` / `readLegacyHeaders` stay: the boot sweep is their other
 * caller, and it is the remedy this refusal names.
 *
 * ## ⛔ The refusal never echoes a value
 * Key NAMES only. The whole point is that these values are credentials; a
 * diagnostic that quoted one would print it into logs, HTTP error bodies and
 * `sys_http_delivery.error` — the exposure this retires, moved one layer over.
 */

import { WEBHOOK_OBJECT, WEBHOOK_SECRET_FIELD } from './webhook-secret.js';
import { WEBHOOK_HEADERS_FIELD } from './webhook-headers.js';

/**
 * The date the legacy location stopped being honoured, carried in every
 * refusal so an operator reading a parked row or a 400 can date the behaviour
 * change without a changelog. It is the maintainer ruling's date: the boot
 * sweep that migrates these rows had already shipped, so a row still carrying
 * the legacy shape by then is one the sweep could not convert (no
 * `CryptoProvider`) or one written back in by hand.
 */
export const LEGACY_CLEARTEXT_RETIRED_ON = '2026-09-23';

/** The column the retired keys live inside. */
export const WEBHOOK_DEFINITION_FIELD = 'definition_json';

/**
 * ADR-0112 envelope for both doors. `VALIDATION_ERROR`/400 is the standard
 * catalog member for "this payload is not acceptable" — the same pair the
 * `headers_secret` shape gate carries at the same door, so a client branching
 * on `code`/`status` handles every malformed webhook credential write alike.
 * The delivery door carries the same pair because it is the same verdict on the
 * same row content, judged later. A standard-catalog code needs no ledger entry.
 */
export const LEGACY_CLEARTEXT_REFUSAL_CODE = 'VALIDATION_ERROR';
export const LEGACY_CLEARTEXT_REFUSAL_STATUS = 400;

/** The retired keys, and the encrypted column each one moved to. */
export const LEGACY_DEFINITION_CREDENTIAL_KEYS = {
  secret: WEBHOOK_SECRET_FIELD,
  headers: WEBHOOK_HEADERS_FIELD,
} as const;

export type LegacyDefinitionCredentialKey = keyof typeof LEGACY_DEFINITION_CREDENTIAL_KEYS;

const NOUN: Record<LegacyDefinitionCredentialKey, string> = {
  secret: 'signing secret',
  headers: 'custom header map',
};

/** Which door refused — only the framing sentence differs between them. */
export type LegacyCleartextDoor = 'write' | 'delivery';

function describeKeys(keys: readonly LegacyDefinitionCredentialKey[]): string {
  return keys.map((k) => `"${k}" (the ${NOUN[k]})`).join(' and ');
}

function remedy(keys: readonly LegacyDefinitionCredentialKey[]): string {
  const moves = keys
    .map((k) => `the ${NOUN[k]} into ${LEGACY_DEFINITION_CREDENTIAL_KEYS[k]}`)
    .join(' and ');
  return (
    `Fix: write ${moves} — encrypted columns whose every read returns only a mask — and remove `
    + `${keys.map((k) => `"${k}"`).join(' and ')} from ${WEBHOOK_DEFINITION_FIELD}. Rows written before `
    + 'the move are converted for you by the boot sweep migrateLegacyWebhookSecrets, which runs at '
    + 'every start but only converts a row when a CryptoProvider is registered '
    + '(engine.setCryptoProvider — LocalCryptoProvider in dev, KMS/Vault in production); without one '
    + 'it leaves the row as it was.'
  );
}

/**
 * The refusal, as an ADR-0112-shaped error: `code` + `status` + the location
 * (`object` / `field`) + which retired `keys` were found, as fields — a
 * consumer branches on those, never on the message text.
 */
export class WebhookLegacyCleartextError extends Error {
  readonly code = LEGACY_CLEARTEXT_REFUSAL_CODE;
  readonly status = LEGACY_CLEARTEXT_REFUSAL_STATUS;
  readonly object: string;
  readonly field = WEBHOOK_DEFINITION_FIELD;
  readonly keys: readonly LegacyDefinitionCredentialKey[];
  readonly door: LegacyCleartextDoor;

  constructor(
    door: LegacyCleartextDoor,
    keys: readonly LegacyDefinitionCredentialKey[],
    opts: { object?: string; webhook?: string } = {},
  ) {
    const object = opts.object ?? WEBHOOK_OBJECT;
    const where = `${object}.${WEBHOOK_DEFINITION_FIELD}`;
    const retired =
      `That location was RETIRED on ${LEGACY_CLEARTEXT_RETIRED_ON} and is no longer honoured: `
      + `${WEBHOOK_DEFINITION_FIELD} is an ordinary textarea returned in full by the generic data API `
      + `(GET /api/v1/data/${object}), so a credential there is readable by every persona that can `
      + 'read the object.';
    const framing =
      door === 'write'
        ? `Webhook write refused: "${where}" carries ${describeKeys(keys)}. ${retired} `
          + 'This is refused at the write door because the delivery path refuses it too — a row '
          + 'stored in this shape would not deliver.'
        : `Webhook '${opts.webhook ?? '(unnamed)'}' REFUSED: "${where}" still carries `
          + `${describeKeys(keys)} as CLEARTEXT, and no encrypted copy is stored. ${retired} The `
          + 'subscription is PARKED — this event was NOT delivered; it is recorded in '
          + 'sys_http_delivery as a dead row with 0 attempts, and it cannot be redelivered.';
    super(`${framing} ${remedy(keys)}`);
    this.name = 'WebhookLegacyCleartextError';
    this.object = object;
    this.keys = keys;
    this.door = door;
  }
}

/**
 * Which retired keys a `definition_json` payload value carries.
 *
 * Judges key PRESENCE, not whether the value would have been usable: the
 * location is retired, so `"headers": {}` or `"secret": ""` teaches the next
 * reader the same wrong thing a real token does. An own property whose value
 * is `undefined` is absent (that is what `JSON.stringify` makes of it).
 *
 * A string that is not JSON, or JSON that is not an object, carries no key —
 * this is a verdict on the credential location, not a second validator of the
 * envelope.
 */
export function findLegacyDefinitionCredentialKeys(
  definitionJson: unknown,
): LegacyDefinitionCredentialKey[] {
  let parsed: unknown = definitionJson;
  if (typeof definitionJson === 'string') {
    if (definitionJson.length === 0) return [];
    try {
      parsed = JSON.parse(definitionJson);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;
  return (Object.keys(LEGACY_DEFINITION_CREDENTIAL_KEYS) as LegacyDefinitionCredentialKey[]).filter(
    (k) => Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined,
  );
}

/**
 * The write-door verdict, as a pure function of the write payload. Passes, or
 * throws {@link WebhookLegacyCleartextError}. Omitting `definition_json` leaves
 * the stored blob unchanged and passes.
 */
export function assertNoLegacyDefinitionCredentials(
  data: Record<string, unknown> | null | undefined,
  object: string = WEBHOOK_OBJECT,
): void {
  if (!data || typeof data !== 'object') return;
  if (!Object.prototype.hasOwnProperty.call(data, WEBHOOK_DEFINITION_FIELD)) return;
  const keys = findLegacyDefinitionCredentialKeys(data[WEBHOOK_DEFINITION_FIELD]);
  if (keys.length > 0) throw new WebhookLegacyCleartextError('write', keys, { object });
}

/** Minimal engine surface this binding needs — mirrors the headers shape gate. */
interface MinimalEngine {
  registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void;
  unregisterHooksByPackage(packageId: string): number;
}

interface MinimalLogger {
  info?: (msg: string, meta?: Record<string, any>) => void;
}

export const WEBHOOK_LEGACY_CLEARTEXT_GATE_PACKAGE = 'plugin-webhooks:legacy-cleartext-gate';

/** Same priority as the headers shape gate: refuse before anything spends work. */
const GATE_PRIORITY = 50;

/**
 * Bind the write door on `sys_webhook` insert and update.
 *
 * ⛔ Deliberately NOT exempt for `isSystem`: this is a verdict on a payload, and
 * a system writer that put a credential back into the blob would re-open the
 * exposure just the same. The plugin's own writers pass by construction — the
 * seeder serializes the envelope after `splitWebhookSecret` /
 * `splitWebhookHeaders`, and the boot sweep writes the blob with both keys
 * stripped in the same update that stores the encrypted copies.
 *
 * Registered in CODE, so an import run with automations switched off cannot
 * suppress it (the engine only skips metadata-bound hooks).
 */
export function bindWebhookLegacyCleartextGate(engine: MinimalEngine, logger?: MinimalLogger): void {
  if (typeof engine?.registerHook !== 'function') return;

  const handler = (ctx: any) => {
    assertNoLegacyDefinitionCredentials(ctx?.input?.data as Record<string, unknown> | undefined);
  };

  for (const event of ['beforeInsert', 'beforeUpdate'] as const) {
    engine.registerHook(event, handler, {
      object: WEBHOOK_OBJECT,
      packageId: WEBHOOK_LEGACY_CLEARTEXT_GATE_PACKAGE,
      priority: GATE_PRIORITY,
    });
  }

  logger?.info?.(
    '[webhook] definition_json legacy-credential gate bound (refuses "secret" / "headers" in the blob)',
  );
}

/** Remove the gate — for the plugin's `destroy()`. */
export function unbindWebhookLegacyCleartextGate(engine: MinimalEngine): void {
  if (typeof engine?.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(WEBHOOK_LEGACY_CLEARTEXT_GATE_PACKAGE);
  }
}
