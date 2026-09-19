// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14945] A flow can REFUSE with per-record text — the `end` node's
 * `outcome` / `message` contract, pinned at every door it has.
 *
 * Before-state, measured on `c99449ab5` (2026-09-05): `FlowSchema.safeParse`
 * ACCEPTED every probe below — `{ outcome: 'refused' }` with no message, a
 * bogus outcome, an undeclared key — because `end` is structural (no executor,
 * no descriptor) and the node `config` slot is an open record, so an `end`
 * node's config was an unvalidated bag that the engine then ignored: a refusal
 * an author wrote shipped as a plain completion. `ExecutionStatus` refused
 * `'refused'`.
 *
 * Maintainer ruling 2026-09-05 (option 2′): the refusal is a first-class
 * outcome of the existing terminal node. These pins are the CONTRACT's; the
 * engine's (a two-record fixture yielding per-record text) and the runner's
 * (no Submit, no completion toast, `successMessage` still silent) belong to
 * the services and objectui halves.
 */
import { describe, it, expect } from 'vitest';
import { EndConfigSchema } from './builtin-node-config.zod';
import { FlowSchema, FlowNodeSchema, defineFlow, type Flow } from './flow.zod';
import { ExecutionLogSchema, ExecutionStatus } from './execution.zod';
import { formatZodError } from '../shared/error-map.zod';

const REFUSAL = 'Refused: {record.name} is a confirmed duplicate of {duplicate.name}';

/** The card-shape flow: start → end, with the end node's config under test. */
const flowEndingWith = (config: Record<string, unknown> | undefined): Flow => ({
  name: 'refuse_flow',
  label: 'Refuse flow',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End', ...(config === undefined ? {} : { config }) },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

const endConfigOf = (flow: { nodes: Array<{ config?: unknown }> }) => flow.nodes[1].config;

describe('EndConfigSchema — the `end` node contract (#14945)', () => {
  it('defaults `outcome` to `completed` on an empty config', () => {
    expect(EndConfigSchema.parse({})).toEqual({ outcome: 'completed' });
    expect(EndConfigSchema.parse({ outcome: 'completed' })).toEqual({ outcome: 'completed' });
  });

  it('accepts the card shape — `refused` with an interpolated `message` — and preserves the template verbatim', () => {
    expect(EndConfigSchema.parse({ outcome: 'refused', message: REFUSAL }))
      .toEqual({ outcome: 'refused', message: REFUSAL });
  });

  it("REFUSES `outcome: 'refused'` without a `message` — the issue sits on `message` and says why", () => {
    const result = EndConfigSchema.safeParse({ outcome: 'refused' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    const [issue] = result.error.issues;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['message']);
    expect(issue.message).toContain("`outcome: 'refused'` requires a `message`");
    expect(issue.message).toContain('{record.name}');
  });

  it('REFUSES an empty `message` on a refusal — a refusal without text, spelled as an empty string', () => {
    const result = EndConfigSchema.safeParse({ outcome: 'refused', message: '' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => [i.code, i.path])).toEqual([['too_small', ['message']]]);
  });

  it.each([
    ['explicit', { outcome: 'completed', message: 'never shown' }],
    ['omitted', { message: 'never shown' }],
  ])('REFUSES `message` on a completed end (outcome %s) — a key nothing would ever render', (_label, config) => {
    const result = EndConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    const [issue] = result.error.issues;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['message']);
    expect(issue.message).toContain("only rendered when `outcome` is 'refused'");
    expect(issue.message).toContain('silent no-op');
  });

  it('REFUSES an outcome outside the two, as an enum violation on `outcome`', () => {
    const result = EndConfigSchema.safeParse({ outcome: 'rejected' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => [i.code, i.path])).toEqual([['invalid_value', ['outcome']]]);
  });

  it('is strict — an undeclared key is refused with the surface named and the intended key suggested', () => {
    const result = EndConfigSchema.safeParse({ outcome: 'refused', message: REFUSAL, reason: 'duplicate' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    const [issue] = result.error.issues;
    expect(issue.code).toBe('unrecognized_keys');
    expect((issue as { keys?: string[] }).keys).toEqual(['reason']);
    expect(issue.message).toContain('this end node config');
    expect(issue.message).toContain('Did you mean `reason` → `message`?');
    // The history line: what an undeclared key silently did before.
    expect(issue.message).toContain('shipped as a plain completion');
  });

  it("names `message` for the screen-node spelling a refusal migrates OUT of (`description`), and `outcome` for `status`", () => {
    const description = EndConfigSchema.safeParse({ outcome: 'refused', description: REFUSAL });
    expect(description.success).toBe(false);
    if (!description.success) {
      expect(description.error.issues[0].message).toContain('Did you mean `description` → `message`?');
    }
    const status = EndConfigSchema.safeParse({ status: 'refused', message: REFUSAL });
    expect(status.success).toBe(false);
    if (!status.success) {
      expect(status.error.issues[0].message).toContain('Did you mean `status` → `outcome`?');
    }
  });

  it('tells an author reaching for `title` that an end has no heading', () => {
    const result = EndConfigSchema.safeParse({ outcome: 'refused', message: REFUSAL, title: 'Refused' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toContain('An `end` node has no heading');
  });
});

describe('FlowSchema applies the `end` contract — the structural node\'s only door (#14945)', () => {
  it('accepts the card-shape probe and writes the parsed config back', () => {
    const result = FlowSchema.safeParse(flowEndingWith({ outcome: 'refused', message: REFUSAL }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(endConfigOf(result.data)).toEqual({ outcome: 'refused', message: REFUSAL });
  });

  it('`outcome` omitted ⇒ parses with the default `completed` written back', () => {
    const result = FlowSchema.safeParse(flowEndingWith({}));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(endConfigOf(result.data)).toEqual({ outcome: 'completed' });
  });

  it('an `end` with no `config` at all is left without one — no config block materialised on a plain terminal', () => {
    const result = FlowSchema.safeParse(flowEndingWith(undefined));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect('config' in result.data.nodes[1]).toBe(false);
  });

  it("REFUSES `outcome: 'refused'` without a `message` at `nodes[i].config.message`", () => {
    const result = FlowSchema.safeParse(flowEndingWith({ outcome: 'refused' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    const [issue] = result.error.issues;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['nodes', 1, 'config', 'message']);
    expect(issue.message).toContain("`outcome: 'refused'` requires a `message`");
  });

  it('renders that refusal through formatZodError as a line that names the key to add', () => {
    const result = FlowSchema.safeParse(flowEndingWith({ outcome: 'refused' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    const rendered = formatZodError(result.error);
    expect(rendered).toContain('Validation failed (1 issue):');
    expect(rendered).toContain("✗ nodes.1.config.message: `outcome: 'refused'` requires a `message`");
  });

  it.each([
    ['explicit', { outcome: 'completed', message: 'never shown' }],
    ['omitted', { message: 'never shown' }],
  ])('REFUSES `message` on a completed end (outcome %s) at the same address', (_label, config) => {
    const result = FlowSchema.safeParse(flowEndingWith(config));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => [i.code, i.path])).toEqual([['custom', ['nodes', 1, 'config', 'message']]]);
  });

  it('REFUSES an undeclared key on the end config, anchored on the config, with the suggestion intact', () => {
    const result = FlowSchema.safeParse(flowEndingWith({ outcome: 'refused', message: REFUSAL, reason: 'dup' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => [i.code, i.path])).toEqual([['unrecognized_keys', ['nodes', 1, 'config']]]);
    expect(result.error.issues[0].message).toContain('Did you mean `reason` → `message`?');
  });

  it('REFUSES a bogus outcome as an enum violation at `nodes[i].config.outcome`', () => {
    const result = FlowSchema.safeParse(flowEndingWith({ outcome: 'bogus' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => [i.code, i.path])).toEqual([['invalid_value', ['nodes', 1, 'config', 'outcome']]]);
  });

  it('leaves every OTHER node type\'s `config` the open slot it was (ADR-0018) — `outcome` on a plugin node is not this contract\'s', () => {
    const parsed = FlowNodeSchema.parse({
      id: 'p', type: 'some_plugin_node', label: 'P', config: { outcome: 'refused', whatever: 1 },
    });
    expect(parsed.config).toEqual({ outcome: 'refused', whatever: 1 });
  });

  it('defineFlow round-trips the refusal config and refuses the same shapes with the same anchored issue', () => {
    const accepted = defineFlow(flowEndingWith({ outcome: 'refused', message: REFUSAL }));
    expect(endConfigOf(accepted)).toEqual({ outcome: 'refused', message: REFUSAL });
    expect(endConfigOf(defineFlow(flowEndingWith({})))).toEqual({ outcome: 'completed' });

    let caught: unknown;
    try {
      defineFlow(flowEndingWith({ outcome: 'refused' }));
    } catch (error) {
      caught = error;
    }
    const issues = (caught as { issues?: Array<{ code: string; path: PropertyKey[] }> })?.issues;
    expect(issues).toBeDefined();
    expect(issues?.map((i) => [i.code, i.path])).toEqual([['custom', ['nodes', 1, 'config', 'message']]]);
  });

  it('a region-nested `end` is refused by the FLOW parse itself (#15646/#18112) — the region-door reading this test used to pin is unreachable, because the shape is gone', () => {
    // ⚠️ REPLACED, not re-spelled. This case used to assert that the flow parse
    // was GREEN here and that `validateControlFlow` was the door — a true
    // reading of `parseFlowNodeRegions` leaving a refused region raw (#4389).
    // #15646 removes its subject: an `end` node inside a structured region body
    // is refused at parse, whatever its `config`, so there is no longer a
    // region-nested `end` whose CONFIG can be judged one door later. Keeping the
    // old assertion by weakening it would have pinned an `end`-in-region shape
    // that is now undeclarable.
    const nested: Flow = {
      name: 'nested_refusal',
      label: 'Nested refusal',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'each', type: 'loop', label: 'Each',
          config: {
            collection: '{items}',
            body: {
              nodes: [{ id: 'inner_end', type: 'end', label: 'Inner end', config: { outcome: 'refused' } }],
              edges: [],
            },
          },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'each' },
        { id: 'e2', source: 'each', target: 'end' },
      ],
    };
    const parsed = FlowSchema.safeParse(nested);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', ['nodes', 1, 'config', 'body', 'nodes', 0, 'type']],
    ]);
    expect(parsed.error.issues[0].message).toContain(
      "An `end` node may not sit inside a structured region — `loop 'each' body` is a region body and the `end` node `inner_end` is inside it",
    );

    // CONTROL — the identical `end` node, identical malformed config, on the
    // TOP-LEVEL graph: refused by the `end` CONFIG contract instead, at
    // `config.message`. So the reading above is the region rule firing, not this
    // fixture being malformed in some way that would fail anywhere.
    const topLevel = FlowSchema.safeParse({
      ...nested,
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'inner_end', type: 'end', label: 'Inner end', config: { outcome: 'refused' } },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'inner_end' }],
    } as Flow);
    expect(topLevel.success).toBe(false);
    if (topLevel.success) return;
    expect(topLevel.error.issues.map((i) => i.path)).toEqual([['nodes', 1, 'config', 'message']]);
    expect(topLevel.error.issues[0].message).toContain("`outcome: 'refused'` requires a `message`");
  });
});

describe('the run row carries the refusal (#14945)', () => {
  const run = {
    id: 'exec_refused_001',
    flowName: 'lead_conversion',
    trigger: { type: 'api', recordId: 'lead_42', object: 'crm_lead' },
    steps: [],
    startedAt: '2026-09-05T08:00:00Z',
    completedAt: '2026-09-05T08:00:01Z',
    durationMs: 12,
  };

  it("`ExecutionStatus` names `refused` beside `failed` — two members, not one", () => {
    expect(ExecutionStatus.options).toContain('refused');
    expect(ExecutionStatus.options).toContain('failed');
  });

  it('a refused run parses with `refusalMessage` PRESERVED — the rendered per-record text, not the template', () => {
    const parsed = ExecutionLogSchema.parse({
      ...run,
      status: 'refused',
      refusalMessage: 'Refused: Acme Corp is a confirmed duplicate of Acme Corporation',
    });
    expect(parsed.status).toBe('refused');
    expect(parsed.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate of Acme Corporation');
  });

  it('`refusalMessage` is optional — a completed or failed run carries none', () => {
    expect(ExecutionLogSchema.parse({ ...run, status: 'completed' }).refusalMessage).toBeUndefined();
    expect(ExecutionLogSchema.parse({ ...run, status: 'failed' }).refusalMessage).toBeUndefined();
  });
});
