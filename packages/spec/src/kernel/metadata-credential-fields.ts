// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Schema-declared credential fields, and the read-path redactor derived from
 * them (ruling B+ on #24966, recorded 6304303975).
 *
 * ## The rule this module carries
 *
 * Where a per-type behaviour is a function of the declared shape, the FACT is
 * declared on the schema and the behaviour is derived once, here — never a
 * per-type redaction function. A metadata type marks a field as a credential
 * with the repo's existing zod `.meta({ … })` convention:
 *
 *  - `.meta({ credential: 'value' })` — the field's value is one credential
 *    (`WebhookSchema.secret`). Its cleared form is the empty string.
 *  - `.meta({ credential: 'map' })` — the field is a map whose entries cannot
 *    be told apart, so the WHOLE map is the credential
 *    (`WebhookSchema.headers`). Its cleared form is the empty map.
 *
 * {@link getMetadataTypeRedactor} (`metadata-type-redaction.ts`) resolves, after
 * the explicit registrations and the built-ins, the redactor
 * {@link deriveCredentialRedactor} builds from the type's registered schema.
 * Any type that marks a field is therefore redacted on every meta read door
 * with nothing else to write.
 *
 * ## Dropped, not masked — and the cleared form served as written
 *
 * A marked field holding credential material is REMOVED from the served item
 * and named in `redactedKeys`, the posture of the `datasource` built-in and of
 * the `flow` projection: a mask is a non-blank string a later save would store
 * as the literal credential. Absence on the write path means "unchanged" — the
 * metadata protocol's generic carry-forward keeps the stored value for a save
 * that omits the key — so the cleared form (an empty string, an empty map) is
 * the one way to REMOVE a credential, and a stored cleared form is served as
 * written and not reported: it holds nothing, and a reader can tell "cleared"
 * from "withheld".
 *
 * ## What the walk reaches, and the guard beside it
 *
 * The walk reads the type's declared object shape and every nested object
 * shape below it (through optional / nullable / default / pipe / lazy
 * wrappers). It does not descend into arrays, unions or record values: a
 * position there has no single stable path, so a marker placed there could
 * not be honoured. `metadata-credential-fields.test.ts` is the fail-closed
 * half the datasource module asks for (`datasource-credential-redaction.ts`:
 * a positive marker under-redacts when an author forgets it): it reds on any
 * credential-named field the walk reaches that carries no marker and is on no
 * allow-list, and on any marker the walk cannot reach.
 *
 * Pure, no I/O, as the `MetadataTypeRedactor` contract requires: the input is
 * never mutated, and an item with nothing to withhold is returned by
 * reference.
 */

import type { MetadataRedactionResult, MetadataTypeRedactor } from './metadata-type-redaction';

/** The `.meta()` key that declares a field a credential. */
export const CREDENTIAL_FIELD_META_KEY = 'credential';

/** The marker's closed vocabulary: one credential value, or a credential map as a whole. */
export const CREDENTIAL_FIELD_KINDS = ['value', 'map'] as const;
export type CredentialFieldKind = (typeof CREDENTIAL_FIELD_KINDS)[number];

/** One field the walk reached: its item-relative path, its schema, and its marker if any. */
export interface DeclaredField {
  /** Item-relative key path (`['secret']`, `['external', 'credentialsRef']`). */
  path: string[];
  /** The field's schema as declared on its parent shape (wrappers included). */
  schema: unknown;
  /**
   * The raw `credential` marker value, when one is declared at any wrapper
   * level of the field. Not narrowed: the guard pins the vocabulary.
   */
  marker: unknown;
}

/** One marked field, as the derived redactor applies it. */
export interface CredentialFieldDeclaration {
  path: string[];
  kind: CredentialFieldKind;
}

interface ZodDefLike {
  type?: string;
  innerType?: unknown;
  in?: unknown;
  getter?: () => unknown;
  shape?: Record<string, unknown>;
}

/** The `_zod.def` of a schema, or `undefined` for anything that is not one. */
export function zodDefOf(schema: unknown): ZodDefLike | undefined {
  if (!schema || (typeof schema !== 'object' && typeof schema !== 'function')) return undefined;
  const internals = (schema as { _zod?: { def?: ZodDefLike } })._zod;
  return internals?.def;
}

/** Wrapper kinds whose `innerType` IS the field (a default or an optional changes no shape). */
const INNER_TYPE_WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional']);

/**
 * Every wrapper level of `schema`, outermost first, ending at the first node
 * that is not a wrapper. A pipe contributes its INPUT side (what an author
 * writes and what is stored); a lazy schema its resolved getter.
 */
export function wrapperChainOf(schema: unknown): unknown[] {
  const chain: unknown[] = [];
  let node = schema;
  for (let hops = 0; hops < 32 && node; hops += 1) {
    chain.push(node);
    const def = zodDefOf(node);
    if (!def) break;
    if (def.type && INNER_TYPE_WRAPPERS.has(def.type)) node = def.innerType;
    else if (def.type === 'pipe') node = def.in;
    else if (def.type === 'lazy' && typeof def.getter === 'function') node = def.getter();
    else break;
  }
  return chain;
}

/** The declared object shape under `schema`'s wrappers, or `undefined` when it is not an object. */
export function objectShapeOf(schema: unknown): Record<string, unknown> | undefined {
  const chain = wrapperChainOf(schema);
  const core = zodDefOf(chain[chain.length - 1]);
  return core?.type === 'object' && core.shape && typeof core.shape === 'object' ? core.shape : undefined;
}

/** The `credential` marker declared at any wrapper level of a field, outermost first. */
export function credentialMarkerOf(schema: unknown): unknown {
  for (const node of wrapperChainOf(schema)) {
    const read = (node as { meta?: () => Record<string, unknown> | undefined }).meta;
    if (typeof read !== 'function') continue;
    const meta = read.call(node);
    if (meta && Object.prototype.hasOwnProperty.call(meta, CREDENTIAL_FIELD_META_KEY)) {
      return meta[CREDENTIAL_FIELD_META_KEY];
    }
  }
  return undefined;
}

/**
 * Every field the derivation reaches: the declared object shape of `schema`
 * and each nested object shape below it. A MARKED field is a leaf — the walk
 * does not descend into it. A shape already on the current path is not
 * re-entered, so a recursive schema terminates.
 */
export function walkDeclaredFields(schema: unknown): DeclaredField[] {
  const out: DeclaredField[] = [];
  const visit = (node: unknown, prefix: string[], onPath: Set<Record<string, unknown>>): void => {
    const shape = objectShapeOf(node);
    if (!shape || onPath.has(shape)) return;
    onPath.add(shape);
    for (const [key, field] of Object.entries(shape)) {
      const path = [...prefix, key];
      const marker = credentialMarkerOf(field);
      out.push({ path, schema: field, marker });
      if (marker === undefined) visit(field, path, onPath);
    }
    onPath.delete(shape);
  };
  visit(schema, [], new Set());
  return out;
}

/**
 * The marked fields of `schema`, as the derived redactor applies them. A
 * marker outside the vocabulary is read as `value` unless the field is a
 * record — failing closed: the field is still withheld, and the guard reds on
 * the spelling.
 */
export function credentialFieldsOf(schema: unknown): CredentialFieldDeclaration[] {
  const fields: CredentialFieldDeclaration[] = [];
  for (const field of walkDeclaredFields(schema)) {
    if (field.marker === undefined || field.marker === false || field.marker === null) continue;
    const kind: CredentialFieldKind =
      field.marker === 'map' || (field.marker !== 'value' && isRecordSchema(field.schema)) ? 'map' : 'value';
    fields.push({ path: field.path, kind });
  }
  return fields;
}

/** Whether the field's core schema (under its wrappers) is a `z.record`. */
export function isRecordSchema(schema: unknown): boolean {
  const chain = wrapperChainOf(schema);
  return zodDefOf(chain[chain.length - 1])?.type === 'record';
}

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Whether `value` is the field's cleared form: it holds no credential, so it is served as written. */
function isClearedForm(kind: CredentialFieldKind, value: unknown): boolean {
  return kind === 'value' ? value === '' : isPlainRecord(value) && Object.keys(value).length === 0;
}

/** `item` with the key at `path` removed, copying each container on the way; the input is never touched. */
function withoutKeyAt(item: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  const [head, ...rest] = path as [string, ...string[]];
  if (rest.length === 0) {
    const { [head]: _withheld, ...kept } = item;
    return kept;
  }
  return { ...item, [head]: withoutKeyAt(item[head] as Record<string, unknown>, rest) };
}

/**
 * Build the read-path redactor a schema's markers declare, or `undefined` when
 * the schema marks nothing — which {@link getMetadataTypeRedactor} answers as
 * "no redactor, serve as is".
 */
export function deriveCredentialRedactor(schema: unknown): MetadataTypeRedactor | undefined {
  const fields = credentialFieldsOf(schema);
  if (fields.length === 0) return undefined;
  return (item: Record<string, unknown>): MetadataRedactionResult => {
    let served = item;
    const redactedKeys: string[] = [];
    for (const { path, kind } of fields) {
      let parent: unknown = served;
      for (const key of path.slice(0, -1)) parent = isPlainRecord(parent) ? parent[key] : undefined;
      if (!isPlainRecord(parent)) continue;
      const leaf = path[path.length - 1] as string;
      if (!Object.prototype.hasOwnProperty.call(parent, leaf)) continue;
      const value = parent[leaf];
      if (value === undefined || isClearedForm(kind, value)) continue;
      served = withoutKeyAt(served, path);
      redactedKeys.push(path.join('.'));
    }
    if (redactedKeys.length === 0) return { item, redactedKeys: [] };
    return { item: served, redactedKeys: redactedKeys.sort() };
  };
}

/** One derivation per schema identity: the walk runs once, not on every read. */
const DERIVED = new WeakMap<object, MetadataTypeRedactor | null>();

/** {@link deriveCredentialRedactor}, memoised on the schema's identity. */
export function derivedCredentialRedactorFor(schema: unknown): MetadataTypeRedactor | undefined {
  if (!schema || (typeof schema !== 'object' && typeof schema !== 'function')) return undefined;
  const key = schema as object;
  if (!DERIVED.has(key)) DERIVED.set(key, deriveCredentialRedactor(schema) ?? null);
  return DERIVED.get(key) ?? undefined;
}
