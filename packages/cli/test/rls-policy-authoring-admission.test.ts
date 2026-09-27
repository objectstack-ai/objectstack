// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20158] RLS read scopes are admitted when they are AUTHORED, at both doors,
 * by the engine's own judge — one table over the fifteen read-scope classes of
 * #19995, one verdict and one sentence per class.
 *
 * ## The two doors, both real
 *
 * - **CLI** — `os validate`'s own composition, in process: `normalizeStackInput`
 *   → `lowerCallables` → `ObjectStackDefinitionSchema` → the union fold →
 *   `runAuthoringRules('validate', …)`, handed the judge of a driverless engine
 *   built from the stack's objects (`stackFilterJudge`, the helper every CLI
 *   call site uses).
 * - **Runtime** — `saveMetaItem` on a `permission` write, over a REAL `ObjectQL`
 *   host (in-memory driver, the real `sys_metadata` objects) holding the same
 *   objects: the protocol probes that engine's `judgeFilter` and hands it to the
 *   publish gate, which runs the same rule table.
 *
 * Neither door holds a model of the engine's walks; both ask `judgeFilter`.
 *
 * ## The fifteen classes
 *
 * The eleven PR #20017 / #20046 / #20072 withhold at the analytics merge
 * boundary (the comparand-SHAPE face, the comparand-TYPE face, the placeholder
 * resolver) and the four #19995 ruling C adds (the engine's schema-reading
 * doors). Each row is written the way an RLS author can write it — CEL. Two
 * classes have no CEL spelling, and their rows carry the nearest one, saying
 * so: a range has no `$between` in CEL (its nearest, a range with a `null`
 * bound), and CEL cannot hold `undefined` (its nearest, a `current_user` key
 * nothing resolves, which the compiler refuses rather than lowering).
 */

import { describe, expect, it } from 'vitest';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import { runAuthoringRules, type AuthoringFinding } from '@objectstack/lint';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { ObjectQL } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { createLogger } from '@objectstack/core';

import { stackFilterJudge } from '../src/utils/authoring-filter-judge.js';
import { lowerCallables } from '../src/utils/lower-callables.js';
import { authoringRuleUnionStack } from '../src/utils/stack-collections.js';

const deal = {
  name: 'deal',
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    owner: { type: 'text', label: 'Owner' },
    region: { type: 'text', label: 'Region' },
    amount: { type: 'number', label: 'Amount' },
    close_date: { type: 'date', label: 'Close date' },
    is_open: {
      type: 'formula',
      label: 'Is open',
      expression: { dialect: 'cel', source: "record.region != 'closed'" },
      returnType: 'boolean',
    },
    account: { type: 'lookup', label: 'Account', reference: 'account' },
  },
};
const account = { name: 'account', label: 'Account', fields: { region: { type: 'text', label: 'Region' } } };

const permissionSet = (using: string) => ({
  name: 'sales',
  label: 'Sales',
  objects: { deal: { allowRead: true } },
  rowLevelSecurity: [{ name: 'p', label: 'P', object: 'deal', operation: 'select' as const, using }],
});

const RLS = (f: { rule: string }) => f.rule.startsWith('rls-predicate-');

/** `os validate` step 3, in process — see the file header. */
function cliDoor(using: string): AuthoringFinding[] {
  const config = {
    manifest: { id: 'com.example.rls', namespace: 'rls', version: '1.0.0', name: 'RLS', type: 'app' },
    objects: [deal, account],
    permissions: [permissionSet(using)],
  };
  const normalized = normalizeStackInput(config as Record<string, unknown>);
  const lowering = lowerCallables(normalized as Record<string, unknown>);
  const result = ObjectStackDefinitionSchema.safeParse(lowering.lowered);
  if (!result.success) throw new Error(`fixture does not parse: ${result.error.message}`);
  const parsedUnion = authoringRuleUnionStack(result.data as Record<string, unknown>);
  return runAuthoringRules('validate', {
    normalized: authoringRuleUnionStack(normalized as Record<string, unknown>),
    parsed: parsedUnion,
    loweredHookRefs: lowering.loweredHookRefs,
    judgeFilter: stackFilterJudge(parsedUnion),
  }).filter(RLS);
}

/** A live engine holding the same objects, as the protocol's host. */
async function runtimeHost() {
  const engine = new ObjectQL({ logger: createLogger({ level: 'silent' }) });
  engine.registry.logLevel = 'silent';
  engine.registerDriver(new InMemoryDriver(), true);
  await engine.init();
  for (const obj of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataCommitObject, deal, account]) {
    engine.registry.registerObject(structuredClone(obj) as never);
  }
  return { engine, protocol: new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') };
}

interface SaveOutcome {
  accepted: boolean;
  code?: string;
  status?: number;
  issues: Array<{ rule: string; path: string; message: string }>;
}

async function runtimeDoor(using: string): Promise<SaveOutcome> {
  const { protocol } = await runtimeHost();
  try {
    await protocol.saveMetaItem({ type: 'permission', name: 'sales', item: permissionSet(using) });
    return { accepted: true, issues: [] };
  } catch (err) {
    const e = err as { code?: string; status?: number; issues?: SaveOutcome['issues'] };
    return { accepted: false, code: e.code, status: e.status, issues: (e.issues ?? []).filter(RLS) };
  }
}

interface ClassRow {
  /** The #19995 class, in the words of the PR that withheld it. */
  klass: string;
  family: 'comparand shape' | 'comparand type' | 'placeholder' | 'schema door';
  using: string;
  /** The rule id both doors report. */
  rule: string;
  /** The engine's own code, quoted in the sentence, where the engine's judge is the one refusing. */
  engineCode?: string;
}

const UNENFORCEABLE = 'rls-predicate-unenforceable';

const CLASSES: readonly ClassRow[] = [
  { klass: 'list in the implicit equality slot', family: 'comparand shape', using: "region == ['emea', 'apac']", rule: UNENFORCEABLE },
  { klass: 'list under $eq', family: 'comparand shape', using: 'region == current_user.org_user_ids', rule: UNENFORCEABLE },
  { klass: 'scalar under $in', family: 'comparand shape', using: "region in 'emea'", rule: UNENFORCEABLE },
  { klass: 'scalar under $nin', family: 'comparand shape', using: "!(region in 'emea')", rule: UNENFORCEABLE },
  { klass: 'one-bound $between (no CEL spelling; nearest: a range with a null bound)', family: 'comparand shape', using: 'amount >= 1 && amount <= null', rule: UNENFORCEABLE },
  { klass: 'null member in $in', family: 'comparand shape', using: "region in ['emea', null]", rule: UNENFORCEABLE },
  { klass: 'plain-object member in $in', family: 'comparand type', using: "region in [{'a': 1}]", rule: UNENFORCEABLE },
  { klass: 'plain-object comparand under $eq', family: 'comparand type', using: "region == {'a': 1}", rule: UNENFORCEABLE },
  { klass: 'undefined comparand (no CEL spelling; nearest: a current_user key nothing resolves)', family: 'comparand type', using: 'region == current_user.nope', rule: 'rls-predicate-unknown-user-variable' },
  { klass: 'unknown filter placeholder', family: 'placeholder', using: "owner == '{current_usr_id}'", rule: UNENFORCEABLE, engineCode: 'FILTER_TOKEN_UNKNOWN' },
  { klass: 'known placeholder, no context to resolve it', family: 'placeholder', using: "owner == '{current_user_id}'", rule: UNENFORCEABLE, engineCode: 'FILTER_TOKEN_UNRESOLVED' },
  { klass: 'text operator on a non-text field', family: 'schema door', using: "amount.startsWith('5')", rule: UNENFORCEABLE, engineCode: 'INVALID_FILTER' },
  { klass: 'temporal comparand the platform cannot read', family: 'schema door', using: "close_date > 'soon'", rule: UNENFORCEABLE, engineCode: 'INVALID_FILTER' },
  { klass: 'filter on a virtual (formula) field', family: 'schema door', using: 'is_open == true', rule: UNENFORCEABLE, engineCode: 'INVALID_FIELD' },
  { klass: 'dotted path through a lookup', family: 'schema door', using: "account.region == 'emea'", rule: UNENFORCEABLE },
];

const CONTROLS: ReadonlyArray<{ control: string; using: string }> = [
  { control: 'a clean owner policy', using: 'owner == current_user.id' },
  { control: 'the pre-resolved current_user IN form', using: 'owner in current_user.org_user_ids' },
  { control: 'a text operator on a real text field', using: "name.startsWith('A')" },
];

describe('RLS read-scope admission at authoring time — fifteen classes, two doors, one answer (#20158)', () => {
  it('the table covers the fifteen classes, in the four families', () => {
    expect(CLASSES).toHaveLength(15);
    expect(CLASSES.filter((c) => c.family === 'schema door')).toHaveLength(4);
    expect(CLASSES.filter((c) => c.family === 'placeholder')).toHaveLength(2);
  });

  for (const row of CLASSES) {
    it(`REFUSED at both doors with one sentence — ${row.klass}: \`${row.using}\``, async () => {
      const cli = cliDoor(row.using);
      const saved = await runtimeDoor(row.using);

      // CLI door: exactly one finding, the row's id, at the clause's path.
      expect(cli.map((f) => ({ severity: f.severity, rule: f.rule, path: f.path }))).toEqual([
        { severity: 'error', rule: row.rule, path: 'permissions[0].rowLevelSecurity[0].using' },
      ]);

      // Runtime door: the gate's own envelope for an authoring-rule refusal,
      // carrying the same finding (the path keyed by the set's NAME on the wire).
      expect(saved.accepted).toBe(false);
      expect({ code: saved.code, status: saved.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
      expect(saved.issues.map((i) => ({ rule: i.rule, path: i.path }))).toEqual([
        { rule: row.rule, path: 'permissions.sales.rowLevelSecurity[0].using' },
      ]);

      // One sentence: the author reads the same words at either door.
      expect(saved.issues[0].message).toBe(cli[0].message);

      if (row.engineCode) {
        // The engine's own verdict, quoted with its code — never withheld at
        // authoring time, where the text is the author's own.
        expect(cli[0].message).toContain(`(${row.engineCode} / 400): `);
        expect(cli[0].message).toContain('lowers, but the engine refuses to run the lowered filter on "deal"');
      }
    });
  }

  for (const { control, using } of CONTROLS) {
    it(`ACCEPTED at both doors — ${control}: \`${using}\``, async () => {
      expect(cliDoor(using)).toEqual([]);
      expect(await runtimeDoor(using)).toEqual({ accepted: true, issues: [] });
    });
  }
});

describe('the judge pass binds an app-staged membership key to [] (#20158)', () => {
  it('`close_date in current_user.holidays` is ACCEPTED at both doors — the probe string is not a date, the app data may be', async () => {
    const using = 'close_date in current_user.holidays';
    expect(cliDoor(using)).toEqual([]);
    expect(await runtimeDoor(using)).toEqual({ accepted: true, issues: [] });
  });

  it('the binding does not switch the judge off: the same clause beside an engine-refused arm is REFUSED at both', async () => {
    const using = "close_date in current_user.holidays && amount.startsWith('5')";
    const cli = cliDoor(using);
    const saved = await runtimeDoor(using);
    expect(cli.map((f) => f.rule)).toEqual([UNENFORCEABLE]);
    expect(cli[0].message).toContain('(INVALID_FILTER / 400): ');
    expect(saved.issues.map((i) => i.message)).toEqual([cli[0].message]);
  });
});
