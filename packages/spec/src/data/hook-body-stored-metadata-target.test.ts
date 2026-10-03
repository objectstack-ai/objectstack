// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21565] `HookSchema` refuses a hook `body` bound to a table of stored
 * metadata — the authoring half of #21520's ruling A, whose runtime half
 * (`hookBodyRunnerFactory`) refuses the same hook at registration.
 *
 * The refused set must be EXACTLY the runtime bind's, read from
 * `storedMetadataBodyHookBindingRefusal` (`packages/runtime/src/
 * stored-metadata-body-boundary.ts`): a hook carrying a `body` (any form)
 * whose `object` names a family table, as the string or as any list member,
 * judged by `isStoredMetadataBodyObject`. Not wider — a code `handler` and the
 * wildcard `'*'` parse — and not narrower — one family member in a list
 * refuses the hook, whatever else the list names.
 *
 * Accepted fixtures are compared against their expected parse output by
 * serialized bytes, so the check is proven to add no transformation.
 */

import { describe, expect, it } from 'vitest';
import { isStoredMetadataBodyObject, STORED_METADATA_BODY_OBJECTS } from '../kernel/metadata-type-redaction';
import * as leaf from '../kernel/stored-metadata-body-objects';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ArtifactStagePackageBodySchema, defineStack } from '../stack.zod';
import { defineHook, HookSchema } from './hook.zod';

const ENTRY_ID = 'hook-body-stored-metadata-target-refused';
const PRESCRIPTION_OPENING = 'Change metadata through the metadata API (`PUT /api/v1/meta/:type/:name`, the metadata protocol)';
const FAMILY = [...STORED_METADATA_BODY_OBJECTS];

const JS_BODY = { language: 'js', source: 'ctx.input.status = "seen";' } as const;
const EXPRESSION_BODY = { language: 'expression', source: 'true' } as const;

/** The defaults `HookSchema` fills in — the whole of what a parse adds to an accepted hook. */
const DEFAULTS = { priority: 100, async: false, onError: 'abort', runAs: 'inherit' } as const;

const hook = (object: string | string[], extra: Record<string, unknown> = { body: JS_BODY }) => ({
  name: 'stamp_status',
  object,
  events: ['beforeInsert'],
  ...extra,
});

interface IssueSig { code: string; path: string; message: string }

function refusalOf(input: unknown): IssueSig[] {
  const r = HookSchema.safeParse(input);
  expect(r.success, 'expected the parse to refuse this hook').toBe(false);
  return r.success ? [] : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
}

/** An accepted hook parses to exactly its input plus the schema defaults, byte for byte. */
function expectAcceptedUnchanged(input: Record<string, unknown>, expected: Record<string, unknown>): void {
  const r = HookSchema.safeParse(input);
  expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
  if (r.success) expect(JSON.stringify(r.data)).toBe(JSON.stringify(expected));
}

describe('HookSchema — a hook body bound to a stored-metadata table is refused at parse', () => {
  it.each(FAMILY)('refuses a body hook whose string target is `%s`, at `object`, with the prescription', (table) => {
    const issues = refusalOf(hook(table));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'custom', path: 'object' }]);
    const [{ message }] = issues;
    expect(message.startsWith(`\`object\` names '${table}', a table of stored metadata, and this hook carries a \`body\``)).toBe(true);
    expect(message).toContain(PRESCRIPTION_OPENING);
  });

  it('refuses every body form, not only sandboxed JS: the runtime refuses before it reads the language', () => {
    for (const body of [JS_BODY, EXPRESSION_BODY]) {
      expect(refusalOf(hook('sys_metadata', { body })).map((i) => i.path), body.language).toEqual(['object']);
    }
  });

  it('a list target is refused at the family member, and one member refuses the whole hook', () => {
    expect(refusalOf(hook(['crm_account', 'sys_metadata_history'])).map((i) => i.path)).toEqual(['object.1']);
    // Each family member it names is named, in list order.
    expect(refusalOf(hook(['sys_metadata', 'crm_account', 'sys_metadata_history'])).map((i) => i.path))
      .toEqual(['object.0', 'object.2']);
  });

  it('a list naming the wildcard AND a family table is refused: the family table is named', () => {
    expect(refusalOf(hook(['*', 'sys_metadata'])).map((i) => i.path)).toEqual(['object.1']);
  });

  it('defineHook refuses the same hook', () => {
    expect(() => defineHook(hook('sys_metadata') as never)).toThrow();
  });

  it('the registered `hook` type schema — what the metadata save door validates against — refuses it too', () => {
    const schema = getMetadataTypeSchema('hook') as unknown as typeof HookSchema;
    expect(schema).toBeDefined();
    const r = schema.safeParse(hook('sys_metadata'));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['object']);
  });
});

describe('HookSchema — what stays accepted, byte for byte (the runtime binds these)', () => {
  it.each(FAMILY)('CONTROL: a code `handler` hook on `%s` parses unchanged — platform hooks are code', (table) => {
    const input = hook(table, { handler: 'stamp_status' });
    expectAcceptedUnchanged(input, { ...input, ...DEFAULTS });
  });

  it('CONTROL: a wildcard body hook parses unchanged — it names no family table', () => {
    const input = hook('*');
    expectAcceptedUnchanged(input, { ...input, body: { ...JS_BODY, capabilities: [] }, ...DEFAULTS });
  });

  it('CONTROL: a body hook on an ordinary object parses unchanged, string and list forms', () => {
    for (const object of ['crm_account', ['crm_account', 'crm_contact']]) {
      const input = hook(object);
      expectAcceptedUnchanged(input, { ...input, body: { ...JS_BODY, capabilities: [] }, ...DEFAULTS });
    }
  });

  it('ONE definition: the kernel module re-exports the leaf\'s set and predicate as the very same objects', () => {
    // `hook.zod.ts` imports the leaf; the runtime imports `@objectstack/spec/kernel`,
    // which re-exports `metadata-type-redaction.ts`, which re-exports the leaf.
    expect(isStoredMetadataBodyObject).toBe(leaf.isStoredMetadataBodyObject);
    expect(STORED_METADATA_BODY_OBJECTS).toBe(leaf.STORED_METADATA_BODY_OBJECTS);
  });

  it('the refused set is the predicate\'s, by exact name — never a second list', () => {
    const targets: Array<string | string[]> = [
      ...FAMILY,
      'SYS_METADATA',
      'sys_metadata_draft',
      'sys_meta',
      'metadata',
      '*',
      'crm_account',
      ['crm_account', 'sys_metadata'],
      ['crm_account', 'crm_contact'],
    ];
    for (const object of targets) {
      const names = Array.isArray(object) ? object : [object];
      const expectedRefused = names.some((n) => isStoredMetadataBodyObject(n));
      expect(HookSchema.safeParse(hook(object)).success, JSON.stringify(object)).toBe(!expectedRefused);
      // Without a body the predicate is never asked: every target parses.
      expect(HookSchema.safeParse(hook(object, { handler: 'stamp_status' })).success, JSON.stringify(object)).toBe(true);
    }
  });
});

describe('every door that parses a hook refuses it', () => {
  const stackWith = (hooks: unknown[]) => ({
    manifest: { id: 'com.example.hooks', name: 'hooks', version: '1.0.0', type: 'app', namespace: 'hks' },
    objects: [{ name: 'hks_note', label: 'Note', fields: { title: { type: 'text', label: 'Title' } } }],
    hooks,
  });

  it('defineStack wraps the refusal in its ADR-0112 envelope, at `hooks.N.object`', () => {
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[]; code: string }> } | undefined;
    try {
      defineStack(stackWith([hook('hks_note'), hook('sys_metadata')]) as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the family-target body hook').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
      { path: 'hooks.1.object', code: 'custom' },
    ]);
  });

  it('CONTROL: defineStack accepts the ordinary body hook alone', () => {
    expect(() => defineStack(stackWith([hook('hks_note')]) as never)).not.toThrow();
  });

  it('an artifact\'s parse refuses it: the JSON-stage hook keeps the check through `safeExtend`', () => {
    const body = { id: 'com.example.hooks', name: 'hooks', version: '1.0.0', type: 'app' };
    const refused = ArtifactStagePackageBodySchema.safeParse({ ...body, hooks: [hook('sys_metadata')] });
    expect(refused.success).toBe(false);
    expect(refused.success ? [] : refused.error.issues.map((i) => i.path.join('.'))).toEqual(['hooks.0.object']);

    // CONTROL: an ordinary body hook, and a lowered string handler on a family table, parse.
    for (const h of [hook('crm_account'), hook('sys_metadata', { handler: 'stamp_status' })]) {
      const r = ArtifactStagePackageBodySchema.safeParse({ ...body, hooks: [h] });
      expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
    }
    // CONTROL: `safeExtend` kept the artifact stage's own narrowing — an inline callable is still refused.
    const callable = ArtifactStagePackageBodySchema.safeParse({ ...body, hooks: [hook('crm_account', { handler: () => {} })] });
    expect(callable.success).toBe(false);
  });
});

describe('the ADR-0087 ledger', () => {
  it('registers one D3 entry at protocol 18, with no D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((e) => e.id === ENTRY_ID);
    expect(entries, 'the narrowing needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.conversionIds ?? []).toEqual([]);
    expect(entry!.replacement).toContain('Change metadata through the metadata API');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('registers no tombstone: `object` and `body` stay in the walked shape', () => {
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all.filter((k) => k.startsWith('data/Hook:object') || k.startsWith('data/Hook:body'))).toEqual([]);
    // CONTROL: the flattened table is the real one — it carries a known step-18 tombstone.
    expect(all).toContain('api/RestApiEndpoint:timeout');
    const shape = (HookSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape)).toEqual(expect.arrayContaining(['object', 'body']));
  });
});
