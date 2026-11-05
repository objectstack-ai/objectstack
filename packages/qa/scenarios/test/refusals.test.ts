// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A malformed card is REFUSED with its file and the field path — each class
 * of refusal asserted on its own. Every case starts from a real library card
 * that loads clean, changes exactly one thing, and asserts the loader names
 * that thing: the file, the path, and the class of the fault.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarios, readCapabilityAreas, type Refusal } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_CARD = resolve(HERE, '../../../../docs/qa/scenarios/tickets_select_dense.json');
const AREAS_DIR = resolve(HERE, '../../../../docs/qa/platform-checklist/areas');

const areas = readCapabilityAreas(AREAS_DIR);
const base = JSON.parse(readFileSync(BASE_CARD, 'utf8'));
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a card is mutated as raw JSON on purpose
type RawCard = any;

function load(mutate: (card: RawCard) => void, fileName = `${base.id}.json`) {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-refusal-'));
  dirs.push(dir);
  const card = structuredClone(base);
  mutate(card);
  const file = join(dir, fileName);
  writeFileSync(file, JSON.stringify(card, null, 2));
  return { file, ...loadScenarios(dir, { areas }) };
}

/** Exactly one refusal, at `path`, in `file`, whose message matches. */
function expectOneRefusal(r: { file: string; cards: unknown[]; refusals: Refusal[] }, path: string, message: RegExp) {
  expect(r.refusals.map(formatRefusal)).toHaveLength(1);
  expect(r.refusals[0]).toMatchObject({ file: r.file, path });
  expect(r.refusals[0].message).toMatch(message);
  // A refused card is not handed out half-valid.
  expect(r.cards).toEqual([]);
}

describe('scenario card refusals', () => {
  it('the unmutated base card loads clean (control)', () => {
    const r = load(() => {});
    expect(r.refusals).toEqual([]);
    expect(r.cards).toHaveLength(1);
  });

  // ── the three classes the card names ──

  it('refuses an unknown capability area, naming the closed set', () => {
    const r = load((c) => {
      c.capabilities[0] = 'billing.invoices';
    });
    expectOneRefusal(r, 'capabilities[0]', /unknown capability area `billing`.*records-forms/);
  });

  it('refuses a category outside the closed enum', () => {
    const r = load((c) => {
      c.category = 'retail';
    });
    expectOneRefusal(r, 'category', /expected one of/);
  });

  it('refuses a truth kind outside count | sum | avg | min | max | topN', () => {
    const r = load((c) => {
      c.run.questions[0].truth.kind = 'median';
    });
    expectOneRefusal(r, 'run.questions[0].truth.kind', /discriminator/);
  });

  // ── shape ──

  it('refuses an unknown key, locating the key itself', () => {
    const r = load((c) => {
      c.run.questions[0].truth.limit = 5;
    });
    expectOneRefusal(r, 'run.questions[0].truth.limit', /unknown key `limit`/);
  });

  it('refuses a card whose id is not its basename', () => {
    const r = load(() => {}, 'support_tickets.json');
    expectOneRefusal(r, 'id', /must equal the file's basename `support_tickets`/);
  });

  it('refuses a file that is not JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenario-refusal-'));
    dirs.push(dir);
    const file = join(dir, 'broken.json');
    writeFileSync(file, '{ "id": ');
    const r = loadScenarios(dir, { areas });
    expectOneRefusal({ file, ...r }, '(card)', /not valid JSON/);
  });

  it('refuses a prompt with no language', () => {
    const r = load((c) => {
      c.prompt.short = {};
    });
    expectOneRefusal(r, 'prompt.short', /at least one language/);
  });

  it('refuses a Run half with fewer than three questions', () => {
    const r = load((c) => {
      c.run.questions = c.run.questions.slice(0, 2);
    });
    expectOneRefusal(r, 'run.questions', /3/);
  });

  // ── expect consistency ──

  it('refuses a lookup to an object the card does not expect', () => {
    const r = load((c) => {
      c.expect.lookups = [{ object: 'ticket', field: 'requester', to: 'customer' }];
    });
    expectOneRefusal(r, 'expect.lookups[0].to', /lookup target `customer` is not in expect.objects/);
  });

  it('refuses a dangling app nav target', () => {
    const r = load((c) => {
      c.expect.appNavTargets = ['ticket', 'overview'];
    });
    expectOneRefusal(r, 'expect.appNavTargets[1]', /dangling nav/);
  });

  it('refuses a seed thinner than minFieldsPerObject', () => {
    const r = load((c) => {
      c.expect.minFieldsPerObject = 6;
    });
    expectOneRefusal(r, 'run.seed.ticket', /5 field\(s\), fewer than expect.minFieldsPerObject = 6/);
  });

  // ── questions ──

  it('refuses a question reading a field no seed row carries (no truth is computed from a typo)', () => {
    const r = load((c) => {
      c.run.questions[3].truth.field = 'hours';
    });
    expectOneRefusal(r, 'run.questions[3].truth.field', /no seed row of `ticket` carries `hours`/);
  });

  it('refuses a topN whose cut-off falls inside a tie', () => {
    const r = load((c) => {
      // high 2, low 2: the top 1 priority is not determined by the seed.
      c.run.questions[4].truth.groupBy = 'priority';
    });
    expectOneRefusal(r, 'run.questions[4].truth.n', /inside a tie/);
  });

  it('refuses an average over zero rows', () => {
    const r = load((c) => {
      c.run.questions[3].truth = {
        kind: 'avg',
        field: 'hours_spent',
        filter: [{ field: 'status', op: 'eq', value: 'archived' }],
      };
    });
    expectOneRefusal(r, 'run.questions[3].truth', /undefined/);
  });

  it('refuses a numeric aggregate over a text value', () => {
    const r = load((c) => {
      c.run.questions[3].truth = { kind: 'sum', field: 'subject' };
    });
    expectOneRefusal(r, 'run.questions[3].truth.field', /is not a number/);
  });

  // ── seed, personas, operations, guardrails, iterate ──

  it('refuses a lookup value naming no seeded row', () => {
    const r = load((c) => {
      c.expect.objects.push('support_agent');
      c.expect.lookups = [{ object: 'ticket', field: 'assignee', to: 'support_agent' }];
      c.run.seed.support_agent = [{ id: 'sa1', name: 'Gus', team: 'tier1', shift: 'day', seniority: 2 }];
      c.run.seed.ticket[0].assignee = 'sa9';
      c.iterate.expectDelta = { selectFields: [{ object: 'support_agent', field: 'team', minOptions: 2 }] };
    });
    expectOneRefusal(r, 'run.seed.ticket[0].assignee', /names no seeded `support_agent` row/);
  });

  it('refuses a persona that hides nothing', () => {
    const r = load((c) => {
      c.run.personas[1].hidden = {};
    });
    expectOneRefusal(r, 'run.personas[1].hidden', /at least one object or field/);
  });

  it('refuses an operation on a row the seed does not hold', () => {
    const r = load((c) => {
      c.run.operations[1].target = 'k99';
    });
    expectOneRefusal(r, 'run.operations[1].target', /no seeded `ticket` row has id `k99`/);
  });

  it('refuses a card that drops one of the five guardrail checks', () => {
    const r = load((c) => {
      c.run.guardrails = c.run.guardrails.filter((g: { check: string }) => g.check !== 'audit_actor');
    });
    // Four checks is below the schema floor of five, so it is refused there.
    expect(r.refusals.map((x) => x.path)).toEqual(['run.guardrails']);
    expect(r.refusals[0].file).toBe(r.file);
    expect(r.cards).toEqual([]);
  });

  it('refuses an injection guardrail pointing at a non-text cell', () => {
    const r = load((c) => {
      const g = c.run.guardrails.find((x: { check: string }) => x.check === 'injection_as_data');
      g.cell = { object: 'ticket', id: 'k4', field: 'hours_spent' };
    });
    expectOneRefusal(r, 'run.guardrails[4].cell.field', /not a text cell/);
  });

  it('refuses an iterate delta that re-adds an expected object', () => {
    const r = load((c) => {
      c.iterate.expectDelta = { objects: ['ticket'] };
    });
    expectOneRefusal(r, 'iterate.expectDelta.objects[0]', /already in expect.objects/);
  });
});
