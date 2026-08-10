// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#6247) — `os test` REFUSES a malformed `qa/*.test.json` at LOAD time.
 *
 * The load site used to be `JSON.parse(content) as QA.TestSuite`, with the
 * schema author's own `// Should validate with Zod` sitting next to it. A type
 * assertion is not a check: the cast made every JSON document on disk a
 * `TestSuite` as far as the compiler was concerned, and the first thing that
 * noticed otherwise was the runner, several layers down and with no idea which
 * file it came from. The three failure shapes that produced:
 *
 *   - `{}` (no `scenarios`) → `TestRunner.runSuite` iterates `undefined` and
 *     throws a TypeError attributed to the runner, not the file;
 *   - `{ scenarios: [] }` with a typo'd key → the suite reports SUCCESS having
 *     executed nothing, which is the dangerous one: a broken suite that passes
 *     is indistinguishable from a green one in CI;
 *   - a bad `action.type` → survives the load, survives the runner, and dies in
 *     the HTTP adapter's `default:` branch mid-run, after the preceding steps
 *     have already written records.
 *
 * An AI-authored suite hits all three routinely, which is exactly the
 * declared≠enforced gap ADR-0049 names: `TestSuiteSchema` was declared, shipped,
 * documented — and had no `parse` site anywhere in the platform.
 *
 * So the pin is on the LOAD boundary, not on the runner: a document that
 * `TestSuiteSchema` rejects must never reach `runSuite`, and the refusal must
 * name the file and the issues. Valid suites must still load unchanged.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTestSuite } from '../src/commands/test';

const dir = mkdtempSync(join(tmpdir(), 'os-qa-suite-'));

function suiteFile(name: string, body: string): string {
  const file = join(dir, name);
  writeFileSync(file, body, 'utf-8');
  return file;
}

const VALID_SUITE = {
  name: 'crm smoke',
  scenarios: [
    {
      id: 'create-account',
      name: 'Create an account',
      steps: [
        {
          name: 'create',
          action: { type: 'create_record', target: 'accounts', payload: { name: 'Acme' } },
          assertions: [{ field: 'id', operator: 'not_null', expectedValue: null }],
        },
      ],
    },
  ],
};

describe('os test — suite load is schema-checked (#6247)', () => {
  it('loads a valid suite unchanged', () => {
    const file = suiteFile('valid.test.json', JSON.stringify(VALID_SUITE));
    const suite = loadTestSuite(file);
    expect(suite.name).toBe('crm smoke');
    expect(suite.scenarios).toHaveLength(1);
    expect(suite.scenarios[0].steps[0].action.type).toBe('create_record');
  });

  it('refuses a suite with no `scenarios` — the shape that TypeErrors inside the runner', () => {
    const file = suiteFile('no-scenarios.test.json', JSON.stringify({ name: 'empty' }));
    expect(() => loadTestSuite(file)).toThrow(/no-scenarios\.test\.json/);
    expect(() => loadTestSuite(file)).toThrow(/scenarios/);
  });

  it('refuses a misspelled step key — the shape that SILENTLY passes', () => {
    // `stepz` instead of `steps`: the cast let this through and the scenario
    // reported PASSED having run nothing at all.
    const file = suiteFile(
      'typo.test.json',
      JSON.stringify({ name: 's', scenarios: [{ id: 'a', name: 'A', stepz: [] }] }),
    );
    expect(() => loadTestSuite(file)).toThrow(/typo\.test\.json/);
  });

  it('refuses an unknown action type — the shape that dies mid-run after writes', () => {
    const bad = structuredClone(VALID_SUITE) as Record<string, any>;
    bad.scenarios[0].steps[0].action.type = 'summon_record';
    const file = suiteFile('bad-action.test.json', JSON.stringify(bad));
    expect(() => loadTestSuite(file)).toThrow(/bad-action\.test\.json/);
  });

  it('names the offending file and the issues, and prescribes the shape', () => {
    const file = suiteFile('broken.test.json', JSON.stringify({ scenarios: 'not an array' }));
    let message = '';
    try {
      loadTestSuite(file);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain('broken.test.json');
    expect(message).toContain('TestSuiteSchema');
    // Self-prescribing: the author is told what a suite looks like, not just
    // that theirs is wrong.
    expect(message).toContain('scenarios');
  });

  it('refuses invalid JSON with the file named, rather than a bare SyntaxError', () => {
    const file = suiteFile('not-json.test.json', '{ "name": ');
    expect(() => loadTestSuite(file)).toThrow(/not-json\.test\.json/);
  });
});
