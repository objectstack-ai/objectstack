// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// System Overview: the copy drawn beside every tile comes from the DATASET, not
// the dashboard. A metric tile's caption is the selected measure's `label`
// (`Users`, `Sessions`, `Events`), and a table or chart over a dimension heads
// it with the dimension's `label` (`Action`). Those strings reach the browser
// through the analytics query, which localizes the saved definition with
// `translateDataset` before it runs (`packages/rest/src/analytics-routes.ts`),
// so they are translated at `datasets.<name>.{measures,dimensions}.<m>.label`
// in the Setup bundle, and nowhere else.
//
// Under zh-CN the tile titles were Chinese (`dashboards.system_overview.*`)
// while the caption under each one read English: the bundle had no `datasets`
// block at all. The tests below resolve every member the board draws through
// the same resolver and the served bundle, per locale.

import { describe, it, expect } from 'vitest';
import { translateDataset } from '@objectstack/spec/system';
import { SystemOverviewDashboard } from './system_overview.dashboard.js';
import { SystemOverviewDatasets } from './system.datasets.js';
import { SetupAppTranslations } from '../translations/index.js';
import { en } from '../translations/en.js';

type Member = { name: string; label?: unknown };
type Group = 'measures' | 'dimensions';

const datasetsByName = new Map(SystemOverviewDatasets.map((d) => [d.name, d]));

/** Every (dataset, group, member) the board actually draws: `values` and `dimensions` of each widget. */
function drawnMembers(): Array<{ dataset: string; group: Group; member: string }> {
  const seen = new Set<string>();
  const out: Array<{ dataset: string; group: Group; member: string }> = [];
  for (const w of SystemOverviewDashboard.widgets ?? []) {
    const widget = w as { dataset?: string; values?: string[]; dimensions?: string[] };
    if (!widget.dataset) continue;
    const pairs: Array<[Group, string[] | undefined]> = [
      ['measures', widget.values],
      ['dimensions', widget.dimensions],
    ];
    for (const [group, names] of pairs) {
      for (const member of names ?? []) {
        const key = `${widget.dataset}.${group}.${member}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ dataset: widget.dataset, group, member });
      }
    }
  }
  return out;
}

function sourceLabel(dataset: string, group: Group, member: string): string | undefined {
  const members = (datasetsByName.get(dataset)?.[group] ?? []) as Member[];
  const label = members.find((m) => m.name === member)?.label;
  return typeof label === 'string' ? label : undefined;
}

const TRANSLATED_LOCALES = Object.keys(SetupAppTranslations).filter((l) => l !== 'en');

describe('System Overview: every dataset label the board draws is translated', () => {
  it('the board draws members of its own datasets', () => {
    const drawn = drawnMembers();
    expect(drawn.length).toBeGreaterThan(0);
    for (const { dataset, group, member } of drawn) {
      expect(sourceLabel(dataset, group, member), `${dataset}.${group}.${member}`).toBeTypeOf('string');
    }
  });

  for (const locale of TRANSLATED_LOCALES) {
    it(`${locale}: no tile caption or column header resolves to the English source`, () => {
      const english: string[] = [];
      for (const { dataset, group, member } of drawnMembers()) {
        const doc = datasetsByName.get(dataset)!;
        const served = translateDataset(doc, SetupAppTranslations, { locale });
        const label = ((served[group] ?? []) as Member[]).find((m) => m.name === member)?.label;
        if (label === sourceLabel(dataset, group, member)) {
          english.push(`datasets.${dataset}.${group}.${member}.label = ${JSON.stringify(label)}`);
        }
      }
      expect(english, `untranslated dataset labels on dashboards.system_overview under ${locale}`).toEqual([]);
    });
  }

  it('en: the bundle copies each drawn label from the declared source verbatim', () => {
    const drift: string[] = [];
    for (const { dataset, group, member } of drawnMembers()) {
      const served = (en.datasets?.[dataset]?.[group] as Record<string, { label?: string }> | undefined)?.[member]?.label;
      const source = sourceLabel(dataset, group, member);
      if (served !== source) drift.push(`datasets.${dataset}.${group}.${member}.label: ${JSON.stringify(served)} ≠ ${JSON.stringify(source)}`);
    }
    expect(drift).toEqual([]);
  });

  for (const locale of Object.keys(SetupAppTranslations)) {
    it(`${locale}: carries no dataset translation for a member the board does not draw`, () => {
      const drawn = new Set(drawnMembers().map(({ dataset, group, member }) => `${dataset}.${group}.${member}`));
      const orphans: string[] = [];
      const datasets = SetupAppTranslations[locale]?.datasets ?? {};
      for (const [dataset, entry] of Object.entries(datasets)) {
        for (const group of ['measures', 'dimensions'] as const) {
          for (const member of Object.keys((entry as Record<Group, Record<string, unknown> | undefined>)[group] ?? {})) {
            if (!drawn.has(`${dataset}.${group}.${member}`)) orphans.push(`datasets.${dataset}.${group}.${member}`);
          }
        }
      }
      expect(orphans).toEqual([]);
    });
  }
});
