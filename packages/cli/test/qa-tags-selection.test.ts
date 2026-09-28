// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — `os test --tags` selection semantics, and the labels a report prints.
 *
 * `TestScenario.tags` was declared "for filtering and categorization" and
 * nothing filtered on it: `os test` had no selection flag at all, so
 * `--tags critical` was an unknown-flag error and a suite tagged `regression`
 * ran on every invocation. The selection now exists, and these pins hold its
 * semantics — the parts a CI step would be built on:
 *
 *   - ANY-OF: a scenario carrying at least one listed tag is selected;
 *   - exact, case-sensitive matching — a tag is a name, not a pattern;
 *   - with the flag, an untagged scenario is never selected;
 *   - WITHOUT the flag (the control), every scenario is selected and `tags`
 *     is not consulted;
 *   - a malformed list is refused, never narrowed silently.
 *
 * The run-level wiring — the flag reaching the selection, the names reaching
 * the printed report, the exit statuses — is pinned by spawning the command
 * in `qa-names-and-tags-run.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type * as QA from '@objectstack/spec/qa';
import Test, {
  parseTagsFlag,
  scenarioLabel,
  selectScenariosByTags,
  suiteHeading,
  tagSelectionLine,
} from '../src/commands/test';

const step: QA.TestStep = { name: 'probe', action: { type: 'api_call', target: '/api/v1/health' } };

const suite: QA.TestSuite = {
  name: 'Tagged suite',
  scenarios: [
    { id: 'smoke-only', name: 'Smoke only', tags: ['smoke'], steps: [step] },
    { id: 'regression-only', name: 'Regression only', tags: ['regression'], steps: [step] },
    { id: 'both', name: 'Smoke and critical', tags: ['critical', 'smoke'], steps: [step] },
    { id: 'untagged', name: 'Untagged', steps: [step] },
    { id: 'cased', name: 'Capitalised tag', tags: ['Smoke'], steps: [step] },
  ],
};

const ids = (s: QA.TestSuite) => s.scenarios.map((scenario) => scenario.id);

describe('selectScenariosByTags — the --tags filter', () => {
  it('selects a scenario carrying ANY of the listed tags, in authored order', () => {
    const { suite: selected, deselected } = selectScenariosByTags(suite, ['smoke', 'regression']);
    expect(ids(selected)).toEqual(['smoke-only', 'regression-only', 'both']);
    expect(deselected).toBe(2);
  });

  it('matches exactly and case-sensitively, and never selects an untagged scenario', () => {
    const { suite: selected, deselected } = selectScenariosByTags(suite, ['smoke']);
    expect(ids(selected)).toEqual(['smoke-only', 'both']);
    expect(deselected).toBe(3);
  });

  it('reports which requested tags matched, so an unmatched one can be named', () => {
    expect(selectScenariosByTags(suite, ['critical', 'smkoe']).matchedTags).toEqual(['critical']);
  });

  it('selects nothing, and says how much it left out, when no scenario carries the tag', () => {
    const { suite: selected, deselected, matchedTags } = selectScenariosByTags(suite, ['nomatch']);
    expect(ids(selected)).toEqual([]);
    expect(deselected).toBe(suite.scenarios.length);
    expect(matchedTags).toEqual([]);
  });

  it('CONTROL — without the flag every scenario is selected, untagged ones included', () => {
    const { suite: selected, deselected } = selectScenariosByTags(suite, undefined);
    expect(ids(selected)).toEqual(ids(suite));
    expect(deselected).toBe(0);
  });

  it('keeps the suite name on the narrowed suite', () => {
    expect(selectScenariosByTags(suite, ['smoke']).suite.name).toBe('Tagged suite');
  });
});

describe('parseTagsFlag — the --tags value', () => {
  it('splits a comma list, trims each name and drops repeats', () => {
    expect(parseTagsFlag('smoke, critical,smoke')).toEqual(['smoke', 'critical']);
  });

  it('refuses an empty entry instead of narrowing the selection silently', () => {
    expect(() => parseTagsFlag('smoke,')).toThrow(/empty tag name/);
    expect(() => parseTagsFlag('')).toThrow(/empty tag name/);
  });
});

describe('report labels — the names the author wrote', () => {
  it('prints the scenario name with its id', () => {
    expect(scenarioLabel({ scenarioId: 'acct-create', scenarioName: 'An account can be created' })).toBe(
      'An account can be created [acct-create]',
    );
  });

  it('prints the id once when the author made the name the same', () => {
    expect(scenarioLabel({ scenarioId: 'acct-create', scenarioName: 'acct-create' })).toBe('acct-create');
  });

  it('heads a suite with its name and the file it came from', () => {
    expect(suiteHeading('Accounts smoke', '/work/qa/accounts.test.json')).toBe(
      '📄 Running suite: Accounts smoke (accounts.test.json)',
    );
  });

  it('states the selection in counts, and that deselected is not passed', () => {
    expect(tagSelectionLine(1, 3, ['smoke'])).toBe(
      '--tags smoke selected 1 of 4 scenarios; 3 deselected (not run, not counted as passed).',
    );
  });
});

describe('os test declares the flag', () => {
  it('has a --tags flag and states the any-of semantics in --help', () => {
    expect(Test.flags.tags).toBeDefined();
    expect(Test.description).toContain('AT LEAST ONE of the listed tags');
  });
});
