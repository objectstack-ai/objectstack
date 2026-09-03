// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#13837 — `os i18n check --help` must name the surface SET it
// reports on, never a sample of it.
//
// The shipped description named five source kinds — `object/field/option/
// view/action` — in a parenthetical, against a fifteen-member
// `CoverageIssue['source']` taxonomy that `computeI18nCoverage` passes through
// untouched from `collectExpectedEntries`. A five-of-fifteen sample does not
// read as an illustration; it reads as a scope statement. Someone who wanted
// app navigation or dashboard widgets checked was told by `--help` that this
// command does objects and fields, and either skipped the gate or went looking
// for a second tool that does not exist. The capability was shipped and hidden
// by its own description — the same false sentence PR #13833 corrected in the
// published `objectstack-i18n` skill, of which this was the upstream twin.
//
// So the assertion that matters here is not "the wording changed". It is
// PARITY, measured two ways that fail independently:
//
//   1. against the TAXONOMY — every kind `CoverageIssue['source']` declares is
//      named in the description (deriving `COVERAGE_SURFACE_PHRASE` from a
//      `Record<CoverageIssue['source'], string>` is what makes a forgotten
//      member a compile error, and this is its runtime witness);
//   2. against BEHAVIOUR — every kind a real walk over a real stack actually
//      reports is named in the description. A derivation that quietly stopped
//      being wired into `description` would still pass (1) if someone re-typed
//      the list; only (2) catches the taxonomy growing past the walk.
//
// ⛔ Do not relax either direction into "contains 'translation keys'". The
// retired description passed that.

import { describe, it, expect } from 'vitest';
import I18nCheck from '../src/commands/i18n/check.js';
import {
  COVERAGE_SOURCE_KINDS,
  COVERAGE_SURFACE_PHRASE,
  computeI18nCoverage,
  type CoverageIssue,
} from '../src/utils/i18n-coverage.js';

const description = String(I18nCheck.description);
const summary = String(I18nCheck.summary);

/**
 * A small but ordinary stack: one object (fields, a select's options, a field
 * group heading, a list view, an inline action with a param), one global
 * action, one app with nested navigation, one dashboard with a widget, one
 * analytics dataset, one page carrying a filter-preset tab. Nothing exotic —
 * the point is how much of the taxonomy an unremarkable app reaches.
 */
const stack = {
  i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
  objects: [
    {
      name: 'account',
      label: 'Account',
      fields: {
        name: { label: 'Name', group: 'basics' },
        stage: {
          label: 'Stage',
          group: 'basics',
          type: 'select',
          options: [
            { label: 'New', value: 'new' },
            { label: 'Won', value: 'won' },
          ],
        },
      },
      fieldGroups: [{ key: 'basics', label: 'Basics', fields: ['name', 'stage'] }],
      actions: [{ name: 'merge', label: 'Merge', params: [{ name: 'target', label: 'Target' }] }],
      listViews: { all: { label: 'All Accounts' } },
    },
  ],
  actions: [{ name: 'import_data', label: 'Import Data' }],
  apps: [
    {
      name: 'sales',
      label: 'Sales',
      description: 'Sales workspace',
      navigation: [
        { id: 'accounts', label: 'Accounts', items: [{ id: 'mine', label: 'My Accounts' }] },
      ],
    },
  ],
  dashboards: [
    { name: 'pipeline', label: 'Pipeline', widgets: [{ id: 'open_deals', title: 'Open Deals' }] },
  ],
  datasets: [
    {
      name: 'account_metrics',
      label: 'Account Metrics',
      object: 'account',
      dimensions: [{ name: 'stage', label: 'Stage', field: 'stage', type: 'string' }],
      measures: [{ name: 'count', label: 'Accounts', aggregate: 'count' }],
    },
  ],
  pages: [
    {
      name: 'account_console',
      label: 'Account Console',
      object: 'account',
      interfaceConfig: {
        source: 'account',
        userFilters: { tabs: [{ name: 'urgent', label: 'Urgent' }] },
      },
      regions: [],
    },
  ],
};

/** The surface phrase `--help` shows for one source kind. */
const surfaceOf = (kind: CoverageIssue['source']): string => {
  const index = COVERAGE_SOURCE_KINDS.indexOf(kind);
  expect(index, `${kind} is not a declared coverage source kind`).toBeGreaterThanOrEqual(0);
  return COVERAGE_SURFACE_PHRASE.split(', ')[index];
};

describe('`os i18n check --help` names the surface set, not a sample of it', () => {
  it('names every source kind the coverage taxonomy declares', () => {
    const unnamed = COVERAGE_SOURCE_KINDS.filter((kind) => !description.includes(surfaceOf(kind)));
    expect(unnamed, `--help omits ${unnamed.length} of ${COVERAGE_SOURCE_KINDS.length} kinds`).toEqual([]);
  });

  it('carries the derived phrase verbatim, so a retyped list cannot pass', () => {
    expect(description).toContain(COVERAGE_SURFACE_PHRASE);
  });

  it('no longer carries the retired five-of-fifteen sample', () => {
    expect(description).not.toContain('(object/field/option/view/action labels)');
    expect(summary).not.toContain('(object/field/option/view/action labels)');
  });

  it('keeps the one-line `summary` free of a surface sample entirely', () => {
    // oclif's COMMANDS list shows `summary`, which has no room for the set —
    // so it names none of the kinds rather than a few of them. Naming a strict
    // subset here would restore the defect in the place a user meets first.
    const named = COVERAGE_SOURCE_KINDS.filter((kind) => summary.includes(surfaceOf(kind)));
    expect(named, `summary names ${named.length} of ${COVERAGE_SOURCE_KINDS.length} kinds`).toEqual([]);
  });
});

describe('`--help` and the report agree on an ordinary stack', () => {
  const report = computeI18nCoverage(stack);
  const reported = [...new Set(report.issues.map((issue) => issue.source))].sort();

  it('reaches well past the five kinds the retired description sampled', () => {
    // Guards the fixture itself: a fixture that degraded to objects+fields
    // would make the parity assertion below vacuously true.
    expect(reported.length).toBeGreaterThan(5);
  });

  it('names every kind the report actually emits', () => {
    const unnamed = reported.filter((kind) => !description.includes(surfaceOf(kind)));
    expect(unnamed, `reported but absent from --help: ${unnamed.join(', ')}`).toEqual([]);
  });
});
