// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { judgeSeedRecordValues } from '../src/utils/seed-record-values.js';

/**
 * [#27259] One judge, two moments: every seed row `os validate` refuses on a
 * value, a real seed load refuses with the same sentence, and every row it
 * passes, the load writes. The load here is the platform's own: the
 * `SeedLoaderService` writing through an `ObjectQL` engine on the memory
 * driver, as `os dev` seeds an app.
 */

const PROJECT = {
  name: 'proj_project',
  label: 'Project',
  fields: {
    name: { type: 'text', label: 'Name', required: true },
    budget: { type: 'currency', label: 'Budget' },
    hours: { type: 'number', label: 'Hours', min: 0 },
    stage: { type: 'select', label: 'Stage', options: [{ label: 'Open', value: 'open' }, { label: 'Done', value: 'done' }] },
    tags: { type: 'multiselect', label: 'Tags', options: [{ label: 'Alpha', value: 'alpha' }, { label: 'Beta', value: 'beta' }] },
    due: { type: 'date', label: 'Due' },
  },
};

const RECORDS: Record<string, unknown>[] = [
  { name: 'Refused object', budget: { value: 10, currency: 'USD' } },
  { name: 'Bare number', budget: 10 },
  { name: 'Rewritten values', budget: '10', hours: '2.5', tags: 'alpha', due: '' },
  { name: 'Unreadable number', hours: 'abc' },
  { name: 'Unknown option', stage: 'archived' },
  { name: 'Unreadable date', due: 'yesterday' },
  { name: 'Below min', hours: -1 },
];

let engine: ObjectQL | undefined;
afterEach(async () => {
  await engine?.destroy();
  engine = undefined;
});

async function seedLoad(): Promise<{ written: string[]; refused: Map<number, string> }> {
  const driver = new InMemoryDriver();
  engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registry.registerObject(structuredClone(PROJECT) as never);
  const silent = { info() {}, debug() {}, warn() {}, error() {} };
  const metadata = { getObject: async () => PROJECT, listObjects: async () => [PROJECT] };
  const loader = new SeedLoaderService(engine as never, metadata as never, silent as never);
  const result = await loader.load({
    seeds: [{ object: 'proj_project', externalId: 'name', mode: 'insert', env: ['prod', 'dev', 'test'], records: structuredClone(RECORDS) }],
    config: { dryRun: false, haltOnError: false, multiPass: true, defaultMode: 'insert', batchSize: 1, transaction: false },
  } as never);
  const refused = new Map<number, string>();
  for (const e of result.errors as Array<{ recordIndex?: number; message: string }>) {
    if (typeof e.recordIndex === 'number') refused.set(e.recordIndex, e.message);
  }
  const rows = (await engine.find('proj_project', {})) as Array<{ name: string }>;
  return { written: rows.map((r) => r.name).sort(), refused };
}

describe('[#27259] os validate refuses exactly the seed rows the seed load refuses, in the load\'s words', () => {
  it('a refused row is refused by both with one sentence; a passed row is written', async () => {
    const issues = judgeSeedRecordValues({ objects: [PROJECT], data: [{ object: 'proj_project', records: RECORDS }] });
    const judged = new Map<number, string>();
    for (const issue of issues) {
      const index = Number(/records\[(\d+)\]/.exec(issue.location)![1]);
      expect(judged.has(index)).toBe(false);
      judged.set(index, issue.message);
    }

    const { written, refused } = await seedLoad();

    // The same rows: refused at validate time ⇔ refused at load.
    expect([...judged.keys()].sort()).toEqual([...refused.keys()].sort());
    expect([...judged.keys()].sort()).toEqual([0, 3, 4, 5, 6]);
    // The same sentence: the load quotes the validator's message after the row's key.
    for (const [index, message] of judged) {
      expect(refused.get(index)!.endsWith(`: ${message}`)).toBe(true);
    }
    // Row 0 is the card's case, and carries the currency lesson.
    expect(judged.get(0)!.startsWith('Budget is a currency amount: write it as a bare number')).toBe(true);
    // Every row the check passes is written.
    expect(written).toEqual(['Bare number', 'Rewritten values']);
  });
});
