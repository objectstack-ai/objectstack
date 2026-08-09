// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { CreateRecordConfigSchema } from '../automation/builtin-node-config.zod.js';
import { FlowSchema } from '../automation/flow.zod.js';
import { ScriptConfigSchema } from '../automation/schemaless-node-config.zod.js';
import { DatasourceSchema } from '../data/datasource.zod.js';
import {
  getDriverConfigSchema,
  resolveDriverId,
  validateDriverConfig,
} from '../data/driver/config-registry.zod.js';
import { normalizeStackInput } from '../shared/metadata-collection.zod.js';
import { ElementButtonPropsSchema, PageHeaderProps, PageTabsProps } from '../ui/component.zod.js';
import { PageSchema } from '../ui/page.zod.js';
import { applyConversions, collectConversionNotices } from './apply.js';
import { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import { renameConfigKey, renameKey } from './walk.js';
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

    it('does not clobber an existing canonical filter that says something DIFFERENT', () => {
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
      // Two different match maps under two names is the ambiguous half of the
      // #4923 ruling: BOTH survive, so the strict gate can refuse naming both.
      expect(node.config.filters).toEqual({ drop: true });
      expect(notices).toHaveLength(0);
    });
  });

  /**
   * The shadowed-alias rule, split by value (#4923).
   *
   * `renameKey` used to do nothing whenever the canonical key was already
   * present, which left the retired spelling sitting in converted metadata
   * forever — invisible while the node contracts were `.strip`, an execute-time
   * refusal once #4001 批 9 made them strict. The maintainer ruling splits that
   * case by whether the two values actually disagree; these tests pin both
   * halves, because only one of them is a change.
   */
  describe('shadowed alias, split by value (#4923)', () => {
    const crudFlow = (config: Record<string, unknown>) => ({
      flows: [{ name: 'f', nodes: [{ id: 'a', type: 'create_record', config }] }],
    });
    const configOf = (stack: Record<string, unknown>) =>
      (stack.flows as Array<{ nodes: Array<{ config: Record<string, unknown> }> }>)[0]!.nodes[0]!.config;

    // ── Direction 1: equal values → the twin is deleted, loudly ──────────
    //
    // Predicted BEFORE the run, against unmodified code: red. The old
    // `renameKey` returned `null` the moment `objectName` was present, so the
    // dead `object` survived into `after` and no notice was emitted at all.

    it('deletes an alias whose value EQUALS the canonical key, and emits a notice', () => {
      const { stack, notices } = collectConversionNotices(
        crudFlow({ objectName: 'task', object: 'task' }),
      );
      expect(configOf(stack)).toEqual({ objectName: 'task' });
      expect(configOf(stack)).not.toHaveProperty('object');
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        conversionId: 'flow-node-crud-object-alias',
        from: 'object',
        to: 'objectName',
      });
    });

    it('compares STRUCTURALLY — two separately-authored identical filters are one declaration', () => {
      // `===` would call these different and keep both; they are the same
      // authored match map, so the retired spelling carries nothing.
      const { stack, notices } = collectConversionNotices({
        flows: [
          {
            name: 'f',
            nodes: [
              {
                id: 'a',
                type: 'delete_record',
                config: { filter: { status: 'stale' }, filters: { status: 'stale' } },
              },
            ],
          },
        ],
      });
      expect(configOf(stack)).toEqual({ filter: { status: 'stale' } });
      expect(notices).toHaveLength(1);
    });

    it('is idempotent in shape AND notices — the deduped result replays to itself', () => {
      const once = collectConversionNotices(crudFlow({ objectName: 'task', object: 'task' }));
      expect(once.notices).toHaveLength(1);
      const twice = collectConversionNotices(once.stack);
      expect(twice.stack).toEqual(once.stack);
      expect(twice.notices).toHaveLength(0);
    });

    // ── Direction 2: different values → BOTH survive ─────────────────────
    //
    // Predicted BEFORE the run: GREEN against unmodified code too. Keeping a
    // differing pair is what the old code already did for every pair, so this
    // half is a REGRESSION PIN, not a proof of change. What the ruling
    // actually changed here is the *reason* — and the prescription that reads
    // it, pinned in the strict-gate test below.

    it('keeps BOTH spellings when the values differ — the upgrade tool does not choose', () => {
      const before = crudFlow({ objectName: 'task', object: 'ticket' });
      const { stack, notices } = collectConversionNotices(structuredClone(before));
      expect(stack).toEqual(before);
      expect(configOf(stack)).toEqual({ objectName: 'task', object: 'ticket' });
      expect(notices).toHaveLength(0);
    });

    it('judges each pair on its own value — one twin dedupes while its neighbour survives', () => {
      const { stack, notices } = collectConversionNotices(
        crudFlow({ objectName: 'task', object: 'task', filter: { a: 1 }, filters: { a: 2 } }),
      );
      expect(configOf(stack)).toEqual({ objectName: 'task', filter: { a: 1 }, filters: { a: 2 } });
      expect(notices).toHaveLength(1);
      expect(notices[0]!.from).toBe('object');
    });

    it('never deletes the only copy when a pair renames a key to itself', () => {
      // Guard on the new equal-value branch: `from === to` would compare the
      // value against itself, call it a redundant twin, and delete it. No
      // registry pair is written that way; this pins that one added later
      // converts nothing instead of erasing the key.
      const dict = { objectName: 'task' };
      expect(renameKey(dict, 'objectName', 'objectName')).toBeNull();
      expect(renameConfigKey({ config: { ...dict } }, 'objectName', 'objectName')).toBeNull();
    });

    it('applies the same rule one level up, on a plain dict rename (page header)', () => {
      // `renameConfigKey` delegates to `renameKey`, so a non-`config` surface
      // must not develop its own dialect of the rule.
      const header = (properties: Record<string, unknown>) => ({
        pages: [{ name: 'p', regions: [{ name: 'header', components: [{ type: 'page:header', properties }] }] }],
      });
      const propsOf = (stack: Record<string, unknown>) =>
        (stack.pages as Array<{ regions: Array<{ components: Array<{ properties: unknown }> }> }>)[0]!
          .regions[0]!.components[0]!.properties;

      const equal = collectConversionNotices(header({ title: 'T', subtitle: 'One', description: 'One' }));
      expect(propsOf(equal.stack)).toEqual({ title: 'T', subtitle: 'One' });
      expect(equal.notices).toHaveLength(1);

      const differs = header({ title: 'T', subtitle: 'One', description: 'Another' });
      const kept = collectConversionNotices(structuredClone(differs));
      expect(kept.stack).toEqual(differs);
      expect(kept.notices).toHaveLength(0);
    });

    // ── The half the strict gate owns: the prescription names BOTH keys ───
    //
    // Predicted BEFORE the run: red against unmodified guidance, which told
    // the author the surviving twin was "dead" — true under the old rule and
    // false under the new one, where a survivor means the two values disagree.

    it('the surviving pair is refused by the strict gate with BOTH keys named', () => {
      const parsed = CreateRecordConfigSchema.safeParse({
        objectName: 'task',
        object: 'ticket',
        fields: { title: 'x' },
      });
      expect(parsed.success).toBe(false);
      const message = parsed.success ? '' : parsed.error.issues.map((i) => i.message).join('\n');
      // Both spellings, so the author can see the disagreement they authored…
      expect(message).toContain('`object`');
      expect(message).toContain('`objectName`');
      // …and the refusal must NOT claim the survivor is a dead duplicate: the
      // conversion now deletes those, so a key that reached this parse carries
      // a value that differs from the canonical one.
      expect(message).not.toMatch(/already won and this key is dead/i);
      expect(message).toMatch(/differ|different/i);
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
      // The loose counterpart is not deleted. NOTE this is the wait-node LIFT
      // (a loose key into a declared block), not a `renameKey` alias pair, so
      // #4923's by-value split does not reach it — see the comment on
      // WAIT_EVENT_CONFIG_LIFTS.
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

  // #6345 — the `mongo` → `mongodb` canonical-id rename. Two claims have to hold
  // together, and only together: the stored value CONVERGES, and a deployment
  // that never runs the conversion is NOT broken. Either alone would be the
  // wrong shape — a rename that breaks old rows, or a rename that leaves one
  // deployment holding two spellings of one driver forever.
  describe('datasource-driver-mongo-to-mongodb (#6345)', () => {
    const convert = (datasources: unknown[]) =>
      collectConversionNotices({ datasources }, { includeRetired: true });

    it('converts a stored `driver: "mongo"` row to `mongodb`', () => {
      const row = { name: 'events', driver: 'mongo', config: { url: 'mongodb://db/x' }, origin: 'runtime' };
      const out = applyConversionsToStoredItem('datasource', row) as { driver: string };
      expect(out.driver).toBe('mongodb');
    });

    it('converts case- and whitespace-insensitively, exactly as the resolver reads it', () => {
      const { stack } = convert([
        { name: 'a', driver: 'Mongo', config: {} },
        { name: 'b', driver: '  mongo  ', config: {} },
      ]);
      for (const ds of stack.datasources as Array<{ driver: string }>) expect(ds.driver).toBe('mongodb');
    });

    it('leaves an already-canonical row, and a merely mongo-LIKE id, alone', () => {
      const before = {
        datasources: [
          { name: 'a', driver: 'mongodb', config: { url: 'mongodb://db/x' } },
          { name: 'b', driver: 'com.vendor.mongolike', config: { url: 'x://y' } },
        ],
      };
      const { stack, notices } = collectConversionNotices(structuredClone(before), { includeRetired: true });
      expect(stack).toEqual(before);
      expect(notices.filter((n) => n.conversionId === 'datasource-driver-mongo-to-mongodb')).toHaveLength(0);
    });

    // THE other half of the migration proof. A deployment that upgrades without
    // replaying the chain still holds `driver: 'mongo'` rows, and they must keep
    // working: `mongo` stays an accepted alias on purpose, so it resolves the
    // same config contract and builds the same driver as before the rename.
    // This is why the rename is a `minor` on `@objectstack/spec` and not a
    // boot-breaking change — the conversion converges a spelling, it does not
    // rescue one.
    it('an UNCONVERTED `mongo` row is not left broken — same contract, same driver', () => {
      expect(resolveDriverId('mongo')).toBe('mongodb');
      expect(getDriverConfigSchema('mongo')).toBe(getDriverConfigSchema('mongodb'));
      expect(validateDriverConfig('mongo', { url: 'mongodb://db/x' })).toEqual({ known: true, issues: [] });
      // And it still parses as a datasource — the authoring gate never stopped
      // accepting the alias, which is the whole reason nothing breaks.
      const parsed = DatasourceSchema.safeParse({
        name: 'events', driver: 'mongo', config: { url: 'mongodb://db/x' },
      });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });
  });

  // #4456 — the driver-factory `??` fallback graduation. The mappings are
  // driver-scoped by construction; these pin the two edges the flat fixture
  // pair cannot express as sharply: the same key converting under one driver
  // and not another, and the load-path posture.
  describe('datasource-config-driver-key-aliases (#4456)', () => {
    const convert = (datasources: unknown[]) =>
      collectConversionNotices({ datasources }, { includeRetired: true });

    it('renames `database` → `filename` ONLY under sqlite — it is canonical for the SQL/mongo drivers', () => {
      const { stack, notices } = convert([
        { name: 'a', driver: 'sqlite', config: { database: './a.db' } },
        { name: 'b', driver: 'postgres', config: { host: 'db', database: 'analytics' } },
        { name: 'c', driver: 'mysql', config: { host: 'db', database: 'orders' } },
        { name: 'd', driver: 'mongo', config: { host: 'db', database: 'events' } },
      ]);
      const [a, b, c, d] = stack.datasources as Array<{ config: Record<string, unknown> }>;
      expect(a!.config).toEqual({ filename: './a.db' });
      expect(b!.config).toEqual({ host: 'db', database: 'analytics' });
      expect(c!.config).toEqual({ host: 'db', database: 'orders' });
      expect(d!.config).toEqual({ host: 'db', database: 'events' });
      expect(notices.filter((n) => n.conversionId === 'datasource-config-driver-key-aliases')).toHaveLength(1);
    });

    it('still lands for a row whose driver id is ITSELF being renamed (#6345)', () => {
      // The pairs are keyed by CANONICAL driver id, and #6345 renamed mongo's.
      // A stored `driver: 'mongo'` must therefore still find the mongo pairs
      // (through the alias) even as the sibling conversion rewrites its id —
      // otherwise the rename would quietly un-convert every legacy mongo config.
      const { stack, notices } = convert([
        { name: 'events', driver: 'mongo', config: { uri: 'mongodb://db/x', user: 'svc' } },
      ]);
      const [events] = stack.datasources as Array<{ driver: string; config: Record<string, unknown> }>;
      expect(events!.config).toEqual({ url: 'mongodb://db/x', username: 'svc' });
      expect(events!.driver).toBe('mongodb');
      // Two key renames (`uri` → `url`, `user` → `username`) plus the id rename.
      expect(notices.filter((n) => n.conversionId === 'datasource-config-driver-key-aliases')).toHaveLength(2);
      expect(notices.filter((n) => n.conversionId === 'datasource-driver-mongo-to-mongodb')).toHaveLength(1);
    });

    it('does not touch a plugin-contributed driver id — no contract, no rewrite', () => {
      const before = { datasources: [{ name: 'x', driver: 'com.vendor.snowflake', config: { user: 'svc' } }] };
      const { stack, notices } = collectConversionNotices(structuredClone(before), { includeRetired: true });
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
    });

    it('is retired from the load path — an AUTHORED legacy spelling is not silently absorbed', () => {
      // Without includeRetired (the normalizeStackInput posture) the stack is
      // untouched: the authoring gate rejects `file:` with a rename hint, and
      // this conversion must not run ahead of it and defeat #4410.
      const before = { datasources: [{ name: 'a', driver: 'sqlite', config: { file: './a.db' } }] };
      const { stack, notices } = collectConversionNotices(structuredClone(before));
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
    });
  });
  /**
   * #5011 — `dashboard.widgets[].compareTo` converged on the executor contract.
   *
   * The fixture pair above already proves the three mechanical rewrites. What it
   * cannot express is the entry's real judgement: the durations it deliberately
   * does NOT touch, and the fact that it takes no acceptance window. Both are
   * asserted here, because a conversion that quietly rewrote `{ offset: '7d' }`
   * into a kind would turn a loud rejection into a wrong comparison — the exact
   * failure class #5011 exists to end.
   */
  describe('dashboard-widget-compareto-converged (#5011)', () => {
    const dash = (compareTo: unknown) => ({
      dashboards: [{
        name: 'revenue_review',
        widgets: [{ id: 'w1', type: 'kpi', dataset: 'orders', values: ['total'], compareTo }],
      }],
    });
    const convert = (compareTo: unknown) =>
      collectConversionNotices(structuredClone(dash(compareTo)), { includeRetired: true });
    const widgetOf = (stack: Record<string, unknown>) =>
      (stack.dashboards as Array<{ widgets: Array<Record<string, unknown>> }>)[0]!.widgets[0]!;

    it('rewrites both bare strings, value verbatim, container changed', () => {
      for (const kind of ['previousPeriod', 'previousYear'] as const) {
        const { stack, notices } = convert(kind);
        expect(widgetOf(stack).compareTo).toEqual({ kind });
        expect(notices).toHaveLength(1);
        expect(notices[0]!.from).toBe(`'${kind}'`);
      }
    });

    it("rewrites `{ offset: '1y' }` — the one duration with an exact equivalent", () => {
      const { stack, notices } = convert({ offset: '1y' });
      expect(widgetOf(stack).compareTo).toEqual({ kind: 'previousYear' });
      expect(notices).toHaveLength(1);
    });

    /**
     * The deliberate non-rewrite, and the assertion this whole describe exists
     * for. `previousPeriod` shifts by the resolved window's own length, which
     * equals `7d` only when the window happens to be seven days — so a
     * mechanical rewrite would silently change which rows the comparison column
     * counts. Left untouched, the strict schema meets the author with the
     * prescription instead.
     */
    it('leaves every other duration UNTOUCHED and silent, rather than guessing', () => {
      for (const offset of ['7d', '1M', '2w', '30d', '3y']) {
        const before = dash({ offset });
        const { stack, notices } = convert({ offset });
        expect(stack, `${offset} must not be rewritten`).toEqual(before);
        expect(notices, `${offset} must emit no notice`).toHaveLength(0);
      }
    });

    it('never synthesises a `dimension` — the executor resolves it, the chain cannot', () => {
      // The conversion sees a stack, not a dataset: it cannot know which time
      // dimension carries the window. Writing a guess here would convert a loud
      // runtime error into a wrong comparison.
      for (const input of ['previousPeriod', 'previousYear', { offset: '1y' }]) {
        expect(widgetOf(convert(input).stack)).not.toHaveProperty('compareTo.dimension');
      }
    });

    it('is retired from the load path — the old spellings get NO acceptance window', () => {
      // Without `includeRetired` (the normalizeStackInput posture) nothing is
      // rewritten: the strict schema must be what an AUTHORED legacy spelling
      // meets, so the prescription is delivered instead of the shape being
      // silently absorbed (PD #12).
      for (const input of ['previousPeriod', 'previousYear', { offset: '1y' }]) {
        const before = dash(input);
        const { stack, notices } = collectConversionNotices(structuredClone(before));
        expect(stack).toEqual(before);
        expect(notices).toHaveLength(0);
      }
    });

    it('touches only `compareTo` — a widget without one passes through by reference', () => {
      const before = {
        dashboards: [{
          name: 'other', widgets: [{ id: 'w1', type: 'kpi', dataset: 'orders', values: ['total'] }],
        }],
      };
      const { stack, notices } = collectConversionNotices(structuredClone(before), { includeRetired: true });
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
    });

    it('is idempotent by construction — the converged shape is not a match', () => {
      // No test replays a conversion twice for us (the skill's note), so this
      // asserts it directly: `{ kind }` is neither a string arm nor an `offset`.
      const before = dash({ kind: 'previousYear' });
      const { stack, notices } = collectConversionNotices(structuredClone(before), { includeRetired: true });
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
    });
  });

  /**
   * `page-header-subtitle-alias` (#4827, objectui#3226).
   *
   * The PD #12 retirement of objectui's `subtitle ?? description` fallback on
   * the page header. Unlike the entries above this one is a LIVE window, so
   * every case here runs the plain load posture (no `includeRetired`) — that
   * the rewrite happens without it is the property objectui is waiting on.
   */
  describe('page-header-subtitle-alias (#4827 — the `subtitle ?? description` retirement)', () => {
    const pageWith = (...components: Record<string, unknown>[]) => ({
      pages: [{ name: 'crm_lead_detail', regions: [{ name: 'header', components }] }],
    });
    const componentsOf = (stack: Record<string, unknown>) =>
      (stack.pages as Array<{ regions: Array<{ components: Array<Record<string, unknown>> }> }>)[0]!
        .regions[0]!.components;

    it('rewrites `description` → `subtitle` on the kebab legacy alias node', () => {
      const before = pageWith({ type: 'page-header', properties: { title: 'Leads', description: 'All open leads' } });
      // Direction, stated before the run: the authored key is `description`
      // and there is no `subtitle` at all — this is what a consumer's page
      // looks like on the way in.
      expect(componentsOf(before)[0]!.properties).toEqual({ title: 'Leads', description: 'All open leads' });

      const { stack, notices } = collectConversionNotices(structuredClone(before));

      // …and this is what the runtime sees: the second line survives under the
      // canonical key, and the dialect spelling is gone rather than shadowing it.
      expect(componentsOf(stack)[0]!.properties).toEqual({ title: 'Leads', subtitle: 'All open leads' });
      expect(componentsOf(stack)[0]!.properties).not.toHaveProperty('description');
      expect(notices).toHaveLength(1);
    });

    it('rewrites it on the CANONICAL `page:header` node too — where it is dropped on the floor today', () => {
      const { stack, notices } = collectConversionNotices(
        pageWith({ type: 'page:header', properties: { title: 'Lead', description: 'One lead' } }),
      );
      expect(componentsOf(stack)[0]!.properties).toEqual({ title: 'Lead', subtitle: 'One lead' });
      expect(notices).toHaveLength(1);
    });

    it('does NOT rewrite the node TYPE — the kebab alias is objectui\'s to retire', () => {
      const { stack } = collectConversionNotices(
        pageWith({ type: 'page-header', properties: { title: 'Leads', description: 'All open leads' } }),
      );
      expect(componentsOf(stack)[0]!.type).toBe('page-header');
    });

    it('keeps a `description` that DISAGREES with an existing `subtitle` (both survive)', () => {
      // The house precedence `renameKey` encodes since #4923, same as
      // flow-node-crud-object-alias: two different second lines are the
      // author's to reconcile, so no rewrite, no notice, no deletion.
      const before = pageWith({
        type: 'page:header',
        properties: { title: 'Both', subtitle: 'wins', description: 'other' },
      });
      const { stack, notices } = collectConversionNotices(structuredClone(before));
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
    });

    it('touches header nodes ONLY — `description` is a live declared prop elsewhere', () => {
      // element:text_input declares its own `description` (helper text). A
      // conversion keyed on the key rather than the node would eat it.
      const before = pageWith(
        { type: 'element:text_input', properties: { label: 'Note', description: 'Helper text' } },
        { type: 'record:details', properties: { description: 'not a subtitle' } },
      );
      const { stack, notices } = collectConversionNotices(structuredClone(before));
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
    });

    it('emits a notice that names the surface, the site and the live window', () => {
      const { notices } = collectConversionNotices(
        pageWith(
          { type: 'element:divider' },
          { type: 'page-header', properties: { title: 'Leads', description: 'All open leads' } },
        ),
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        conversionId: 'page-header-subtitle-alias',
        surface: 'page.component.page-header.description',
        from: 'description',
        to: 'subtitle',
        path: 'pages[0].regions[0].components[1].properties.subtitle',
        toMajor: 17,
        retiresIn: 18,
      });
    });

    it('is idempotent — the canonical shape is not a match', () => {
      const before = pageWith({ type: 'page:header', properties: { title: 'Leads', subtitle: 'All open leads' } });
      const { stack, notices } = collectConversionNotices(structuredClone(before));
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
    });

    it('copies on write — a page with no header passes through by reference', () => {
      const stack = pageWith({ type: 'record:details' });
      expect(applyConversions(stack)).toBe(stack);
    });

    it('reaches a STORED page row, so data at rest canonicalizes on rehydration', () => {
      // `applyConversionsToStoredItem` wraps the row as `{ pages: [row] }`
      // (#3903) — the walker meets it there with no extra wiring.
      const notices: ConversionNotice[] = [];
      const row = {
        name: 'crm_lead_detail',
        regions: [{ name: 'header', components: [{ type: 'page-header', properties: { title: 'Leads', description: 'All open leads' } }] }],
      };
      const out = applyConversionsToStoredItem('page', row, { onNotice: (n) => notices.push(n) });
      expect(out.regions[0]!.components[0]!.properties).toEqual({ title: 'Leads', subtitle: 'All open leads' });
      expect(notices.map((n) => n.conversionId)).toEqual(['page-header-subtitle-alias']);
    });

    /**
     * The premise pin, and the one test that fails if the alias ever comes
     * BACK. This conversion is only correct while the spec declares exactly one
     * spelling: `PageHeaderProps` accepts `subtitle` and silently strips
     * `description` (the schema is not `.strict()`), which is precisely why an
     * authored `description` needed a conversion rather than an error.
     */
    it('the canonical props schema declares `subtitle` and no `description`', () => {
      expect(PageHeaderProps.parse({ title: 'Leads', subtitle: 'All open leads' }).subtitle)
        .toBe('All open leads');
      expect(PageHeaderProps.parse({ title: 'Leads', description: 'All open leads' }))
        .not.toHaveProperty('description');
    });

    /**
     * Reachability, judged by what this rule guards: a KEY inside the page
     * component's free-form `properties` record. So the criterion is that the
     * page schema accepts the fixture at all — before AND after. Before-green
     * is the defect's mechanism (nothing rejects the dialect spelling, which is
     * why it fails silently); after-green is the conversion's obligation (it
     * must not produce a page the loader then refuses).
     */
    it('both shapes parse green against PageSchema — the conversion moves a key, it does not fix a rejection', () => {
      const page = (properties: Record<string, unknown>) => ({
        name: 'crm_lead_detail',
        label: 'Lead Detail',
        type: 'record' as const,
        regions: [{ name: 'header', components: [{ type: 'page:header', properties }] }],
      });
      expect(PageSchema.safeParse(page({ title: 'Leads', description: 'All open leads' })).success).toBe(true);
      expect(PageSchema.safeParse(page({ title: 'Leads', subtitle: 'All open leads' })).success).toBe(true);
    });
  });

  /**
   * `inline-action-api-params-to-body-extra` (#5777).
   *
   * The fixture pair above already pins before → after and the notice count.
   * What needs its own cover is the DISCRIMINATOR, because this entry keys off
   * a value's shape rather than a key's presence: `Array.isArray` separates the
   * definition array from the payload map, and the `type:'api'` guard separates
   * a payload from the `${param.X}` interpolation scope a `url` action reads
   * out of the same key. Both are ways this rewrite could be lossy, and neither
   * is visible in a fixture that only carries the happy path.
   */
  describe('inline-action-api-params-to-body-extra (#5777)', () => {
    const button = (action: Record<string, unknown>) => ({
      pages: [{
        name: 'showcase_contact_form',
        regions: [{ name: 'main', components: [{ type: 'element:button', properties: { label: 'Go', action } }] }],
      }],
    });
    const actionOf = (stack: Record<string, unknown>) =>
      ((stack.pages as { regions: { components: { properties: { action: Record<string, unknown> } }[] }[] }[])[0]!
        .regions[0]!.components[0]!.properties.action);

    it('rewrites the object form on a type:"api" inline action', () => {
      const notices: ConversionNotice[] = [];
      const out = applyConversions(
        button({ type: 'api', target: '/api/v1/forms/contact-us/submit', params: { name: '{{page.inquiryName}}' } }),
        { onNotice: (n) => notices.push(n) },
      );
      expect(actionOf(out)).toEqual({
        type: 'api',
        target: '/api/v1/forms/contact-us/submit',
        bodyExtra: { name: '{{page.inquiryName}}' },
      });
      expect(notices.map((n) => n.conversionId)).toEqual(['inline-action-api-params-to-body-extra']);
      expect(notices[0]!.path).toBe('pages[0].regions[0].components[0].properties.action.bodyExtra');
    });

    it('leaves an ActionParam[] definition array alone — that meaning of the key survives', () => {
      const params = [{ name: 'reason', label: 'Reason', type: 'text' }];
      const stack = button({ type: 'api', target: '/x', params });
      const out = applyConversions(stack);
      // Identity, not just equality: nothing converted, so copy-on-write shares.
      expect(out).toBe(stack);
    });

    it('leaves a type:"url" action alone — object `params` is the interpolation scope there', () => {
      // ActionRunner.interpolateTarget reads a non-array `params` as the
      // `${param.X}` scope, and executeUrl reads `params.newTab`. Rewriting
      // those into an api request body would be lossy, so the guard is not a
      // conservatism — it is the difference between lossless and not.
      const stack = button({ type: 'url', target: '/x?id=${param.id}', params: { id: 'abc' } });
      expect(applyConversions(stack)).toBe(stack);
    });

    it('keeps BOTH when `bodyExtra` already says something different (#4923 house rule)', () => {
      const stack = button({ type: 'api', target: '/x', params: { a: 1 }, bodyExtra: { b: 2 } });
      const out = applyConversions(stack);
      expect(out).toBe(stack);
      expect(actionOf(out)).toEqual({ type: 'api', target: '/x', params: { a: 1 }, bodyExtra: { b: 2 } });
    });

    it('is idempotent — the converted result replays to itself with no second notice', () => {
      const once = applyConversions(button({ type: 'api', target: '/x', params: { a: 1 } }));
      const notices: ConversionNotice[] = [];
      const twice = applyConversions(once, { onNotice: (n) => notices.push(n) });
      expect(twice).toBe(once);
      expect(notices).toEqual([]);
    });

    /**
     * Reachability, judged by what this rule guards — a VALUE verdict, not a
     * key one (#5046's distinction). The key `params` is declared either way;
     * what decides is whether its value is a definition array or a payload map.
     * So the criterion is full-parse-green on the props schema AFTER, and
     * parse-RED before — while `PageSchema` stays green on both, because
     * `PageComponent.properties` is an open bag and never judged the value at
     * all. That gap is the defect's mechanism: the page published clean and
     * only the #5068 props gate could see it.
     */
    it('the props schema refuses the before shape and accepts the after shape; PageSchema accepts both', () => {
      const props = (action: Record<string, unknown>) => ({ label: 'Submit inquiry', action });
      const before = { type: 'api', target: '/api/v1/forms/contact-us/submit', params: { name: '{{page.n}}' } };
      const after = { type: 'api', target: '/api/v1/forms/contact-us/submit', bodyExtra: { name: '{{page.n}}' } };

      expect(ElementButtonPropsSchema.safeParse(props(before)).success).toBe(false);
      expect(ElementButtonPropsSchema.safeParse(props(after)).success).toBe(true);

      const page = (action: Record<string, unknown>) => ({
        name: 'showcase_contact_form',
        label: 'Contact Form',
        type: 'app' as const,
        regions: [{ name: 'main', components: [{ type: 'element:button', properties: props(action) }] }],
      });
      expect(PageSchema.safeParse(page(before)).success).toBe(true);
      expect(PageSchema.safeParse(page(after)).success).toBe(true);
    });
  });

  /**
   * `page-tabs-type-to-tab-style` (#6776).
   *
   * The fixture pair above pins before → after and the notice count. What needs
   * its own cover here is everything the fixture cannot show:
   *
   *   - the **discriminator** — this entry keys on the component's `type`, and
   *     the key it rewrites is also called `type`, so "which `type`" is the
   *     whole correctness question;
   *   - the **reach** — `page:tabs` is one of the seven named slots, and all
   *     four in-repo authoring sites are `slots.tabs`, so a region-only walk
   *     would rewrite nothing that actually exists;
   *   - **idempotence** and the #4923 both-keys rule;
   *   - the **acceptance face in both directions**, since a rename moves what
   *     the schema accepts as well as what it refuses.
   */
  describe('page-tabs-type-to-tab-style (#6776)', () => {
    const regionPage = (properties: Record<string, unknown>) => ({
      pages: [{ name: 'sys_position_detail', regions: [{ name: 'main', components: [{ type: 'page:tabs', properties }] }] }],
    });
    const slottedPage = (properties: Record<string, unknown>) => ({
      pages: [{ name: 'sys_user_detail', regions: [], slots: { tabs: { type: 'page:tabs', properties } } }],
    });
    const convert = (stack: Record<string, unknown>) => {
      const notices: ConversionNotice[] = [];
      const out = applyConversions(stack, { includeRetired: true, onNotice: (n) => notices.push(n) });
      return { out, notices };
    };
    type Comp = { type: string; properties: Record<string, unknown> };
    type Pg = { regions: { components: Comp[] }[]; slots?: { tabs: Comp | Comp[] } };
    const pageOf = (stack: Record<string, unknown>) => (stack.pages as Pg[])[0]!;
    const propsOf = (stack: Record<string, unknown>, where: 'region' | 'slot') => {
      const page = pageOf(stack);
      return where === 'region'
        ? page.regions[0]!.components[0]!.properties
        : (page.slots!.tabs as Comp).properties;
    };

    it('rewrites `properties.type` → `tabStyle` on a region-level page:tabs', () => {
      const { out, notices } = convert(regionPage({ type: 'card', items: [] }));
      expect(propsOf(out, 'region')).toEqual({ tabStyle: 'card', items: [] });
      expect(notices.map((n) => n.conversionId)).toEqual(['page-tabs-type-to-tab-style']);
      expect(notices[0]!.path).toBe('pages[0].regions[0].components[0].properties.tabStyle');
    });

    it('reaches `slots.tabs` — the shape every in-repo site actually uses', () => {
      // Region-only reach was the pre-#6776 behaviour of `mapPageComponents`,
      // and for THIS key it would have converted nothing: `page:tabs` is a
      // named slot, and all four sites in this repo are slotted record pages.
      // A conversion that cannot reach the corpus makes the tombstone's
      // "run `os migrate meta`" prescription a false promise.
      const { out, notices } = convert(slottedPage({ type: 'pill', position: 'top', items: [] }));
      expect(propsOf(out, 'slot')).toEqual({ tabStyle: 'pill', position: 'top', items: [] });
      expect(notices[0]!.path).toBe('pages[0].slots.tabs.properties.tabStyle');
    });

    it('reaches an ARRAY-valued slot too, indexing the path', () => {
      const stack = {
        pages: [{
          name: 'sys_user_detail',
          regions: [],
          slots: { tabs: [{ type: 'page:tabs', properties: { type: 'card', items: [] } }] },
        }],
      };
      const { out, notices } = convert(stack);
      const slot = pageOf(out).slots!.tabs as Comp[];
      expect(slot[0]!.properties).toEqual({ tabStyle: 'card', items: [] });
      expect(notices[0]!.path).toBe('pages[0].slots.tabs[0].properties.tabStyle');
    });

    it('never touches the node\'s OWN `type` — the dispatch key is not the prop', () => {
      // The one confusion this entry has to be immune to: `component.type` is
      // `'page:tabs'` and stays that way; only `properties.type` moves.
      const { out } = convert(regionPage({ type: 'card', items: [] }));
      expect(pageOf(out).regions[0]!.components[0]!.type).toBe('page:tabs');
    });

    it('leaves a non-tabs component alone, including a nested `type` in its props', () => {
      const stack = {
        pages: [{
          name: 'p',
          regions: [{
            name: 'main',
            components: [{ type: 'element:button', properties: { label: 'Open', action: { type: 'url', target: '/x' } } }],
          }],
        }],
      };
      // Identity, not just equality: nothing converted, so copy-on-write shares.
      expect(applyConversions(stack, { includeRetired: true })).toBe(stack);
    });

    it('keeps BOTH when `tabStyle` already says something different (#4923 house rule)', () => {
      const stack = regionPage({ tabStyle: 'pill', type: 'card', items: [] });
      const { out, notices } = convert(stack);
      expect(out).toBe(stack);
      expect(notices).toEqual([]);
    });

    it('drops the redundant twin when both spellings agree (#4923)', () => {
      const { out, notices } = convert(regionPage({ tabStyle: 'pill', type: 'pill', items: [] }));
      expect(propsOf(out, 'region')).toEqual({ tabStyle: 'pill', items: [] });
      expect(notices).toHaveLength(1);
    });

    it('is idempotent — the converted result replays to itself with no second notice', () => {
      const once = applyConversions(regionPage({ type: 'card', items: [] }), { includeRetired: true });
      const notices: ConversionNotice[] = [];
      const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
      expect(twice).toBe(once);
      expect(notices).toEqual([]);
    });

    /**
     * The acceptance face, both directions — a KEY verdict, so the criterion is
     * the props schema's own judgement of the key (#5046's distinction), not a
     * full-parse-green demand on a value.
     *
     * `PageSchema` stays green on both spellings because
     * `PageComponent.properties` is an open bag that never judged the key at
     * all; that gap is the defect's mechanism, and the #5068 props gate is the
     * only place either verdict is visible.
     */
    it('the props schema refuses `type` BY NAME and accepts `tabStyle`; PageSchema accepts both', () => {
      expect(PageTabsProps.safeParse({ type: 'card', items: [] }).success).toBe(false);
      // The refusal carries the prescription, not a bare "unrecognized key" —
      // a `retiredKey` tombstone rather than an undeclared key, which is what
      // makes the removal audible to an upgrading (often AI) author.
      expect(() => PageTabsProps.parse({ type: 'card', items: [] }))
        .toThrow(/`type`.*removed.*`tabStyle`/s);
      expect(PageTabsProps.safeParse({ tabStyle: 'card', items: [] }).success).toBe(true);

      const page = (properties: Record<string, unknown>) => ({
        name: 'sys_position_detail',
        label: 'Position',
        type: 'record' as const,
        object: 'sys_position',
        regions: [{ name: 'main', components: [{ type: 'page:tabs', properties }] }],
      });
      expect(PageSchema.safeParse(page({ type: 'card', items: [] })).success).toBe(true);
      expect(PageSchema.safeParse(page({ tabStyle: 'card', items: [] })).success).toBe(true);
    });
  });

  /**
   * `app-hidden-to-unpublished` (#4829, ADR-0045 amended 2026-08-09).
   *
   * The fixture pair pins before → after and the notice count. What needs its
   * own cover here is the property the fixture cannot express, and the one this
   * entry would be dangerous without: **its reach is the stored population and
   * nothing else.**
   *
   * `hidden` is not a retired key. It keeps its birth contract — navigation
   * presentation — so an author writing `hidden: true` (the Account /
   * personal-settings case, which the platform itself does) must come out of the
   * load path with `hidden: true` still on the app. A conversion firing there
   * would rewrite that into an unpublished app and reproduce #4829 one layer
   * down, through the very machinery meant to repair it. `retiredFromLoadPath`
   * is what buys that, so it is asserted directly rather than inferred.
   */
  describe('app-hidden-to-unpublished (#4829)', () => {
    const storedApp = (app: Record<string, unknown>) => ({ apps: [{ name: 'production_management', ...app }] });
    const convertStored = (stack: Record<string, unknown>) => {
      const notices: ConversionNotice[] = [];
      const out = applyConversions(stack, { includeRetired: true, onNotice: (n) => notices.push(n) });
      return { out, notices };
    };
    const appOf = (stack: Record<string, unknown>) => (stack.apps as Record<string, unknown>[])[0]!;

    it('rewrites a stored `hidden: true` app to `_unpublished: true`, dropping `hidden`', () => {
      const { out, notices } = convertStored(storedApp({ hidden: true, label: 'PM', navigation: [] }));
      expect(appOf(out)).toEqual({ name: 'production_management', _unpublished: true, label: 'PM', navigation: [] });
      expect(notices.map((n) => n.conversionId)).toEqual(['app-hidden-to-unpublished']);
      expect(notices[0]!.path).toBe('apps[0]._unpublished');
      expect(notices[0]!.from).toBe('hidden');
      expect(notices[0]!.to).toBe('_unpublished');
    });

    it('leaves `hidden: false` alone — it meant "listed" under both regimes', () => {
      const before = storedApp({ hidden: false, navigation: [] });
      const { out, notices } = convertStored(before);
      expect(out).toBe(before);
      expect(notices).toEqual([]);
    });

    it('#4923: a row that already carries `_unpublished` keeps BOTH keys, untouched', () => {
      // The machine has already spoken about this row. Reconciling a
      // disagreeing pair is a human's call, not the loader's — and it is what
      // makes the pass idempotent on a row that has already converted.
      const before = storedApp({ hidden: true, _unpublished: false, navigation: [] });
      const { out, notices } = convertStored(before);
      expect(out).toBe(before);
      expect(notices).toEqual([]);
    });

    it('is idempotent — the converted result replays to itself with no second notice', () => {
      const once = applyConversions(storedApp({ hidden: true, navigation: [] }), { includeRetired: true });
      const notices: ConversionNotice[] = [];
      const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
      expect(twice).toBe(once);
      expect(notices).toEqual([]);
    });

    it('replays on the STORED seam, which is the population it exists for', () => {
      const converted = applyConversionsToStoredItem('app', { name: 'edu_admin', hidden: true, navigation: [] });
      expect(converted).toEqual({ name: 'edu_admin', _unpublished: true, navigation: [] });
    });

    // ---- the reach, asserted in the negative ----

    it('⛔ does NOT fire on the LOAD path — an authored `hidden: true` survives verbatim', () => {
      // `includeRetired` defaults to false, which IS the load seam
      // (`normalizeStackInput` for defineStack / validate / lint). This is the
      // assertion that keeps the built-in Account app — authored `hidden: true`
      // for the avatar-menu reason — from being converted into an app no normal
      // user may reach, which is the #4829 defect itself.
      const account = { apps: [{ name: 'account', label: 'Account', hidden: true, navigation: [] }] };
      const notices: ConversionNotice[] = [];
      const out = applyConversions(account, { onNotice: (n) => notices.push(n) });
      expect(out).toBe(account);
      expect(appOf(out)).toEqual({ name: 'account', label: 'Account', hidden: true, navigation: [] });
      expect(notices).toEqual([]);
    });

    it('is declared `retiredFromLoadPath` — the flag IS the load-path exclusion', () => {
      const entry = ALL_CONVERSIONS.find((c) => c.id === 'app-hidden-to-unpublished');
      expect(entry).toBeDefined();
      expect(entry!.retiredFromLoadPath).toBe(true);
      expect(entry!.toMajor).toBe(17);
    });
  });
});
