// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25653] The save-time half of the identity-assignment refusal: a hook that
 * declares `runAs: 'system'`, and a `script` action (whose body always runs as
 * system), are refused at parse when their sandboxed JS body names a write to
 * `sys_user_position`, `sys_user_permission_set`, `sys_invitation` or
 * `sys_member`. The run-time half (plugin-security's
 * `flow-system-identity-write-refusal.ts`) refuses the write itself.
 *
 * Controls pin what the run-time refusal leaves legal too: reads of the four
 * objects, writes to other objects, a hook under `runAs: 'user'` (the D12 gate
 * judges it), an expression body and a code handler.
 */

import { describe, expect, it } from 'vitest';
import { HookSchema } from '../data/hook.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ArtifactStagePackageBodySchema, defineStack } from '../stack.zod';
import { ActionSchema } from '../ui/action.zod';
import {
  IDENTITY_ASSIGNMENT_WRITE_OBJECTS,
  identityAssignmentWritesNamedIn,
} from './identity-assignment-body-writes';

const ENTRY_ID = 'hook-action-body-system-identity-assignment-write-refused';
const FOUR = [...IDENTITY_ASSIGNMENT_WRITE_OBJECTS];
const WRITE_METHODS = ['insert', 'update', 'delete', 'updateMany', 'deleteMany', 'upsert'] as const;
const ASSIGNMENT = new Set(['sys_user_position', 'sys_user_permission_set']);

const writeSource = (object: string, method: string = 'insert') =>
  `await ctx.api.object('${object}').${method}({ user_id: ctx.input.owner });`;
const jsBody = (source: string) => ({ language: 'js', source, capabilities: ['api.read', 'api.write'] });

const hook = (source: string, extra: Record<string, unknown> = {}) => ({
  name: 'grant_on_insert',
  object: 'crm_account',
  events: ['afterInsert'],
  runAs: 'system',
  body: jsBody(source),
  ...extra,
});

const action = (source: string, extra: Record<string, unknown> = {}) => ({
  name: 'grant_access',
  label: 'Grant access',
  type: 'script',
  body: jsBody(source),
  ...extra,
});

interface IssueSig { code: string; path: string; message: string }

function issuesOf(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } } }, input: unknown): IssueSig[] {
  const r = schema.safeParse(input);
  expect(r.success, 'expected the parse to refuse this body').toBe(false);
  return (r.error?.issues ?? []).map((i) => ({ code: i.code, path: i.path.map(String).join('.'), message: i.message }));
}

function expectAccepted(schema: { safeParse(v: unknown): { success: boolean; error?: unknown } }, input: unknown): void {
  const r = schema.safeParse(input);
  expect(r.success, JSON.stringify((r.error as { issues?: unknown })?.issues ?? [])).toBe(true);
}

describe('identityAssignmentWritesNamedIn — what a body source is judged to write', () => {
  it.each(FOUR)('names `%s` for every write method on the literal handle, in every quote form', (object) => {
    for (const method of WRITE_METHODS) {
      for (const quote of [`'`, `"`, '`']) {
        const source = `await ctx.api.object(${quote}${object}${quote}).${method}({ id: 'x' });`;
        expect(identityAssignmentWritesNamedIn(source), `${method} ${quote}`).toEqual([object]);
      }
    }
  });

  it('names a write called on a name the body bound the handle to', () => {
    const source = "const grants = ctx.api.object('sys_user_permission_set');\nawait grants.insert({ user_id: ctx.input.owner });";
    expect(identityAssignmentWritesNamedIn(source)).toEqual(['sys_user_permission_set']);
  });

  it('names each object once, in first-seen order', () => {
    const source = [writeSource('sys_member'), writeSource('sys_invitation', 'update'), writeSource('sys_member', 'delete')].join('\n');
    expect(identityAssignmentWritesNamedIn(source)).toEqual(['sys_member', 'sys_invitation']);
  });

  it('CONTROL: names nothing for reads of the four objects, or writes to any other object', () => {
    for (const object of FOUR) {
      for (const method of ['find', 'findOne', 'count', 'aggregate']) {
        expect(identityAssignmentWritesNamedIn(`await ctx.api.object('${object}').${method}({});`)).toEqual([]);
      }
      const bound = `const rows = ctx.api.object('${object}');\nconst held = await rows.find({});`;
      expect(identityAssignmentWritesNamedIn(bound)).toEqual([]);
    }
    for (const object of ['crm_account', 'sys_user', 'sys_member_note', 'sys_user_position_history']) {
      expect(identityAssignmentWritesNamedIn(writeSource(object))).toEqual([]);
    }
  });
});

describe('HookSchema — a runAs: \'system\' hook whose body writes an identity-assignment object is refused', () => {
  it.each(FOUR)('refuses a write to `%s` at `body.source`, with its prescription', (object) => {
    const issues = issuesOf(HookSchema, hook(writeSource(object)));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'custom', path: 'body.source' }]);
    const [{ message }] = issues;
    expect(message.startsWith(`\`body.source\` writes '${object}' and this hook runs as system (runAs: 'system')`)).toBe(true);
    expect(message).toContain(ASSIGNMENT.has(object) ? "Set the hook's runAs to 'user'" : 'organization endpoints');
  });

  it('one issue per object the body writes', () => {
    const issues = issuesOf(HookSchema, hook([writeSource('sys_user_position'), writeSource('sys_member', 'upsert')].join('\n')));
    expect(issues.map((i) => ({ path: i.path, object: /^`body\.source` writes '(\w+)'/.exec(i.message)?.[1] }))).toEqual([
      { path: 'body.source', object: 'sys_user_position' },
      { path: 'body.source', object: 'sys_member' },
    ]);
  });

  it('the registered `hook` type schema — what the metadata save door validates against — refuses it too', () => {
    const schema = getMetadataTypeSchema('hook') as unknown as typeof HookSchema;
    expect(issuesOf(schema, hook(writeSource('sys_member'))).map((i) => i.path)).toEqual(['body.source']);
  });

  it("CONTROL: under runAs: 'user' the same body parses — the delegated-administration gate judges the user", () => {
    expectAccepted(HookSchema, hook(writeSource('sys_user_position'), { runAs: 'user' }));
  });

  it('CONTROL: a system hook that reads the four objects, or writes another object, parses', () => {
    expectAccepted(HookSchema, hook("const held = await ctx.api.object('sys_user_position').find({});"));
    expectAccepted(HookSchema, hook(writeSource('crm_account', 'update')));
  });

  it('CONTROL: an expression body and a code handler are not judged — neither is a readable write', () => {
    expectAccepted(HookSchema, hook('', { body: { language: 'expression', source: "'sys_member'" } }));
    expectAccepted(HookSchema, { ...hook(''), body: undefined, handler: 'grant_on_insert' });
  });
});

describe('ActionSchema — a script action whose body writes an identity-assignment object is refused', () => {
  it.each(FOUR)('refuses a write to `%s` at `body.source`, with its prescription', (object) => {
    const issues = issuesOf(ActionSchema, action(writeSource(object, 'update')));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'custom', path: 'body.source' }]);
    const [{ message }] = issues;
    expect(message.startsWith(`\`body.source\` writes '${object}' and an action body runs as system`)).toBe(true);
    expect(message).toContain(ASSIGNMENT.has(object) ? "a flow whose runAs is 'user'" : 'organization endpoints');
  });

  it('the registered `action` type schema refuses it too', () => {
    const schema = getMetadataTypeSchema('action') as unknown as typeof ActionSchema;
    expect(issuesOf(schema, action(writeSource('sys_invitation'))).map((i) => i.path)).toEqual(['body.source']);
  });

  it('CONTROL: an action body that reads the four objects, or writes another object, parses', () => {
    expectAccepted(ActionSchema, action("return ctx.api.object('sys_member').find({});"));
    expectAccepted(ActionSchema, action(writeSource('crm_account')));
  });

  it('CONTROL: an expression body is not judged — it performs no IO', () => {
    expectAccepted(ActionSchema, action('', { body: { language: 'expression', source: "'sys_member'" } }));
  });
});

describe('every door that parses a stack refuses it', () => {
  const stackWith = (extra: Record<string, unknown>) => ({
    manifest: { id: 'com.example.grants', name: 'grants', version: '1.0.0', type: 'app', namespace: 'grt' },
    objects: [{ name: 'grt_note', label: 'Note', fields: { title: { type: 'text', label: 'Title' } } }],
    ...extra,
  });

  it('defineStack wraps the hook refusal in its ADR-0112 envelope, at `hooks.N.body.source`', () => {
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[]; code: string }> } | undefined;
    try {
      defineStack(stackWith({ hooks: [hook(writeSource('crm_account')), hook(writeSource('sys_member'))] }) as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the hook').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
      { path: 'hooks.1.body.source', code: 'custom' },
    ]);
  });

  it('defineStack refuses the action too', () => {
    expect(() => defineStack(stackWith({ actions: [action(writeSource('sys_user_permission_set'))] }) as never)).toThrow();
  });

  it("an artifact's parse refuses the hook: the JSON-stage hook keeps the check through `safeExtend`", () => {
    const body = { id: 'com.example.grants', name: 'grants', version: '1.0.0', type: 'app' };
    const refused = ArtifactStagePackageBodySchema.safeParse({ ...body, hooks: [hook(writeSource('sys_member'))] });
    expect(refused.success).toBe(false);
    expect(refused.success ? [] : refused.error.issues.map((i) => i.path.join('.'))).toEqual(['hooks.0.body.source']);
  });
});

describe('the ADR-0087 ledger', () => {
  it('registers one D3 entry at protocol 18, with no D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((e) => e.id === ENTRY_ID);
    expect(entries, 'the narrowing needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.conversionIds ?? []).toEqual([]);
    expect(entry!.replacement).toContain('organization endpoints');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('registers no tombstone: `runAs` and `body` stay in the walked shape', () => {
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all.filter((k) => k.startsWith('data/Hook:runAs') || k.startsWith('data/Hook:body') || k.startsWith('ui/Action:body'))).toEqual([]);
    // CONTROL: the flattened table is the real one — it carries a known step-18 tombstone.
    expect(all).toContain('api/RestApiEndpoint:timeout');
  });
});
