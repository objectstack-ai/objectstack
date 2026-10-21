// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ruling B+ on #24966] The fail-closed guard beside the schema-derived
 * credential redactor (`metadata-credential-fields.ts`).
 *
 * A positive marker under-redacts when an author forgets it
 * (`data/datasource-credential-redaction.ts` says so of its own `format`
 * marker), so this ratchet reads every registered metadata-type schema and
 * reds when a field the derivation reaches READS as a credential and carries
 * no marker and is on no allow-list. Three more pins keep the marker honest:
 * the vocabulary is closed, a `map` marker sits on a record, and no marker sits
 * where the derivation cannot reach it.
 *
 * "Reads as a credential":
 *  - the field NAME, split into words, contains secret / password / passwd /
 *    token / signing / credential (or a plural), or `api` followed by `key`;
 *  - or the first sentence of its description contains one of those words;
 *  - and the field can hold a credential at all: a string, a record, a union,
 *    or an unknown. A number, a boolean, an enum or an array of non-strings
 *    holds no secret — `maxTokens` is a budget, not a token.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CREDENTIAL_FIELD_KINDS,
  credentialMarkerOf,
  isRecordSchema,
  walkDeclaredFields,
  wrapperChainOf,
  zodDefOf,
  type DeclaredField,
} from './metadata-credential-fields';
import {
  getMetadataTypeSchema,
  listMetadataTypeSchemaTypes,
  listUnregisteredKindSchemaTypes,
} from './metadata-type-schemas';

/**
 * The explicit allow-list: `type:dotted.path` → why the field is NOT a
 * credential although it reads as one. Shrink-only in spirit — an entry that
 * no longer matches a flagged field reds below, so the list cannot rot.
 */
const NOT_A_CREDENTIAL: Readonly<Record<string, string>> = {
  'datasource:external.credentialsRef':
    'a reference into the secrets store, never the credential itself (the schema says: never inline credentials)',
};

const CREDENTIAL_WORDS = new Set([
  'secret', 'secrets', 'password', 'passwords', 'passwd', 'token', 'tokens',
  'signing', 'credential', 'credentials',
]);
const DESCRIPTION_RULE = /\b(secrets?|passwords?|passwd|tokens?|signing|credentials?|api[ _-]?keys?)\b/i;
const CAN_HOLD_A_CREDENTIAL = new Set(['string', 'record', 'union', 'unknown', 'any', 'template_literal']);

const wordsOf = (key: string): string[] =>
  key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function nameReadsAsCredential(key: string): boolean {
  const words = wordsOf(key);
  return words.some((w, i) => CREDENTIAL_WORDS.has(w) || w === 'apikey' || (w === 'api' && /^keys?$/.test(words[i + 1] ?? '')));
}

function descriptionOf(schema: unknown): string {
  for (const node of wrapperChainOf(schema)) {
    const read = (node as { meta?: () => { description?: unknown } | undefined }).meta;
    const description = typeof read === 'function' ? read.call(node)?.description : undefined;
    if (typeof description === 'string' && description !== '') return description;
  }
  return '';
}

const firstSentence = (text: string): string => text.split(/(?<=[.;:])\s|\n/)[0] ?? '';

function coreKind(schema: unknown): string | undefined {
  const chain = wrapperChainOf(schema);
  return zodDefOf(chain[chain.length - 1])?.type;
}

/** The ratchet's verdict for one reached field: `true` when it reads as a credential. */
function readsAsCredential(field: DeclaredField): boolean {
  if (!CAN_HOLD_A_CREDENTIAL.has(coreKind(field.schema) ?? '')) return false;
  const key = field.path[field.path.length - 1] as string;
  return nameReadsAsCredential(key) || DESCRIPTION_RULE.test(firstSentence(descriptionOf(field.schema)));
}

/** Every unmarked, non-allow-listed field of `schema` that reads as a credential, as `type:path`. */
function unmarkedCredentialFields(type: string, schema: unknown, allow: Readonly<Record<string, string>>): string[] {
  return walkDeclaredFields(schema)
    .filter((field) => field.marker === undefined && readsAsCredential(field))
    .map((field) => `${type}:${field.path.join('.')}`)
    .filter((id) => !(id in allow));
}

/**
 * Every position of a `credential` marker anywhere under `schema` — arrays,
 * unions, record values, tuples and intersections included — as dotted paths
 * with `[]` for a hop the derivation does not take.
 */
function everyMarkerUnder(schema: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();
  const visit = (node: unknown, path: string): void => {
    if (!zodDefOf(node) || seen.has(node)) return;
    seen.add(node);
    if (path !== '' && credentialMarkerOf(node) !== undefined) found.push(path);
    const def = zodDefOf(node) as Record<string, unknown>;
    if (def.type === 'lazy' && typeof def.getter === 'function') {
      visit((def.getter as () => unknown)(), path);
      return;
    }
    if (def.type === 'object' && def.shape && typeof def.shape === 'object') {
      for (const [key, field] of Object.entries(def.shape as Record<string, unknown>)) visit(field, path ? `${path}.${key}` : key);
    }
    for (const [prop, child] of Object.entries(def)) {
      if (prop === 'shape') continue;
      const wrapper = ['innerType', 'in', 'out'].includes(prop);
      const children = Array.isArray(child) ? child : [child];
      for (const c of children) if (zodDefOf(c)) visit(c, wrapper ? path : `${path}[]`);
    }
  };
  visit(schema, '');
  return found;
}

const ALL_TYPES = [...listMetadataTypeSchemaTypes(), ...listUnregisteredKindSchemaTypes()].sort();

describe('[ruling B+ on #24966] ratchet: a field that reads as a credential carries the marker', () => {
  it('reads every registered metadata-type schema and the stack-collection kinds (webhook among them)', () => {
    expect(ALL_TYPES).toContain('webhook');
    expect(ALL_TYPES).toContain('datasource');
    for (const type of ALL_TYPES) expect(getMetadataTypeSchema(type), type).toBeDefined();
  });

  it('no registered schema has an unmarked credential-named field off the allow-list', () => {
    const findings = ALL_TYPES.flatMap((type) => unmarkedCredentialFields(type, getMetadataTypeSchema(type), NOT_A_CREDENTIAL));
    expect(findings, 'mark each with .meta({ credential: \'value\' | \'map\' }), or allow-list it with a reason').toEqual([]);
  });

  it('every allow-list entry still names a field the rule flags (the list cannot rot)', () => {
    const flagged = new Set(ALL_TYPES.flatMap((type) => unmarkedCredentialFields(type, getMetadataTypeSchema(type), {})));
    for (const id of Object.keys(NOT_A_CREDENTIAL)) expect(flagged.has(id), id).toBe(true);
  });

  it('the guard reds on a credential-named field without a marker, and passes once it is marked', () => {
    const unmarked = z.object({ name: z.string(), apiKey: z.string().optional(), nested: z.object({ hook: z.string().describe('Signing secret for the hook') }) });
    expect(unmarkedCredentialFields('zz_rule', unmarked, {})).toEqual(['zz_rule:apiKey', 'zz_rule:nested.hook']);
    const marked = z.object({
      name: z.string(),
      apiKey: z.string().optional().meta({ credential: 'value' }),
      nested: z.object({ hook: z.string().describe('Signing secret for the hook').meta({ credential: 'value' }) }),
    });
    expect(unmarkedCredentialFields('zz_rule', marked, {})).toEqual([]);
  });

  it('a budget is not a credential: a number named for tokens does not red', () => {
    expect(unmarkedCredentialFields('zz_rule', z.object({ maxTokens: z.number() }), {})).toEqual([]);
  });

  it('webhook marks secret as a value and headers as a whole map', () => {
    const marked = walkDeclaredFields(getMetadataTypeSchema('webhook'))
      .filter((f) => f.marker !== undefined)
      .map((f) => [f.path.join('.'), f.marker]);
    expect(Object.fromEntries(marked)).toEqual({ headers: 'map', secret: 'value' });
  });
});

describe('[ruling B+ on #24966] the marker is honest', () => {
  it('every marker uses the closed vocabulary, and a map marker sits on a record', () => {
    for (const type of ALL_TYPES) {
      for (const field of walkDeclaredFields(getMetadataTypeSchema(type))) {
        if (field.marker === undefined) continue;
        const id = `${type}:${field.path.join('.')}`;
        expect(CREDENTIAL_FIELD_KINDS as readonly unknown[], id).toContain(field.marker);
        expect(isRecordSchema(field.schema), id).toBe(field.marker === 'map');
      }
    }
  });

  it('no marker sits where the derivation cannot reach it (inside an array, a union or a record value)', () => {
    const unreachable = ALL_TYPES.flatMap((type) =>
      everyMarkerUnder(getMetadataTypeSchema(type)).filter((p) => p.includes('[]')).map((p) => `${type}:${p}`));
    expect(unreachable).toEqual([]);
  });

  it('the reach probe itself finds a marker the derivation would miss', () => {
    const schema = z.object({ items: z.array(z.object({ key: z.string().meta({ credential: 'value' }) })) });
    expect(everyMarkerUnder(schema)).toEqual(['items[].key']);
    expect(walkDeclaredFields(schema).filter((f) => f.marker !== undefined)).toEqual([]);
  });
});
