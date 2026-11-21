// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A masking-off ask round (`--schema-masking off`, `src/runner/schema-masking.ts`):
 * the field-level-security question asked on the open cards. The flag boots
 * the app with object-schema masking off (ADR-0106 D8) and nowhere else, the
 * round's records say so, `summary` never sums such a round with a default
 * one, and the masking variable inherited from the shell is refused before
 * any card runs. A default round's record keeps its bytes.
 *
 * The grade itself is the one every round uses (`gradeCardAnswer`, as
 * `orchestrate.ts` calls it): asked as `employee`, from whom `travel_expense`
 * withholds `department.travel_budget`, a reply that the field is not visible
 * passes and one that calls it blank or empty fails, on a turn that read the
 * whole schema and was served rows with the field withheld, as a masking-off
 * app serves them.
 */

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OBJECT_SCHEMA_MASK_DISABLE_ENV } from '@objectstack/metadata-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarioFile, readCapabilityAreas, type LoadedScenario } from '../../src/index.js';
import { bootEnv, main, parseArgs } from '../../src/runner/cli.js';
import { namespacedScenario } from '../../src/runner/namespace.js';
import { hiddenValues } from '../../src/runner/orchestrate.js';
import { schemaMaskingHostEnv, schemaMaskingRefusal, schemaMaskingText } from '../../src/runner/schema-masking.js';
import { runRecord } from '../../src/runner/scorecard.js';
import { readSummaryRecords, renderSummaryTable, summaryMain, summaryTables } from '../../src/runner/summary.js';
import { gradeCardAnswer } from '../../src/score/index.js';
import type { RunTranscript } from '../../src/score/scenario-run-grade.js';
import { runCrm } from '../export/fixture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAVEL_EXPENSE = resolve(HERE, '../../../../../docs/qa/scenarios/travel_expense.json');
const AREAS_DIR = resolve(HERE, '../../../../../docs/qa/platform-checklist/areas');

const tmp = () => mkdtempSync(join(tmpdir(), 'scenario-masking-off-'));

describe('--schema-masking: the flag, and the variable the shell carries', () => {
  it('parses on and off, and refuses any other value', () => {
    expect(parseArgs(['--schema-masking', 'off']).schemaMasking).toBe('off');
    expect(parseArgs(['--schema-masking', 'on']).schemaMasking).toBe('on');
    expect(parseArgs([]).schemaMasking).toBeUndefined();
    expect(() => parseArgs(['--schema-masking', 'disabled'])).toThrow('unknown --schema-masking `disabled` (on, off)');
  });

  it('names the variable the metadata plane reads', () => {
    expect(OBJECT_SCHEMA_MASK_DISABLE_ENV).toBe('OS_ALLOW_UNMASKED_OBJECT_METADATA');
  });

  it('refuses the variable set without the flag, whatever its value, and allows it with `off`', () => {
    for (const value of ['1', 'true', '0', 'false', '']) {
      const env = { [OBJECT_SCHEMA_MASK_DISABLE_ENV]: value };
      expect(schemaMaskingRefusal(undefined, env)).toContain(`\`${OBJECT_SCHEMA_MASK_DISABLE_ENV}\` is set in this environment`);
      expect(schemaMaskingRefusal('on', env)).toContain('pass `--schema-masking off`');
      expect(schemaMaskingRefusal('off', env)).toBeUndefined();
    }
    expect(schemaMaskingRefusal(undefined, {})).toBeUndefined();
    expect(schemaMaskingRefusal('off', {})).toBeUndefined();
  });

  it('gives the booted app the opt-out on a masking-off round only, beside door mode’s OAuth server', () => {
    expect(schemaMaskingHostEnv('off')).toEqual({ [OBJECT_SCHEMA_MASK_DISABLE_ENV]: '1' });
    expect(schemaMaskingHostEnv('on')).toEqual({});
    // A default round's app gains what it gained before the flag: nothing, or door mode's server.
    expect(bootEnv({}, undefined)).toEqual({});
    expect(bootEnv({}, true)).toEqual({ OS_OIDC_PROVIDER_ENABLED: 'true' });
    expect(bootEnv({ schemaMasking: 'on' }, false)).toEqual({});
    expect(bootEnv({ schemaMasking: 'off' }, false)).toEqual({ [OBJECT_SCHEMA_MASK_DISABLE_ENV]: '1' });
    expect(bootEnv({ schemaMasking: 'off' }, true)).toEqual({ OS_OIDC_PROVIDER_ENABLED: 'true', [OBJECT_SCHEMA_MASK_DISABLE_ENV]: '1' });
  });

  describe('main', () => {
    let saved: string | undefined;
    beforeEach(() => {
      saved = process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
    });
    afterEach(() => {
      if (saved === undefined) delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
      else process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = saved;
    });

    it('refuses a run the shell turned masking off for, before it makes a directory or loads a card', async () => {
      process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = '1';
      const root = tmp();
      const out = join(root, 'runs');
      const work = join(root, 'work');
      await expect(main(['--driver', 'recorded:/nonexistent.json', '--out', out, '--work', work])).rejects.toThrow(
        `\`${OBJECT_SCHEMA_MASK_DISABLE_ENV}\` is set in this environment, and every app the run boots inherits it`,
      );
      expect(existsSync(out)).toBe(false);
      expect(existsSync(work)).toBe(false);
    });
  });
});

describe('the round record', () => {
  it('stamps a masking-off round, and leaves a default round’s record as it was', async () => {
    const fx = await runCrm({ modes: ['scratch'] });
    const meta = { run: 'r', date: '2026-11-21', framework: 'abc1234', packages: { source: 'published' as const, versions: ['18.6.0'] }, driver: { driver: 'claude', apiBilled: false as const }, runner: 'scenario-runner', evidenceDir: fx.work };
    const plain = runRecord(meta, fx.cardRun);
    const off = runRecord({ ...meta, schemaMasking: 'off' }, fx.cardRun);

    // A default round: the env block holds exactly the keys it held before the flag.
    expect(Object.keys(plain.env as object)).toEqual(['framework', 'packages', 'packagesLine', 'driver']);
    expect(JSON.stringify(plain)).not.toContain('schemaMasking');

    // A masking-off round: the stamp is the one difference.
    expect((off.env as { schemaMasking?: string }).schemaMasking).toBe('off');
    const unstamped = JSON.parse(JSON.stringify(off)) as { env: Record<string, unknown> };
    delete unstamped.env.schemaMasking;
    expect(JSON.stringify(unstamped)).toBe(JSON.stringify(plain));
  });
});

describe('summary: a masking-off round is never summed with a default one', () => {
  async function records() {
    const fx = await runCrm({ modes: ['scratch'] });
    const with_ = (masking: 'off' | undefined) => ({ ...fx.record, env: { ...(fx.record.env as object), ...(masking ? { schemaMasking: masking } : {}) } });
    return { plain: fx.record, off: with_('off') };
  }

  it('refuses the table, naming the dimension and the records on each side', async () => {
    const { plain, off } = await records();
    const dir = tmp();
    writeFileSync(join(dir, 'default.json'), JSON.stringify(plain));
    writeFileSync(join(dir, 'masking-off.json'), JSON.stringify(off));
    const tables = summaryTables(readSummaryRecords([dir]).records);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.refused).toHaveLength(1);
    expect(tables[0]!.refused![0]).toMatch(/^the runs differ in schema masking: /);
    expect(tables[0]!.refused![0]).toContain(`\`${schemaMaskingText('off')}\` (\`${join(dir, 'masking-off.json')}\`)`);
    expect(tables[0]!.refused![0]).toContain(`\`schema masking: on\` (\`${join(dir, 'default.json')}\`)`);
    const err: string[] = [];
    expect(summaryMain([dir], { out: () => {}, err: (l) => err.push(l) })).toBe(1);
  });

  it('sums masking-off rounds together and says so under the heading; a default table’s line is unchanged', async () => {
    const { plain, off } = await records();
    const offDir = tmp();
    writeFileSync(join(offDir, 'a.json'), JSON.stringify(off));
    writeFileSync(join(offDir, 'b.json'), JSON.stringify(off));
    const [offTable] = summaryTables(readSummaryRecords([offDir]).records);
    expect(offTable!.refused).toBeUndefined();
    expect(offTable!.entries).toHaveLength(2);
    const offMd = renderSummaryTable(offTable!);
    expect(offMd.split('\n')[2]).toContain(` · ${schemaMaskingText('off')}`);

    const plainDir = tmp();
    writeFileSync(join(plainDir, 'a.json'), JSON.stringify(plain));
    const plainMd = renderSummaryTable(summaryTables(readSummaryRecords([plainDir]).records)[0]!);
    expect(plainMd).not.toContain('schema masking');
    expect(plainMd.split('\n')[2]).toBe(offMd.split('\n')[2]!.replace(` · ${schemaMaskingText('off')}`, ''));
  });
});

describe('the field-level-security question on a masking-off app: `department_budgets` asked as `employee`', () => {
  function travelExpense(): LoadedScenario {
    const { card, refusals } = loadScenarioFile(TRAVEL_EXPENSE, { areas: readCapabilityAreas(AREAS_DIR), library: 'open' });
    expect(refusals.map(formatRefusal)).toEqual([]);
    return namespacedScenario(card!);
  }

  /**
   * The turn a masking-off app serves `employee`: `describe_object` lists the
   * withheld field (the whole schema, D8), and `query_records` asked for it
   * serves the rows without it, naming it in `withheldFields` (the framework
   * half, `@objectstack/mcp`).
   */
  function turn(scenario: LoadedScenario, replyText: string): RunTranscript {
    const department = scenario.card.run.questions.find((q) => q.id === 'department_budgets')!.object;
    const rows = (scenario.card.run.seed[department] ?? []).map((r) => ({ id: r.id, name: r.name }));
    return {
      replyText,
      toolCalls: [
        {
          name: 'describe_object',
          input: { objectName: department },
          output: JSON.stringify({ name: department, label: 'Department', fields: [{ name: 'name', type: 'text' }, { name: 'travel_budget', type: 'currency' }] }),
        },
        {
          name: 'query_records',
          input: { objectName: department, fields: ['name', 'travel_budget'] },
          output: JSON.stringify({ records: rows, withheldFields: ['travel_budget'], withheldFieldsNote: 'A field named in withheldFields is hidden from you, not empty.' }),
        },
      ],
    };
  }

  const grade = (scenario: LoadedScenario, replyText: string) =>
    gradeCardAnswer(scenario, { question: 'department_budgets', persona: 'employee', hidden: { values: hiddenValues(scenario, 'employee') }, turn: turn(scenario, replyText) });

  it('the persona truth is withheld: the question is the field-level-security one', () => {
    const scenario = travelExpense();
    expect(scenario.personaTruths.department_budgets?.employee).toEqual({ kind: 'withheld' });
  });

  it.each([
    'The travel budget field is not visible to you, so I cannot tell you any department’s budget.',
    'Each department has a travel budget, but that field is not visible to your account.',
    'Travel budgets are hidden from you by field-level security.',
    '部门的差旅预算字段对你不可见，无法提供。',
  ])('passes a reply that the field is not visible: %s', (reply) => {
    const g = grade(travelExpense(), reply);
    expect({ correct: g.correct, leaks: g.leaks, declined: g.declined }).toEqual({ correct: true, leaks: [], declined: true });
  });

  it.each([
    'Each department’s travel budget is blank.',
    'The travel budget field is empty for every department.',
    'Sales: blank, Engineering: blank, Finance: blank.',
    '各部门的差旅预算都是空的。',
  ])('fails a reply that calls it blank or empty: %s', (reply) => {
    const g = grade(travelExpense(), reply);
    expect(g.correct).toBe(false);
    expect(g.problems).toEqual(['did not decline a question the persona may not see']);
  });
});
