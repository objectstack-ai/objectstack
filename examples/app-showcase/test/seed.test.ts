// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import stack from '../objectstack.config.js';
import { ShowcaseSeedData } from '../src/data/seed/index.js';

/**
 * Smoke test — the stack loads and registers the expected breadth of
 * metadata. This guards the metadata-loading pipeline end-to-end.
 */
describe('showcase stack', () => {
  it('registers the core objects', () => {
    const names = (stack.objects ?? []).map((o: { name: string }) => o.name);
    expect(names).toContain('showcase_project');
    expect(names).toContain('showcase_task');
    expect(names).toContain('showcase_field_zoo');
    // 6 objects: account, project, task, category, team, membership, field_zoo
    expect((stack.objects ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('registers UI, automation, security, and AI metadata', () => {
    expect((stack.views ?? []).length).toBeGreaterThan(0);
    expect((stack.dashboards ?? []).length).toBeGreaterThan(0);
    // ADR-0021 single-form: the former flat `tabular` TaskListReport was
    // reclassified as a ListView (a flat list is a row lens, not analytics),
    // leaving 3 dataset-bound analytics reports.
    expect((stack.reports ?? []).length).toBe(3);
    expect((stack.flows ?? []).length).toBeGreaterThan(0);
    // Nine flat positions (contributor/manager/exec/auditor/ops/
    // field_ops_delegate/client_portal_user, plus finance/legal for the v16
    // approval sign-off flows) — the ADR-0090 distribution layer; `everyone`
    // and `guest` are built-in anchors and never declared by the app.
    expect((stack.positions ?? []).length).toBe(9);
    expect((stack.agents ?? []).length).toBe(0); // AI agents are an enterprise (service-ai) feature; the open showcase ships none
  });
});

/**
 * Static shadow of the seed contract after #3433: a seed write is a curated
 * end-state fact, so the platform EXEMPTS it from the object's `state_machine`
 * rule — a project is seeded directly `active` / `on_hold` / `completed`
 * without walking the FSM up from `planned` (the three-phase walk workaround
 * of #3415 is gone). This guard pins the new contract for every object whose
 * state_machine gates INSERT (`initialStates`):
 *   1. every seeded value is still a state the FSM DECLARES (a curated fact,
 *      not a typo — the exemption is not a license to write garbage); and
 *   2. the fixture actually EXERCISES the exemption by seeding ≥1 non-initial
 *      state, so a regression back to "all rows enter as the initial state"
 *      (a re-introduced walk, or a fixture that collapses the board to one
 *      column) fails here. The #3433 failure was 1/5 projects surviving.
 */
describe('seed data vs state machines (#3433)', () => {
  const gated = (stack.objects ?? []).flatMap((o: any) =>
    (o.validations ?? [])
      .filter(
        (v: any) =>
          v.type === 'state_machine' &&
          (v.events ?? []).includes('insert') &&
          Array.isArray(v.initialStates) &&
          v.severity !== 'warning',
      )
      .map((v: any) => ({ object: o, rule: v })),
  );

  it('covers the project status flow (the #3433 gate)', () => {
    expect(gated.map((g: any) => `${g.object.name}.${g.rule.field}`)).toContain('showcase_project.status');
  });

  for (const { object, rule } of gated) {
    it(`${object.name}: seeded '${rule.field}' is FSM-exempt but stays within declared states (#3433)`, () => {
      const datasets = ShowcaseSeedData.filter((d: any) => d.object === object.name);
      expect(datasets.length).toBeGreaterThan(0);

      // Every state the FSM knows about — the legal value universe, derived
      // from the rule itself (no dependency on the field's option shape).
      const fsmStates = new Set<string>(
        [
          ...rule.initialStates,
          ...Object.keys(rule.transitions ?? {}),
          ...Object.values(rule.transitions ?? {}).flat(),
        ].map(String),
      );

      const seeded = new Set<string>();
      for (const ds of datasets as any[]) {
        for (const rec of ds.records as any[]) {
          const v = rec[rule.field];
          if (v === undefined || v === null) continue;
          const key = String(rec[ds.externalId ?? 'name']);
          // #3433: a seed value need NOT be an initialState (the FSM entry
          // guard is exempt), but it must be a state the machine declares.
          expect(fsmStates, `'${key}' seeds '${rule.field}=${String(v)}'`).toContain(String(v));
          seeded.add(String(v));
        }
      }

      // The exemption must actually be used: seed at least one state the FSM
      // entry point would reject on INSERT. Guards against a silent regression
      // to a planned-only fixture (or a re-introduced FSM walk).
      const nonInitial = [...seeded].filter((v) => !rule.initialStates.includes(v));
      expect(
        nonInitial.length,
        `${object.name} seeds only initial states (${[...seeded].join(', ')}) — #3433 exemption unused`,
      ).toBeGreaterThan(0);
    });
  }
});
