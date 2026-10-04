// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata Type → read-path redactor registry (#8300, the enabling half of
 * #8154's security invariant: stored credentials must never serve cleartext).
 *
 * Same shape and pattern as the two sibling registries in
 * `metadata-type-schemas.ts` (`registerMetadataTypeSchema` /
 * `registerMetadataTypeActions`): a built-in map, a runtime-extensible overlay,
 * one accessor, and a snapshot enumerator. It lives HERE — not in
 * `metadata-protocol` — because the type owners that must register a redactor
 * are service packages (`service-datasource` today, SSO next), and **no
 * service or connector package depends on `@objectstack/metadata-protocol`**
 * (measured in #8300; a registry there would be unreachable from every package
 * that must call it). `@objectstack/spec/kernel` is the seam every type owner
 * already imports.
 *
 * ## Consumer contract (#8154 — the metadata read path)
 *
 * Every metadata read exit that serves a stored body (`getMetaItems`,
 * `getMetaItem`, `getMetaItemLayered` in both layers) should resolve the
 * type's redactor with {@link getMetadataTypeRedactor} and apply it to each
 * item before serving. Two ordering rules the consumer owns, measured on
 * #8154:
 *
 *  - `_diagnostics` MUST be computed on the raw stored body BEFORE redaction —
 *    computing after flips `valid:false` → `valid:true` and destroys the
 *    migration-inventory badge.
 *  - The stored record is never mutated: a redactor is pure, and the connect
 *    path (or any other raw-record consumer) keeps reading cleartext exactly
 *    as before. Redaction is a read-path SERVING act.
 *
 * The write-path carry-forward (a redacted-body PUT must not persist credential
 * deletion) is also #8154's, deliberately not represented here.
 *
 * ## Why `datasource` is a BUILT-IN, not a plugin registration
 *
 * The obvious registration site — `DatasourceAdminServicePlugin.init`, where
 * the sibling `registerMetadataTypeActions` call lives — is measured
 * **fail-open** (#8300): that plugin is opt-in, while `sys_metadata` rows and
 * the `/meta` read exits exist without it, so a host storing datasource rows
 * without the plugin would serve cleartext *with the hook installed and
 * looking healthy*. The redaction derivation lives in this same package
 * (`data/datasource-credential-redaction.ts`), so the honest, non-opt-in
 * wiring is a built-in entry: present the moment this module loads, on every
 * composition that can serve a datasource row, with nothing to forget.
 */

import { redactDatasourceConfig } from '../data/datasource-credential-redaction';
import { PLURAL_TO_SINGULAR } from '../shared/metadata-collection.zod';
// [#21565] The family set and its predicate: declared in a leaf, re-exported below.
// [#21654] So is the one prescription a refusal of the family's reach ends on.
import {
  STORED_METADATA_BODY_OBJECTS,
  STORED_METADATA_BODY_PRESCRIPTION,
  isStoredMetadataBodyObject,
} from './stored-metadata-body-objects';

/** What a {@link MetadataTypeRedactor} returns: the servable item, and what was withheld. */
export interface MetadataRedactionResult {
  /** The item with credential material removed. A NEW object — never the input mutated. */
  item: Record<string, unknown>;
  /**
   * Dotted item-relative paths whose value was removed or rewritten
   * (e.g. `config.password`), sorted. `[]` means the redactor RAN and found
   * nothing to hide — distinguishable from "no redactor registered", which is
   * {@link getMetadataTypeRedactor} answering `undefined`. Serving this beside
   * the item is the difference between a caller that knows a credential is
   * being withheld and one that infers it from an absence.
   */
  redactedKeys: string[];
}

/**
 * A per-type read-path redactor: takes a stored metadata item body, returns
 * the servable projection of it. MUST be pure (no mutation of the input, no
 * I/O) — it runs on every read exit, against the raw stored body.
 */
export type MetadataTypeRedactor = (item: Record<string, unknown>) => MetadataRedactionResult;

/**
 * The built-in `datasource` redactor: redacts the driver `config` through the
 * one credential-key definition in `data/datasource-credential-redaction.ts`
 * (derived from each driver's `z.never()` contract + the pre-#8078 alias list
 * + turso's `encryptionKey`), and leaves every other key of the item —
 * `_diagnostics` included — byte-for-byte.
 */
function redactDatasourceItem(item: Record<string, unknown>): MetadataRedactionResult {
  const config = item.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { item, redactedKeys: [] };
  }
  const { config: redacted, redactedKeys } = redactDatasourceConfig(
    item.driver,
    config as Record<string, unknown>,
  );
  if (redactedKeys.length === 0) return { item, redactedKeys: [] };
  return {
    item: { ...item, config: redacted },
    redactedKeys: redactedKeys.map((key) => `config.${key}`),
  };
}

/**
 * Built-in mapping from metadata type identifier → its read-path redactor.
 * A type omitted here serves its stored body unredacted (most types hold no
 * secret). See the module note for why `datasource` is wired here rather than
 * registered from the opt-in admin plugin.
 */
const BUILTIN_METADATA_TYPE_REDACTORS: Record<string, MetadataTypeRedactor> = {
  datasource: redactDatasourceItem,
};

/** Runtime-extensible overlay populated via `registerMetadataTypeRedactor`. */
const EXTRA_METADATA_TYPE_REDACTORS = new Map<string, MetadataTypeRedactor>();

/**
 * Look up the read-path redactor for a metadata type.
 *
 * Returns the user-registered override if any, otherwise the built-in
 * redactor. Returns `undefined` for a type with no redactor — which the
 * consumer must treat as "serve as-is", never as an error: absence of a
 * registration is a fact about the type, not a failure.
 */
export function getMetadataTypeRedactor(type: string): MetadataTypeRedactor | undefined {
  return EXTRA_METADATA_TYPE_REDACTORS.get(type) ?? BUILTIN_METADATA_TYPE_REDACTORS[type];
}

/**
 * Register (or replace) the read-path redactor for a metadata type.
 *
 * A plugin whose metadata type stores secret material (an SSO seat storing
 * client secrets, a connector storing API keys) should call this from its
 * **`init(ctx)`** — the same site the sibling {@link
 * registerMetadataTypeSchema} documents — so every metadata read exit starts
 * withholding that material. Idempotent; a later registration for the same
 * type replaces the earlier one, built-ins included.
 *
 * ⚠️ Registering from an OPT-IN plugin protects only compositions that install
 * the plugin. If the type's rows can exist in `sys_metadata` without the
 * plugin (the #8300 datasource measurement), the redactor belongs in
 * `BUILTIN_METADATA_TYPE_REDACTORS` in this package instead — a redaction
 * that looks installed but isn't loaded is the worst available outcome,
 * because it reads as protected.
 */
export function registerMetadataTypeRedactor(type: string, redactor: MetadataTypeRedactor): void {
  EXTRA_METADATA_TYPE_REDACTORS.set(type, redactor);
}

/** Snapshot of every type that currently has a redactor (built-in + extras), sorted. */
export function listMetadataTypeRedactorTypes(): string[] {
  const types = new Set<string>(Object.keys(BUILTIN_METADATA_TYPE_REDACTORS));
  for (const t of EXTRA_METADATA_TYPE_REDACTORS.keys()) types.add(t);
  return Array.from(types).sort();
}

// ---------------------------------------------------------------------------
// Stored metadata ROWS — the family-wide definition of "this row holds a
// serialized metadata body", and the one redaction of that body (#21120)
// ---------------------------------------------------------------------------

/*
 * [#21120] The family set — `sys_metadata` / `sys_metadata_history`, the tables
 * whose `metadata` column stores one serialized metadata BODY — and its
 * membership predicate are declared in the leaf module
 * `./stored-metadata-body-objects` and re-exported here unchanged, so every
 * importer of this module and of `@objectstack/spec/kernel` receives the very
 * same objects. [#21565] They moved so that `data/hook.zod.ts` can judge a hook
 * target by the predicate without importing this module's closure; the leaf's
 * header says why. ⛔ Never restate the list here. [#21654] The prescription a
 * refusal of the family's reach ends on is re-exported beside them, for the
 * same reason: one sentence, imported wherever it is said.
 */
export { STORED_METADATA_BODY_OBJECTS, STORED_METADATA_BODY_PRESCRIPTION, isStoredMetadataBodyObject };

/** The column holding the serialized body, on every {@link STORED_METADATA_BODY_OBJECTS} member. */
export const STORED_METADATA_BODY_COLUMN = 'metadata';

/** The column naming the body's metadata type — what selects its redactor. */
export const STORED_METADATA_TYPE_COLUMN = 'type';

/**
 * Redact one stored metadata body VALUE (the `metadata` column), choosing the
 * redactor by `type` through {@link getMetadataTypeRedactor} — the single
 * credential definition every read exit shares.
 *
 * Returns the input BY REFERENCE when there is nothing to withhold: no
 * redactor for the type, a non-object body, or a redactor that found nothing.
 * Fails CLOSED on the two shapes it cannot judge, by returning `undefined`
 * (the caller withholds the body): a body whose type has a redactor but that
 * does not parse, and — because the column is serialized JSON (a `textarea`) —
 * a body that is a string naming a redacted type but will not parse. A body
 * whose type registers no redactor is served as stored, parseable or not,
 * because the absence of a redactor is a fact about the type.
 *
 * A string body is re-serialized only when a redaction actually happened, so a
 * clean row's stored bytes reach the caller unchanged.
 *
 * ⛔ A throwing redactor is NOT swallowed here: failing closed is the only
 * defensible answer for a security control, so a `catch` that served the
 * cleartext this function exists to withhold is deliberately absent.
 */
export function redactStoredMetadataBody(
  type: unknown,
  body: unknown,
): { ok: true; body: unknown } | { ok: false } {
  if (body === undefined || body === null) return { ok: true, body };
  if (typeof type !== 'string' || type === '') return { ok: false };
  const redactor = getMetadataTypeRedactor(PLURAL_TO_SINGULAR[type] ?? type);
  if (!redactor) return { ok: true, body };

  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return { ok: false };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: true, body };
  const result = redactor(parsed as Record<string, unknown>);
  if (!result || result.redactedKeys.length === 0) return { ok: true, body };
  const served = result.item;
  return { ok: true, body: typeof body === 'string' ? JSON.stringify(served) : served };
}

/**
 * Redact the stored metadata body column of one row of a
 * {@link STORED_METADATA_BODY_OBJECTS} table, in place of serving it raw. Every
 * other column is left as the engine returned it.
 *
 * A row the redactor cannot judge ({@link redactStoredMetadataBody} answering
 * `{ ok: false }`) has its body column OMITTED rather than served. Rows of any
 * object outside the set, and non-object rows, pass through unchanged — so this
 * is safe to call at a generic read exit without first checking the object.
 */
export function redactStoredMetadataRow<T>(object: string, row: T): T {
  if (!isStoredMetadataBodyObject(object) || !row || typeof row !== 'object' || Array.isArray(row)) {
    return row;
  }
  const record = row as Record<string, unknown>;
  if (!(STORED_METADATA_BODY_COLUMN in record)) return row;
  const outcome = redactStoredMetadataBody(record[STORED_METADATA_TYPE_COLUMN], record[STORED_METADATA_BODY_COLUMN]);
  if (outcome.ok) {
    if (outcome.body === record[STORED_METADATA_BODY_COLUMN]) return row;
    return { ...record, [STORED_METADATA_BODY_COLUMN]: outcome.body } as T;
  }
  const { [STORED_METADATA_BODY_COLUMN]: _withheld, ...rest } = record;
  return rest as T;
}

/** {@link redactStoredMetadataRow} over a list. Non-array input passes through. */
export function redactStoredMetadataRows<T>(object: string, rows: T[]): T[] {
  if (!Array.isArray(rows) || !isStoredMetadataBodyObject(object)) return rows;
  return rows.map((row) => redactStoredMetadataRow(object, row));
}
