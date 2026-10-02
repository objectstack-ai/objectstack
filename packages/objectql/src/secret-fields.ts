// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Credential-field channels — helpers for the `secret` and `password` FieldTypes.
 *
 * A `secret` field (DB password, API key, token) is **reversible**: the engine
 * encrypts it on write via the registered `ICryptoProvider`, persists the
 * ciphertext as a `sys_secret` row, and stores only an opaque *ref* on the
 * business row. On read the ref is masked, never the plaintext. This mirrors
 * the Settings subsystem (`sys_setting.value_enc → sys_secret.id`), generalized
 * to object fields.
 *
 * A `password` field on a **generic** (non-`better-auth`) object is **plaintext
 * at rest** but **masked on read** — the engine stores the value verbatim (no
 * encryption, no `sys_secret` row) yet returns {@link SECRET_MASK} through the
 * normal query path, so cleartext never leaves the engine. This closes #2036,
 * where a `password` field round-tripped plaintext. See ADR-0100. The two types
 * share only the read mask ({@link collectMaskedReadFields}); their write paths
 * differ (secret encrypts, password is left untouched).
 *
 * The auth subsystem's own credentials are a third, separate channel: better-auth
 * one-way hashes them into identity tables (`sys_account.password`, a hashed
 * `text` column) off the generic CRUD path. Objects it owns carry
 * `managedBy: 'better-auth'` and are exempt from password masking so login reads
 * still see the stored hash.
 *
 * [#7728] That third channel had **no read protection at all**, and the reason is
 * structural rather than an oversight in the exemption: the two collectors above
 * key off the field **TYPE**, so a `text` column is never collected *regardless*
 * of `managedBy` — the better-auth exemption is the second barrier, not the
 * first. Retyping is not the fix either, because `secret` rewrites the column to
 * a `sys_secret` ref (destroying the `where: { key: <hash> }` lookup the API-key
 * verifier depends on) and `password` is declared plaintext-at-rest, which a
 * one-way hash is not. So the channel gets its own opt-in, type-independent
 * declaration — the `internal` field flag ({@link collectInternalReadFields}),
 * which OMITS rather than masks. See ADR-0100 / ADR-0049 and the maintainer
 * ruling of 2026-08-12 on #7728.
 */

import { isMaskedOnReadFieldType, type ServiceObject } from '@objectstack/spec/data';

/**
 * Prefix marking a persisted field value as a `sys_secret` handle ref rather
 * than cleartext. Chosen to be unambiguous and human-greppable in a DB dump,
 * while making it obvious that the column holds no plaintext.
 */
export const SECRET_REF_PREFIX = 'secret:';

/**
 * Value returned in place of a secret field on a normal read. Indicates
 * "a secret is set" without leaking the handle id or the plaintext. A field
 * with no stored secret resolves to `null` instead.
 *
 * Declared in `@objectstack/spec` and re-exported here (#7572), because the
 * same mask is the contract on a second surface this package cannot see: the
 * settings REST read boundary in `@objectstack/service-settings`, which is
 * deliberately framework-agnostic and does not depend on objectql. Two
 * byte-identical literals bound by convention were what #7572 removed — the
 * re-export keeps this package's public API unchanged while leaving exactly one
 * definition. ⛔ Do not restate the literal here; edit it in
 * `spec/src/data/secret-mask.ts`, where it is pinned.
 */
export { SECRET_MASK } from '@objectstack/spec/data';

/** Wrap a `sys_secret` handle id as the opaque ref persisted on the row. */
export function makeSecretRef(handleId: string): string {
  return `${SECRET_REF_PREFIX}${handleId}`;
}

/** True when `value` is a secret ref previously produced by {@link makeSecretRef}. */
export function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SECRET_REF_PREFIX);
}

/** Extract the `sys_secret` handle id from a ref, or `null` when not a ref. */
export function parseSecretRef(value: unknown): string | null {
  return isSecretRef(value) ? (value as string).slice(SECRET_REF_PREFIX.length) : null;
}

/**
 * Collect the names of `secret`-typed fields declared on an object schema.
 * Returns an empty array when the schema has no fields or no secret fields —
 * callers can fast-path on `length === 0` to skip all crypto work.
 */
export function collectSecretFields(schema: ServiceObject | undefined | null): string[] {
  const fields = (schema as any)?.fields as Record<string, { type?: string }> | undefined;
  if (!fields) return [];
  const out: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (def && def.type === 'secret') out.push(name);
  }
  return out;
}

/**
 * [#8559] The ADR-0112 pair carried by the refusal to write `""` into a
 * credential field. `VALIDATION_ERROR` is the standard-catalog member for a
 * generic 400 — the caller's payload is wrong and the caller can fix it —
 * so no ledger registration is needed. Exported so consumers branch on
 * `code`/`status` rather than on message text, exactly like the webhook
 * seam's refusal pair (`plugin-webhooks/src/webhook-secret.ts`).
 */
export const EMPTY_CREDENTIAL_REFUSAL_CODE = 'VALIDATION_ERROR';
export const EMPTY_CREDENTIAL_REFUSAL_STATUS = 400;

/**
 * [#8559] Refusal to persist the empty string into a `secret`- or
 * `password`-typed field (maintainer ruling 2026-08-13 on #8559: option 2 —
 * loud refusal over silent reinterpretation).
 *
 * ## Why `""` is refused rather than stored or reinterpreted
 * `null` already has a defined meaning on the credential write path — clear
 * the stored value — and `""` is neither that nor a storable credential:
 *
 *  - **`secret`**: encrypting `""` mints a real `sys_secret` row whose
 *    ciphertext decrypts to nothing, and rewrites the column to a perfectly
 *    valid `secret:` ref. From then on every read path reports "a secret is
 *    set" ({@link SECRET_MASK}) while the dereference returns nothing — the
 *    contradictory state #8542/#8558 had to defend consumers against.
 *  - **`password`**: storing `""` verbatim produces the same contradiction
 *    without the cipher row — a non-null stored value masks on every read as
 *    "a password is set" while the credential has no content.
 *
 * Folding `""` into the `null` branch (option 1) was explicitly rejected: it
 * silently rewrites the caller's intent, and a caller that meant something
 * else learns nothing. The refusal names the correct spelling instead.
 *
 * Carries the ADR-0112 pair as fields so consumers branch on `code`/`status`
 * rather than message text; the message is located (`object.field`) and names
 * `null` as the way to clear — both halves are contract, pinned in
 * `secret-fields.test.ts`.
 */
export class EmptyCredentialWriteError extends Error {
  readonly code = EMPTY_CREDENTIAL_REFUSAL_CODE;
  readonly status = EMPTY_CREDENTIAL_REFUSAL_STATUS;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = EMPTY_CREDENTIAL_REFUSAL_STATUS;
  readonly object: string;
  readonly field: string;
  readonly fieldType: 'secret' | 'password';
  constructor(object: string, field: string, fieldType: 'secret' | 'password') {
    const consequence =
      fieldType === 'secret'
        ? 'persisting it would mint a sys_secret row whose ciphertext decrypts to nothing while every read path reports a value is set'
        : 'persisting it would store an empty credential that every read path reports as set';
    super(
      `Empty string refused for ${fieldType} field "${object}.${field}": `
        + `"" is not a storable ${fieldType} — ${consequence}. `
        + `To clear the stored ${fieldType}, write null; to leave it unchanged, omit the field.`,
    );
    this.name = 'EmptyCredentialWriteError';
    this.object = object;
    this.field = field;
    this.fieldType = fieldType;
  }
}

/**
 * Collect the names of fields that must be masked to {@link SECRET_MASK} on the
 * generic read path: every `secret` field, plus every `password` field — the
 * latter only when the object is **not** `managedBy: 'better-auth'`.
 *
 * [#20141] That sentence DESCRIBES the answer; it does not decide it. Which
 * types are masked, and which `managedBy` buckets exempt which type, is declared
 * once in `@objectstack/spec/data` (`MASKED_ON_READ_FIELD_TYPES`, read through
 * `isMaskedOnReadFieldType`), and this collector asks that predicate per field.
 * objectui keeps its interim `MASKED_FIELD_TYPES` copy until its own re-bind
 * card lands; after that it reads this same declaration, and the server's mask
 * and the client's cannot drift apart. ⛔ Do not add a `def.type === …` arm
 * here: a type masked here and not in the declaration is a second copy, and
 * once the renderer derives it is a field masked by the server and drawn in
 * clear by the client. Change the declaration instead; the table test in
 * `secret-fields.test.ts` pins every `FieldType × managedBy` answer.
 *
 * The better-auth exemption is deliberate: the auth subsystem reads its identity
 * rows through the engine's find/findOne, and masking a credential column there
 * would break login. Today no identity object even declares a `password`-typed
 * field (`sys_account.password` is a hashed `text` column), but the guard keeps
 * masking safe if that ever changes. See ADR-0100.
 *
 * Returns an empty array when the schema has no fields or no maskable fields, so
 * callers can fast-path on `length === 0`.
 */
export function collectMaskedReadFields(schema: ServiceObject | undefined | null): string[] {
  const fields = (schema as any)?.fields as Record<string, { type?: string }> | undefined;
  if (!fields) return [];
  const managedBy: unknown = (schema as any)?.managedBy;
  const out: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (def && isMaskedOnReadFieldType(def.type, managedBy)) out.push(name);
  }
  return out;
}

/**
 * [#8559] Collect the names of `password`-typed fields on a **generic**
 * (non-`better-auth`) object — exactly the `password` half of
 * {@link collectMaskedReadFields}, kept beside it so the two cannot drift.
 * [#20141] It asks the same spec predicate (`isMaskedOnReadFieldType`) for the
 * exemption rather than restating it, so "the password fields that are masked"
 * has one answer; the `'password'` arm is this collector's own scope, not a
 * copy of the masked set.
 *
 * This is the scope of the empty-string refusal's `password` arm
 * ({@link EmptyCredentialWriteError}): the ruling covers the fields that share
 * the read mask and the echoed-mask drop with `secret`, because the
 * contradiction being refused ("reads as set, holds nothing") only exists
 * where the mask does. A `managedBy: 'better-auth'` object's password column
 * is not masked on read, is owned by the auth subsystem's own write path, and
 * is deliberately not judged here — same exemption, same reason, as the read
 * mask's.
 *
 * Returns an empty array when the schema has no such fields, so callers can
 * fast-path on `length === 0`.
 */
export function collectMaskedPasswordFields(schema: ServiceObject | undefined | null): string[] {
  const fields = (schema as any)?.fields as Record<string, { type?: string }> | undefined;
  if (!fields) return [];
  const managedBy: unknown = (schema as any)?.managedBy;
  const out: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (def && def.type === 'password' && isMaskedOnReadFieldType(def.type, managedBy)) out.push(name);
  }
  return out;
}

/**
 * [#7728] Collect the names of fields declared `internal: true` — "the declared
 * value is never returned on the generic data path".
 *
 * Three differences from {@link collectMaskedReadFields}, all deliberate:
 *
 *  - **It collects by FLAG, not by TYPE.** That is the whole point: the columns
 *    this protects are one-way hashes living in `text` columns, which no
 *    type-keyed collector can ever reach.
 *  - **No `managedBy` exemption.** The password exemption exists so login reads
 *    still see the stored hash; `internal` is opt-in *per field*, so an object
 *    that needs a column readable simply does not flag it. An exemption here
 *    would silently disable the flag on exactly the identity objects it was
 *    minted for.
 *  - **The read-path caller OMITS the key rather than masking it** (see
 *    {@link SECRET_MASK}). The mask signals "a value is set"; on a `required`
 *    column that is zero bits of information, and shipping it would still put a
 *    value under a field whose declaration promises none.
 *
 * [#7922] The read path is not the only consumer. `aggregate()` cannot omit —
 * a flagged column reached through `groupBy` is already the group KEY, and
 * masking keys corrupts the result — so the aggregate gate unions this collector
 * with {@link collectCredentialFields} and REFUSES the query instead. Same
 * question, two answers, because the two surfaces have different options.
 *
 * Returns an empty array when the schema has no fields or none are flagged, so
 * callers can fast-path on `length === 0`.
 */
export function collectInternalReadFields(schema: ServiceObject | undefined | null): string[] {
  const fields = (schema as any)?.fields as Record<string, { internal?: unknown }> | undefined;
  if (!fields) return [];
  const out: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (def && def.internal === true) out.push(name);
  }
  return out;
}

/**
 * Collect the names of every credential-bearing field on an object — `secret`
 * OR `password` — **unconditionally**, ignoring `managedBy`.
 *
 * This differs from {@link collectMaskedReadFields} on purpose. Read-masking
 * exempts `password` on `managedBy: 'better-auth'` objects so login reads still
 * see the stored value; but *aggregating* a credential field must never be
 * allowed, even on a better-auth object — a GROUP BY / MIN / MAX over a password
 * column is an inference oracle regardless of who owns the table. So the
 * aggregate-rejection gate keys off this stricter, exemption-free collector,
 * keeping the two concerns independent (they must not drift). See ADR-0100 / #3171.
 *
 * [#7922] This is the **type-keyed half** of what that gate refuses. Being
 * type-keyed it cannot see ADR-0100's third channel — a one-way hash in a `text`
 * column — so the gate unions it with {@link collectInternalReadFields}, the
 * flag-keyed half. ⛔ Do not collapse the two by widening either one — they
 * answer different questions ("is this a credential type?" vs "is this field
 * declared unreturnable?") and their other consumers respond differently: the
 * read path MASKS a credential type and OMITS a flagged field. Compose at the
 * call site, which is what the gate does.
 *
 * Returns an empty array when the schema has no fields or no credential fields,
 * so callers can fast-path on `length === 0`.
 */
export function collectCredentialFields(schema: ServiceObject | undefined | null): string[] {
  const fields = (schema as any)?.fields as Record<string, { type?: string }> | undefined;
  if (!fields) return [];
  const out: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (def && (def.type === 'secret' || def.type === 'password')) out.push(name);
  }
  return out;
}

/**
 * The engine surface {@link readInternalColumn} needs: the registered schema
 * (to know whether the strip ran) and the privileged accessor (to recover the
 * value). Duck-typed so a consumer holding only an engine-shaped handle — a
 * plugin's own engine interface, a host's resolved service — can call it.
 */
export interface InternalColumnSource {
  getSchema?(object: string): ServiceObject | undefined | null;
  resolveInternalField?(object: string, recordIds: readonly string[], field: string): Promise<Map<string, unknown>>;
}

/**
 * [#21197] Read ONE `internal: true` column for rows a generic engine read
 * handed back — one value per row, in the rows' order (`null` where the column
 * is unset).
 *
 * The read path omits a flagged column from every row it returns, system
 * context included (no carve-out, #7728). A consumer that genuinely needs the
 * stored value back for its OWN purpose-built route — a share link's password
 * gate, a redemption probe — gets it through the engine's privileged accessor
 * ({@link InternalColumnSource.resolveInternalField}, #8118). This is that
 * dereference, written once so no consumer re-derives it:
 *
 *  - a row that still CARRIES the column answers from the row (an engine that
 *    does not strip, e.g. a test double);
 *  - otherwise whether a missing key means "stripped" or "unset" is read off
 *    the SAME declaration the strip keys on — {@link collectInternalReadFields}
 *    over the engine's registered schema. An engine whose registered object
 *    does not declare the column `internal` cannot have stripped it, so the key
 *    is unset;
 *  - otherwise the value is recovered through the accessor, one batched read.
 *
 * ⛔ FAIL-CLOSED. When the declaration says the strip ran and the value cannot
 * be recovered — no accessor, or a row with no id — this THROWS instead of
 * answering "unset". For a gate column "unset" usually means "no gate" (a share
 * link's password hash: unset is "no password"), so a degraded answer would
 * open what the column exists to close, silently. A caller surfaces the throw
 * as a refused request, never as an open one.
 *
 * Not a generic read bypass: it recovers ONLY a declared `internal` column, for
 * rows the caller already holds — the accessor itself refuses any other field
 * (ADR-0112 `INVALID_FIELD`).
 */
export async function readInternalColumn(
  engine: InternalColumnSource,
  object: string,
  rows: readonly Record<string, unknown>[],
  field: string,
): Promise<unknown[]> {
  const out: unknown[] = rows.map((row) =>
    row && typeof row === 'object' && field in row ? (row[field] ?? null) : undefined,
  );
  const missing = out.flatMap((v, i) => (v === undefined ? [i] : []));
  if (missing.length === 0) return out;

  if (!collectInternalReadFields(engine.getSchema?.(object)).includes(field)) {
    return out.map((v) => (v === undefined ? null : v));
  }

  const refuse = (why: string): never => {
    throw new Error(
      `${object} rows were read back without '${field}' (the engine's \`internal: true\` strip ran) `
        + `but ${why}, so the route that asked cannot answer and refuses. Wire the ObjectQL engine, `
        + 'which provides the `resolveInternalField` accessor beside the strip.',
    );
  };
  const resolve = engine.resolveInternalField;
  if (typeof resolve !== 'function') return refuse('this engine offers no accessor to recover it');
  const ids = missing.map((i) => {
    const id = rows[i]?.id;
    if (typeof id !== 'string' && typeof id !== 'number') refuse('a row carries no id to recover it by');
    return String(id);
  });
  const values = await resolve.call(engine, object, ids, field);
  // A row deleted between the read and the dereference reads as unset; the
  // caller treats it as the gone record it is.
  missing.forEach((rowIndex, k) => {
    out[rowIndex] = values.get(ids[k]) ?? null;
  });
  return out;
}
