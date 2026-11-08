// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every Build check traces to text the build prompt carries. Otherwise a
 * faithful build fails for not guessing a name.
 *
 * The exact-name checks are read off the scorer itself (`scoreGraph` over an
 * empty graph emits one check per `expect` row), so a new kind of row the
 * contract does not state is red here, not in a model run. The tag-driven
 * checks a card's prose has to carry are pinned beside them.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { applyExpectDelta, formatRefusal, loadScenarios, readCapabilityAreas, type LoadedScenario } from '../../src/loader.js';
import { namespacedScenario } from '../../src/runner/namespace.js';
import { buildPrompt, iteratePrompt, templateIteratePrompt } from '../../src/runner/prompts.js';
import { scoreGraph } from '../../src/score/scenario-score.js';
import type { ScenarioCard, ScenarioExpect } from '../../src/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = resolve(HERE, '../../../../../docs/qa/scenarios');
const AREAS_DIR = resolve(HERE, '../../../../../docs/qa/platform-checklist/areas');

const library = loadScenarios(SCENARIOS_DIR, { areas: readCapabilityAreas(AREAS_DIR), library: 'open' });
const cards: LoadedScenario[] = library.cards.map(namespacedScenario);

const code = (name: string): string => `\`${name}\``;

/** The check names `scoreGraph` emits for `expect` on a graph that carries nothing: one per row. */
const checksOf = (ex: ScenarioExpect): string[] => scoreGraph({ objects: [] }, ex).checks.map((c) => c.check);

/**
 * The prompt text an exact-name check must find, by the check's own spelling
 * (`scenario-score.ts`). A check this does not know is returned as `undefined`
 * so the test names it: the contract has not been taught to state it.
 */
function tracesTo(check: string, prompt: string, card: ScenarioCard, phase: 'build' | 'iterate'): boolean | undefined {
  let m: RegExpExecArray | null;
  if ((m = /^object:([a-z0-9_]+):minFields>=(\d+)$/.exec(check))) {
    // Build: the seed in the contract shows the fields. Iterate: a new object has no seed rows, so the change says so.
    if (phase === 'iterate') return prompt.includes(`each with at least ${m[2]} fields`);
    return (card.run.seed[m[1]!] ?? []).some((row) => Object.keys(row).filter((k) => k !== 'id').length >= Number(m![2]));
  }
  if ((m = /^object:([a-z0-9_]+)$/.exec(check))) return prompt.includes(phase === 'build' ? `"${m[1]}"` : code(m[1]!));
  if ((m = /^lookup:([a-z0-9_]+\.[a-z0-9_]+)->([a-z0-9_]+)$/.exec(check))) return prompt.includes(`${code(m[1]!)} → ${code(m[2]!)}`);
  if ((m = /^select:([a-z0-9_]+\.[a-z0-9_]+)>=(\d+)opts$/.exec(check))) return prompt.includes(`${code(m[1]!)} (${m[2]})`);
  if ((m = /^dashboard:([a-z0-9_]+)$/.exec(check))) return /^- Dashboards, each a dashboard named exactly: .*$/m.exec(prompt)?.[0].includes(code(m[1]!)) ?? false;
  if ((m = /^nav:([a-z0-9_]+)->exists$/.exec(check))) return /^- The app's navigation has an entry for each of: .*$/m.exec(prompt)?.[0].includes(code(m[1]!)) ?? false;
  return undefined;
}

const SERVER = { baseUrl: 'http://x', adminEmail: 'a@x', adminPassword: 'p' };

describe('every Build check traces to the build prompt', () => {
  it('loads the library', () => {
    expect(library.refusals.map(formatRefusal)).toEqual([]);
    expect(cards.length).toBeGreaterThan(0);
  });

  for (const { card } of cards) {
    it(`${card.id}: each exact-name check of \`expect\` names what the build prompt states`, () => {
      const prompt = buildPrompt(card);
      const untraced = checksOf(card.expect).filter((c) => tracesTo(c, prompt, card, 'build') !== true);
      expect(untraced).toEqual([]);
    });

    it(`${card.id}: each exact-name check the iterate change adds names what both iterate prompts state`, () => {
      const base = new Set(checksOf(card.expect));
      const added = checksOf(applyExpectDelta(card.expect, card.iterate.expectDelta)).filter((c) => !base.has(c));
      expect(added.length).toBeGreaterThan(0);
      for (const prompt of [iteratePrompt(card), templateIteratePrompt(card, SERVER)]) {
        expect(added.filter((c) => tracesTo(c, prompt, card, 'iterate') !== true)).toEqual([]);
      }
    });

    it(`${card.id}: the select-options tag's two-option floor, for every option field, is stated where the card carries it`, () => {
      const floor = /^- Every (other )?single-choice field you declare offers at least two options/m;
      const tagged = card.capabilities.includes('records-forms.select-options');
      for (const prompt of [buildPrompt(card), iteratePrompt(card)]) expect(floor.test(prompt)).toBe(tagged);
    });

    if (card.capabilities.includes('records-forms.master-detail-inline-edit')) {
      it(`${card.id}: carries the inline-edit tag, so its prose asks for a detail edited inline on its master`, () => {
        const { en, zh } = card.prompt.detailed;
        if (en !== undefined) expect(en).toMatch(/inline/i);
        if (zh !== undefined) expect(zh).toMatch(/内联/);
      });
    }
  }
});

describe('approvals: a card models them as data or exercises the platform engine, never both', () => {
  // A card that seeds the decision date of an approval as a plain field holds
  // its approval history as rows, and grades approving as a data write on them
  // (an operation updating `decision` / `status`). The platform's approval
  // engine keeps its own history, which no seed row can preload, so such a
  // card carries no `approvals.*` tag: the tag rows would grade a build for an
  // engine the card's data never runs through.
  const decisionDates = (card: ScenarioCard): string[] =>
    Object.entries(card.run.seed).flatMap(([object, rows]) =>
      [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((f) => f === 'decided_on' || f === 'approved_on').map((f) => `${object}.${f}`),
    );

  for (const { card } of cards) {
    const dates = decisionDates(card);
    if (dates.length === 0) continue;
    it(`${card.id}: seeds ${dates.join(', ')}, so carries no approvals.* tag and asks for no approval process`, () => {
      expect(card.capabilities.filter((t) => t.startsWith('approvals.'))).toEqual([]);
      expect(card.prompt.detailed.en ?? '').not.toMatch(/an approval process/);
      expect(card.prompt.detailed.zh ?? '').not.toMatch(/审批流程/);
    });
  }

  it('the five cards that seed approval history are the ones measured', () => {
    expect(cards.filter(({ card }) => decisionDates(card).length > 0).map(({ card }) => card.id)).toEqual([
      'asset_lifecycle',
      'leave_balances',
      'order_to_cash',
      'requisition_to_receipt',
      'travel_expense',
    ]);
  });
});
