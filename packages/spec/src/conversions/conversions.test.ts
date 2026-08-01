// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { FlowSchema } from '../automation/flow.zod.js';
import { ScriptConfigSchema } from '../automation/schemaless-node-config.zod.js';
import { normalizeStackInput } from '../shared/metadata-collection.zod.js';
import { applyConversions, collectConversionNotices } from './apply.js';
import { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from './registry.js';
import { CONVERSION_NOTICE_CODE, type ConversionNotice } from './types.js';

describe('conversion layer (ADR-0087 D2)', () => {
  describe('fixture pairs — every entry converts old shape → canonical', () => {
    for (const conversion of ALL_CONVERSIONS) {
      it(`${conversion.id}: before → after, emits ${conversion.fixture.expectedNotices} notice(s)`, () => {
        // `includeRetired` so graduated (load-retired) entries stay fixture-tested
        // forever — the chain replays them even though the loader no longer does.
        const { stack, notices } = collectConversionNotices(
          structuredClone(conversion.fixture.before),
          { includeRetired: true },
        );
        // The whole table runs, but fixtures are disjoint, so the result must
        // equal exactly this entry's `after`.
        expect(stack).toEqual(conversion.fixture.after);
        expect(notices).toHaveLength(conversion.fixture.expectedNotices);
        // Every notice this fixture produced must come from this conversion.
        for (const n of notices) {
          expect(n.conversionId).toBe(conversion.id);
          expect(n.code).toBe(CONVERSION_NOTICE_CODE);
          expect(n.toMajor).toBe(conversion.toMajor);
          expect(n.retiresIn).toBe(conversion.toMajor + 1);
          expect(n.surface).toBe(conversion.surface);
        }
      });
    }
  });

  describe('immutability & non-interference', () => {
    it('returns the same reference when nothing converts', () => {
      const clean = { objects: [{ name: 'account' }], flows: [{ name: 'f', nodes: [] }] };
      expect(applyConversions(clean)).toBe(clean);
    });

    it('never mutates the caller input', () => {
      const before = {
        flows: [{ name: 'f', nodes: [{ id: 'n', type: 'http_request', config: { url: 'x' } }] }],
      };
      const snapshot = structuredClone(before);
      applyConversions(before);
      expect(before).toEqual(snapshot);
    });

    it('shares untouched branches (copy-on-write, so plugins survive)', () => {
      const plugin = { onEnable() {} }; // non-clonable value that must be preserved by reference
      const stack: Record<string, unknown> = {
        plugins: [plugin],
        pages: [{ name: 'p', kind: 'jsx', source: '<div/>' }],
      };
      const out = applyConversions(stack);
      expect(out).not.toBe(stack);
      expect((out.plugins as unknown[])[0]).toBe(plugin); // same reference, untouched
    });
  });

  describe('flow-node-http-callout-rename', () => {
    it('rewrites http_request / http_call / webhook → http, leaving http untouched', () => {
      const { stack, notices } = collectConversionNotices({
        flows: [
          {
            name: 'f',
            nodes: [
              { id: 'a', type: 'http_call' },
              { id: 'b', type: 'http' },
              { id: 'c', type: 'webhook' },
            ],
          },
        ],
      });
      const nodes = (stack.flows as any[])[0].nodes;
      expect(nodes.map((n: any) => n.type)).toEqual(['http', 'http', 'http']);
      expect(notices).toHaveLength(2); // 'http' was already canonical
      expect(notices.map((n) => n.path)).toEqual(['flows[0].nodes[0].type', 'flows[0].nodes[2].type']);
    });
  });

  describe('flow-node-http-callout-rename — reserved-name conflict guard', () => {
    it('refuses to rewrite an alias a live executor owns, reporting a conflict', () => {
      const notices: ConversionNotice[] = [];
      const conflicts: { token: string; path: string; conversionId: string }[] = [];
      const out = applyConversions(
        { flows: [{ name: 'f', nodes: [{ id: 'a', type: 'webhook' }] }] },
        {
          onNotice: (n) => notices.push(n),
          onConflict: (c) => conflicts.push({ token: c.token, path: c.path, conversionId: c.conversionId }),
          reservedNodeTypes: new Set(['webhook']), // a third-party custom node owns this name
        },
      );
      // Not rewritten — the custom node is preserved.
      expect((out.flows as any[])[0].nodes[0].type).toBe('webhook');
      expect(notices).toHaveLength(0);
      expect(conflicts).toEqual([
        { token: 'webhook', path: 'flows[0].nodes[0].type', conversionId: 'flow-node-http-callout-rename' },
      ]);
    });

    it('converts normally when the alias is not a live type (build/validate seam)', () => {
      // No reservedNodeTypes → the historical alias converts as usual.
      const { stack, notices } = collectConversionNotices({
        flows: [{ name: 'f', nodes: [{ id: 'a', type: 'webhook' }] }],
      });
      expect((stack.flows as any[])[0].nodes[0].type).toBe('http');
      expect(notices).toHaveLength(1);
    });
  });

  describe('flow-node-crud-filter-alias (PD #12 retirement)', () => {
    it('renames config.filters → config.filter only for CRUD node types', () => {
      const { stack, notices } = collectConversionNotices({
        flows: [
          {
            name: 'f',
            nodes: [
              { id: 'a', type: 'get_record', config: { objectName: 'lead', filters: { x: 1 } } },
              // non-CRUD type: `filters` is left alone (not this conversion's surface)
              { id: 'b', type: 'custom', config: { filters: { y: 2 } } },
            ],
          },
        ],
      });
      const nodes = (stack.flows as any[])[0].nodes;
      expect(nodes[0].config).toEqual({ objectName: 'lead', filter: { x: 1 } });
      expect(nodes[1].config).toEqual({ filters: { y: 2 } });
      expect(notices).toHaveLength(1);
    });

    it('does not clobber an existing canonical filter', () => {
      const { stack, notices } = collectConversionNotices({
        flows: [
          {
            name: 'f',
            nodes: [
              {
                id: 'a',
                type: 'delete_record',
                config: { filter: { keep: true }, filters: { drop: true } },
              },
            ],
          },
        ],
      });
      const node = (stack.flows as any[])[0].nodes[0];
      expect(node.config.filter).toEqual({ keep: true });
      expect(notices).toHaveLength(0); // canonical present → no conversion
    });
  });

  describe('load-path retirement (ADR-0087 D2 window, second half)', () => {
    it('a retired conversion does NOT apply on the default load path', () => {
      const retired = ALL_CONVERSIONS.filter((c) => c.retiredFromLoadPath);
      expect(retired.length).toBeGreaterThan(0);
      for (const conversion of retired) {
        const before = structuredClone(conversion.fixture.before);
        const { stack, notices } = collectConversionNotices(structuredClone(before));
        // Old shape passes through untouched — the schema layer (tombstone /
        // rejection) owns the refusal now; only `migrate meta` replays these.
        expect(stack).toEqual(before);
        expect(notices).toHaveLength(0);
      }
    });

    it('a live-window conversion still applies at load (protocol-15 aliases)', () => {
      const { stack, notices } = collectConversionNotices({
        pages: [
          {
            name: 'p',
            regions: [{ name: 'main', components: [{ type: 'record:list', visibility: 'true' }] }],
          },
        ],
      });
      const component = (stack.pages as any[])[0].regions[0].components[0];
      expect(component.visibleWhen).toBe('true');
      expect(component.visibility).toBeUndefined();
      expect(notices).toHaveLength(1);
      expect(notices[0]!.conversionId).toBe('page-component-visibility-to-visibleWhen');
    });
  });

  describe('registry invariants', () => {
    it('every conversion carries a fixture pair and a positive retirement window', () => {
      for (const c of ALL_CONVERSIONS) {
        expect(c.fixture.before).toBeTypeOf('object');
        expect(c.fixture.after).toBeTypeOf('object');
        expect(c.toMajor).toBeGreaterThan(0);
      }
    });

    it('conversion ids are unique', () => {
      const ids = ALL_CONVERSIONS.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('ALL_CONVERSIONS is the flattened CONVERSIONS_BY_MAJOR', () => {
      const flat = Object.values(CONVERSIONS_BY_MAJOR).flat();
      expect(ALL_CONVERSIONS).toHaveLength(flat.length);
    });
  });

  describe('normalizeStackInput integration (the load seam)', () => {
    it('converts at load and surfaces notices through the sink', () => {
      const notices: ConversionNotice[] = [];
      const out = normalizeStackInput(
        { pages: [{ name: 'p', kind: 'jsx', source: '<div/>' }] },
        { onConversionNotice: (n) => notices.push(n) },
      );
      expect((out.pages as any[])[0].kind).toBe('html');
      expect(notices).toHaveLength(1);
      expect(notices[0]!.message).toContain("'jsx' → 'html'");
    });

    it('still converts silently when no sink is provided (zero consumer action)', () => {
      const out = normalizeStackInput({ pages: [{ name: 'p', kind: 'jsx', source: '<div/>' }] });
      expect((out.pages as any[])[0].kind).toBe('html');
    });

    it('normalizes map collections and converts in one pass', () => {
      const out = normalizeStackInput({
        flows: { my_flow: { nodes: [{ id: 'n', type: 'webhook' }] } } as any,
      });
      const flows = out.flows as any[];
      expect(Array.isArray(flows)).toBe(true);
      expect(flows[0].name).toBe('my_flow'); // map key injected
      expect(flows[0].nodes[0].type).toBe('http'); // converted
    });
  });

  describe('flow-node-wait-timeout-keys-removed (#4158)', () => {
    const wecFlow = (waitEventConfig: Record<string, unknown>) => ({
      flows: [
        {
          name: 'settle',
          label: 'Settle',
          type: 'autolaunched',
          edges: [],
          nodes: [
            { id: 'n1', type: 'start', label: 'Start' },
            { id: 'w', type: 'wait', label: 'Wait', waitEventConfig },
          ],
        },
      ],
    });
    const wecOf = (stack: Record<string, unknown>) => (stack.flows as any[])[0].nodes[1].waitEventConfig;
    // Retired from the load path, so the default `applyConversions` skips it —
    // exactly like `stack-api-require-auth-removed`.
    const convert = (stack: Record<string, unknown>) => collectConversionNotices(stack, { includeRetired: true });

    it('moves `timeoutMs` to `timerDuration` as a STRING the schema accepts', () => {
      const { stack, notices } = convert(wecFlow({ eventType: 'timer', timeoutMs: 60_000 }));
      expect(wecOf(stack)).toEqual({ eventType: 'timer', timerDuration: '60000' });
      expect(notices).toHaveLength(1);
      // The move is only lossless if the result still parses — `timerDuration` is
      // `z.string()`, so carrying the number across would have broken the block.
      expect(() => FlowSchema.parse((stack.flows as any[])[0])).not.toThrow();
    });

    it('drops `timeoutMs` instead of moving it when `timerDuration` already won', () => {
      const { stack, notices } = convert(
        wecFlow({ eventType: 'timer', timerDuration: 'PT5M', timeoutMs: 999 }),
      );
      expect(wecOf(stack)).toEqual({ eventType: 'timer', timerDuration: 'PT5M' });
      expect(notices).toHaveLength(1);
    });

    it('drops `onTimeout` — it never had a reader, so there is nothing to preserve', () => {
      const { stack, notices } = convert(wecFlow({ eventType: 'timer', timerDuration: 'PT1M', onTimeout: 'continue' }));
      expect(wecOf(stack)).toEqual({ eventType: 'timer', timerDuration: 'PT1M' });
      expect(notices).toHaveLength(1);
    });

    it('leaves a block carrying neither key untouched', () => {
      const { stack, notices } = convert(wecFlow({ eventType: 'signal', signalName: 'paid' }));
      expect(wecOf(stack)).toEqual({ eventType: 'signal', signalName: 'paid' });
      expect(notices).toHaveLength(0);
    });

    it('tombstones both keys so a source that skipped conversion is rejected, not stripped', () => {
      for (const bad of [{ timeoutMs: 60_000 }, { onTimeout: 'continue' }]) {
        const flow = (wecFlow({ eventType: 'timer', timerDuration: 'PT1M', ...bad }).flows as any[])[0];
        expect(() => FlowSchema.parse(flow), `${Object.keys(bad)[0]} must be rejected`).toThrow(/4158/);
      }
    });
  });

  describe('flow-node-script-branch-keys-removed (#4343)', () => {
    /** One `script` node in a flow shaped the way the conversion walks it. */
    const scriptFlow = (config: Record<string, unknown>) => ({
      flows: [
        {
          name: 'task_lifecycle',
          label: 'Task lifecycle',
          type: 'autolaunched',
          edges: [],
          nodes: [
            { id: 'n1', type: 'start', label: 'Start' },
            { id: 's', type: 'script', label: 'Script', config },
          ],
        },
      ],
    });
    const cfgOf = (stack: Record<string, unknown>) => (stack.flows as any[])[0].nodes[1].config;
    // Retired from the load path (the keys misdescribed themselves), so the
    // default `applyConversions` skips it — only `os migrate meta` replays it.
    const convert = (stack: Record<string, unknown>) => collectConversionNotices(stack, { includeRetired: true });

    it('moves a shorthand `actionType` into `function` — that is what it named', () => {
      const { stack, notices } = convert(scriptFlow({ actionType: 'score_lead', outputVariable: 'score' }));
      expect(cfgOf(stack)).toEqual({ function: 'score_lead', outputVariable: 'score' });
      expect(notices).toHaveLength(1);
      expect(notices[0]!.to).toBe('config.function');
    });

    it('drops a shorthand `actionType` instead of moving it when `function` already won', () => {
      const { stack, notices } = convert(scriptFlow({ actionType: 'stale_name', function: 'score_lead' }));
      expect(cfgOf(stack)).toEqual({ function: 'score_lead' });
      expect(notices).toHaveLength(1);
    });

    it('drops the built-in ids and the bare marker — neither was ever a function name', () => {
      for (const actionType of ['email', 'slack', 'invoke_function']) {
        const { stack, notices } = convert(scriptFlow({ actionType, function: 'score_lead' }));
        expect(cfgOf(stack), actionType).toEqual({ function: 'score_lead' });
        expect(notices, actionType).toHaveLength(1);
        expect(notices[0]!.to, actionType).toMatch(/removed/);
      }
    });

    it('drops the stub payload keys — nothing ever read them, so there is nothing to preserve', () => {
      const { stack, notices } = convert(scriptFlow({
        actionType: 'email',
        template: 'task_done',
        recipients: ['{record.owner}'],
        variables: { taskName: '{record.name}' },
      }));
      expect(cfgOf(stack)).toEqual({});
      expect(notices).toHaveLength(4);
    });

    it('drops an inline `script` body the runtime never executed', () => {
      const { stack, notices } = convert(scriptFlow({ script: 'return { ok: true };' }));
      expect(cfgOf(stack)).toEqual({});
      expect(notices).toHaveLength(1);
    });

    it('leaves an already-converged node untouched', () => {
      const { stack, notices } = convert(scriptFlow({ function: 'score_lead', inputs: { id: '{record.id}' } }));
      expect(cfgOf(stack)).toEqual({ function: 'score_lead', inputs: { id: '{record.id}' } });
      expect(notices).toHaveLength(0);
    });

    it('leaves a non-script node carrying the same key names alone', () => {
      // Unlike the wait retirement, these tombstones live on the script config
      // contract — no other node type is parsed against it, so a `template` key
      // elsewhere is that node's own business.
      const stack0 = {
        flows: [{
          name: 'f',
          nodes: [{ id: 'n', type: 'notify', config: { template: 'x', recipients: ['a'] } }],
        }],
      };
      const { stack, notices } = convert(stack0);
      expect(stack).toEqual(stack0);
      expect(notices).toHaveLength(0);
    });

    it('tombstones every retired key so a source that skipped conversion is rejected, not stripped', () => {
      // NOTE the channel: unlike `waitEventConfig`, a node's `config` is
      // `z.record(z.unknown())` on `FlowNodeSchema`, so `FlowSchema.parse` does
      // NOT reach these tombstones — they answer whoever AUTHORS the key (`tsc`
      // types it `never`; this parse raises the prescription). A stored flow is
      // reached by the other half: `registerFlow` replays this conversion even
      // though it is retired (#3903), and the execute-time parse then refuses
      // what is left over for naming no callable.
      for (const bad of [
        { actionType: 'email' },
        { template: 't' },
        { recipients: ['a'] },
        { variables: { x: 1 } },
        { script: 'return 1;' },
      ]) {
        const key = Object.keys(bad)[0]!;
        expect(
          () => ScriptConfigSchema.parse({ function: 'score_lead', ...bad }),
          `${key} must be rejected`,
        ).toThrow(/4343/);
      }
      // The flow-level parse is deliberately blind here — pinned so the note
      // above stays true if `FlowNodeSchema.config` is ever tightened.
      expect(() => FlowSchema.parse((scriptFlow({ actionType: 'email' }).flows as any[])[0])).not.toThrow();
    });
  });

  describe('flow-node-wait-event-config-lift (PD #12 retirement, #4045)', () => {
    /**
     * One `wait` node in a flow that `FlowSchema` can actually parse — `label` is
     * required on both the flow and every node, which the conversion fixtures
     * (shape-only, never parsed) omit.
     */
    const waitFlow = (node: Record<string, unknown>) => ({
      flows: [
        {
          name: 'settle',
          label: 'Settle',
          type: 'autolaunched',
          edges: [],
          nodes: [
            { id: 'n1', type: 'start', label: 'Start' },
            { id: 'w', type: 'wait', label: 'Wait', ...node },
          ],
        },
      ],
    });
    const waitNodeOf = (stack: Record<string, unknown>) => (stack.flows as any[])[0].nodes[1];

    it('lifts the undeclared `duration` / `signal` spellings onto the declared block', () => {
      const { stack, notices } = collectConversionNotices(waitFlow({ config: { duration: 'PT1M' } }));
      expect(waitNodeOf(stack).waitEventConfig).toEqual({ timerDuration: 'PT1M', eventType: 'timer' });
      expect(waitNodeOf(stack).config).toEqual({});
      expect(notices).toHaveLength(1);

      const sig = collectConversionNotices(waitFlow({ config: { eventType: 'signal', signal: 'order_paid' } }));
      expect(waitNodeOf(sig.stack).waitEventConfig).toEqual({ eventType: 'signal', signalName: 'order_paid' });
      expect(sig.notices).toHaveLength(2);
    });

    it('lets a declared value win and leaves its loose counterpart shadowed in place', () => {
      const { stack, notices } = collectConversionNotices(
        waitFlow({
          waitEventConfig: { eventType: 'timer', timerDuration: 'PT5M' },
          config: { duration: 'PT9M', timeoutMs: 60_000 },
        }),
      );
      expect(waitNodeOf(stack).waitEventConfig).toEqual({
        eventType: 'timer',
        timerDuration: 'PT5M',
        timeoutMs: 60_000,
      });
      // The shadowed alias is not deleted — same treatment `renameConfigKey` gives one.
      expect(waitNodeOf(stack).config).toEqual({ duration: 'PT9M' });
      expect(notices).toHaveLength(1);
    });

    it('prefers the declared spelling over the undeclared one among loose keys', () => {
      const { stack } = collectConversionNotices(
        waitFlow({ config: { timerDuration: 'PT1H', duration: 'PT2H' } }),
      );
      expect(waitNodeOf(stack).waitEventConfig.timerDuration).toBe('PT1H');
      // `duration` was never reachable past the `??` chain either — left as-is.
      expect(waitNodeOf(stack).config).toEqual({ duration: 'PT2H' });
    });

    /**
     * The exact shape the showcase's `wait_revision` node carried before this
     * change — the declared spelling sitting in the undeclared LOCATION, which is
     * the combination the ledger's candidate order has to get right.
     */
    it('lifts the showcase shape: declared key names in a loose `config`', () => {
      const { stack, notices } = collectConversionNotices(
        waitFlow({ config: { eventType: 'signal', signalName: 'budget_revision' } }),
      );
      expect(waitNodeOf(stack).waitEventConfig).toEqual({
        eventType: 'signal',
        signalName: 'budget_revision',
      });
      expect(waitNodeOf(stack).config).toEqual({});
      expect(notices).toHaveLength(2);
      expect(() => FlowSchema.parse((stack.flows as any[])[0])).not.toThrow();
    });

    it('leaves a wait node with nothing to lift completely untouched', () => {
      const before = waitFlow({ waitEventConfig: { eventType: 'manual' }, config: { note: 'keep me' } });
      const { stack, notices } = collectConversionNotices(structuredClone(before));
      expect(waitNodeOf(stack)).toEqual(waitNodeOf(before as any));
      expect(notices).toHaveLength(0);
    });

    it('only touches `wait` — the same keys on another node type are not its surface', () => {
      const { stack, notices } = collectConversionNotices({
        flows: [{ name: 'f', nodes: [{ id: 'a', type: 'custom', config: { duration: 'PT1M' } }] }],
      });
      expect((stack.flows as any[])[0].nodes[0].config).toEqual({ duration: 'PT1M' });
      expect(notices).toHaveLength(0);
    });

    /**
     * The `eventType: 'timer'` default is load-bearing, not tidiness. The loader
     * parses the CONVERTED flow, and `waitEventConfig.eventType` is required once
     * the block exists — so this asserts both directions: the shape the
     * conversion produces loads, and the shape it would have produced without the
     * default does not.
     */
    it('produces a flow the loader can still parse (negative control: no eventType would not)', () => {
      const { stack } = collectConversionNotices(waitFlow({ config: { duration: 'PT1M' } }));
      const converted = (stack.flows as any[])[0];
      expect(() => FlowSchema.parse(converted)).not.toThrow();

      const withoutDefault = structuredClone(converted);
      delete withoutDefault.nodes[1].waitEventConfig.eventType;
      expect(() => FlowSchema.parse(withoutDefault)).toThrow();
    });
  });
});
