// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29049] `flow-region-shape-invalid`: the automation engine's registration
 * verdict on a flow's ADR-0031 regions, as an authoring rule.
 *
 * The subject here is the finding. That the three commands gate on it is
 * pinned in `@objectstack/cli`'s `authoring-rule-command-parity.test.ts`, and
 * `os validate` / `os build` end to end in its
 * `validate-flow-region-shape.test.ts`.
 *
 * The refused-parse cases moved here from the retired CLI walk's own test
 * (#29059): a flow the flow schema refuses is a finding, never a silent pass.
 */

import { describe, expect, it } from 'vitest';
import { validateControlFlow, FlowSchema } from '@objectstack/spec/automation';

import { FLOW_REGION_SHAPE_INVALID, validateFlowRegionShape } from './validate-flow-region-shape.js';
import { AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';

const n = (id: string, type = 'assignment', extra: Record<string, unknown> = {}) => ({ id, type, label: id, ...extra });
const e = (id: string, source: string, target: string) => ({ id, source, target, type: 'default' });

/** d → x, y: one entry, two exits. With `join`, x, y → j closes it. */
const fanOut = (join: boolean) => ({
  nodes: [n('d'), n('x'), n('y'), ...(join ? [n('j')] : [])],
  edges: [e('r1', 'd', 'x'), e('r2', 'd', 'y'), ...(join ? [e('r3', 'x', 'j'), e('r4', 'y', 'j')] : [])],
});

const flow = (name: string, middle: Record<string, unknown>) => ({
  name, label: name, type: 'autolaunched', runAs: 'system', status: 'active',
  nodes: [n('start', 'start'), middle, n('end', 'end')],
  edges: [e('e1', 'start', String(middle.id)), e('e2', String(middle.id), 'end')],
});

const guard = (catchRegion: Record<string, unknown>) =>
  n('guard', 'try_catch', { config: { try: { nodes: [n('work')], edges: [] }, catch: catchRegion } });

/** What the engine's own call says about `raw` — the message the finding must carry. */
const engineRefusal = (raw: unknown): string => {
  try {
    validateControlFlow(FlowSchema.parse(raw));
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('the engine registers this flow');
};

/** A body `FlowSchema` refuses: `nodes` must be an array. */
const unparseable = (name?: string) => ({ ...(name === undefined ? {} : { name }), label: 'Broken', type: 'autolaunched', nodes: 'start', edges: [] });

describe('[#29049] flow-region-shape-invalid', () => {
  it('a multi-exit region: one error carrying the engine\'s refusal behind the flow\'s name', () => {
    const bad = flow('rgn_lead_time', guard(fanOut(false)));
    const findings = validateFlowRegionShape({ flows: [flow('rgn_ok', guard(fanOut(true))), bad] });
    expect(findings.map(({ severity, rule, where, path }) => ({ severity, rule, where, path }))).toEqual([
      { severity: 'error', rule: FLOW_REGION_SHAPE_INVALID, where: "flow 'rgn_lead_time' › node 'guard'", path: 'flows[1].nodes[1]' },
    ]);
    expect(findings[0]!.message).toBe(`Flow 'rgn_lead_time' would be refused at registration: ${engineRefusal(bad)}`);
    expect(findings[0]!.message).toContain("try_catch 'guard' catch: region must be single-exit");
  });

  it('a parallel with one branch is refused with the engine\'s sentence', () => {
    const bad = flow('rgn_fan', n('fan', 'parallel', { config: { branches: [{ nodes: [n('only')], edges: [] }] } }));
    const [finding] = validateFlowRegionShape({ flows: [bad] });
    expect(finding?.message).toContain("parallel 'fan': a parallel block needs at least 2 branches");
  });

  describe('[#29558] the finding is anchored on the container the engine names', () => {
    it('a top-level container: the path and where name the try_catch at fault, the message is unchanged', () => {
      const bad = flow('rgn_lead_time', guard(fanOut(false)));
      const [finding, ...rest] = validateFlowRegionShape({ flows: [flow('rgn_ok', guard(fanOut(true))), bad] });
      expect(rest).toEqual([]);
      expect(finding).toMatchObject({ path: 'flows[1].nodes[1]', where: "flow 'rgn_lead_time' › node 'guard'" });
      expect(finding!.message).toBe(`Flow 'rgn_lead_time' would be refused at registration: ${engineRefusal(bad)}`);
    });

    it('a nested container: a one-branch parallel inside a try region is anchored where it sits', () => {
      const bad = flow('rgn_nested', n('guard', 'try_catch', {
        config: {
          try: { nodes: [n('fan', 'parallel', { config: { branches: [{ nodes: [n('only')], edges: [] }] } })], edges: [] },
          catch: { nodes: [n('recover')], edges: [] },
        },
      }));
      const [finding] = validateFlowRegionShape({ flows: [bad] });
      expect(finding).toMatchObject({ path: 'flows[0].nodes[1].config.try.nodes[0]', where: "flow 'rgn_nested' › node 'fan'" });
      expect(finding!.message).toBe(`Flow 'rgn_nested' would be refused at registration: ${engineRefusal(bad)}`);
    });

    it('a container in a parallel branch: the branch index is part of the path', () => {
      const looped = n('sweep', 'loop', {
        config: { collection: [1, 2], iteratorVariable: 'row', body: fanOut(false) },
      });
      const bad = flow('rgn_branch', n('fan', 'parallel', {
        config: { branches: [{ nodes: [n('left')], edges: [] }, { nodes: [looped], edges: [] }] },
      }));
      const [finding] = validateFlowRegionShape({ flows: [bad] });
      expect(finding).toMatchObject({ path: 'flows[0].nodes[1].config.branches[1].nodes[0]', where: "flow 'rgn_branch' › node 'sweep'" });
      expect(finding!.message).toContain("loop 'sweep' body");
    });
  });

  it('CONTROL: the same flow with the join restored has no finding, nor does a stack with no flows', () => {
    expect(validateFlowRegionShape({ flows: [flow('rgn_lead_time', guard(fanOut(true)))] })).toEqual([]);
    expect(validateFlowRegionShape({})).toEqual([]);
  });

  describe('[#29059] a flow the flow schema refuses is a finding, never a silent pass', () => {
    it('names the flow, its path and the schema\'s issue', () => {
      const [finding, ...rest] = validateFlowRegionShape({ flows: [unparseable('rgn_broken')] });
      expect(rest).toEqual([]);
      expect(finding).toMatchObject({ severity: 'error', rule: FLOW_REGION_SHAPE_INVALID, where: "flow 'rgn_broken'", path: 'flows[0]' });
      expect(finding!.message).toContain('could not be judged');
      expect(finding!.message).toContain('nodes');
    });

    it('a non-record entry is no flow and draws nothing; the flow after it keeps its own index', () => {
      const bad = flow('rgn_lead_time', guard(fanOut(false)));
      const findings = validateFlowRegionShape({ flows: [null, 'x', bad] });
      expect(findings.map(({ path }) => path)).toEqual(['flows[2]']);
    });

    it('a body with no string name is named by its path', () => {
      const [finding] = validateFlowRegionShape({ flows: [unparseable()] });
      expect(finding).toMatchObject({ where: "flow 'flows[0]'", path: 'flows[0]' });
    });
  });

  it('is registered as a gating rule on all three commands, and the registry run reports it', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateFlowRegionShape');
    expect(entry).toMatchObject({ tier: 'gating', input: 'parsed', commands: ['validate', 'build', 'lint'] });
    const stack = { flows: [flow('rgn_lead_time', guard(fanOut(false)))] };
    for (const command of ['validate', 'build', 'lint'] as const) {
      const rules = runAuthoringRules(command, { normalized: stack, ...(command === 'lint' ? {} : { parsed: stack }) })
        .filter((f) => f.severity === 'error')
        .map((f) => f.rule);
      expect(rules, command).toContain(FLOW_REGION_SHAPE_INVALID);
    }
  });
});
