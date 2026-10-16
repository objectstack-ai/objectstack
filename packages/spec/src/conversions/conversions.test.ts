// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { CreateRecordConfigSchema } from '../automation/builtin-node-config.zod.js';
import { FlowSchema } from '../automation/flow.zod.js';
import { FLOW_RESERVED_NODE_TYPES } from '../automation/flow-reserved-node-types.js';
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
import { JobSchema, RetryPolicySchema } from '../system/job.zod.js';
import { defineStack } from '../stack.zod.js';
import { applyMetaMigrations } from '../migrations/chain.js';
import { applyConversions, applyConversionsToFlow, collectConversionNotices } from './apply.js';
import { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import { renameConfigKey, renameKey } from './walk.js';
import { CONVERSION_NOTICE_CODE, type ConversionNotice } from './types.js';

/**
 * A RELEASED major's fixture whose whole surface a LATER major retired, keyed
 * by the fixture's id and naming the retiring entry.
 *
 * The contract below is that every fixture, replayed through the WHOLE table,
 * equals its own `after` — which is what keeps two entries of one major from
 * silently composing. It cannot hold for an entry of a released major once a
 * later major removes the container its only surface lives in: the later strip
 * runs after it on every replay, by design, and the released entry can be
 * neither absorbed (its id and step are published in that major's
 * `spec-changes.json` and upgrade guide) nor given a fixture the later strip
 * leaves alone (it has no other surface). So such a fixture is replayed with
 * the retiring entry excluded — its own contract, byte for byte — AND replayed
 * with it, where the result must be exactly what the retiring entry produces on
 * top. Both legs are asserted; nothing is skipped.
 *
 * ⛔ Not a way out of a same-major collision: an entry here must be from an
 * EARLIER major than the one that retires its surface (asserted below), and a
 * same-major pair is absorbed instead (`spec-property-retirement` §0).
 */
const SUPERSEDED_FIXTURES: Readonly<Record<string, { by: string; stripped: readonly string[] }>> = {
  // `connector.fieldMappings[].transform` (17) lives only inside
  // `connector.fieldMappings`, which protocol 18 retired whole with the rest of
  // connector-attached sync (ADR-0049).
  'field-mapping-transform-removed': { by: 'connector-sync-keys-removed', stripped: ['fieldMappings'] },
};

describe('conversion layer (ADR-0087 D2)', () => {
  describe('fixture pairs — every entry converts old shape → canonical', () => {
    for (const conversion of ALL_CONVERSIONS) {
      it(`${conversion.id}: before → after, emits ${conversion.fixture.expectedNotices} notice(s)`, () => {
        const superseded = SUPERSEDED_FIXTURES[conversion.id];
        // `includeRetired` so graduated (load-retired) entries stay fixture-tested
        // forever — the chain replays them even though the loader no longer does.
        const { stack, notices } = collectConversionNotices(
          structuredClone(conversion.fixture.before),
          { includeRetired: true, ...(superseded ? { excludeConversionIds: [superseded.by] } : {}) },
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
        if (superseded) {
          // The other leg: the full table, retiring entry included. The result
          // is this fixture's `after` with the retired container stripped from
          // every connector, and the extra notices are all the retiring entry's.
          const retiring = ALL_CONVERSIONS.find((c) => c.id === superseded.by);
          expect(retiring, `${superseded.by} must be registered`).toBeDefined();
          expect(retiring!.toMajor, 'a superseding entry must come from a LATER major').toBeGreaterThan(conversion.toMajor);
          const full = collectConversionNotices(structuredClone(conversion.fixture.before), { includeRetired: true });
          const expected = structuredClone(conversion.fixture.after) as { connectors: Record<string, unknown>[] };
          for (const c of expected.connectors) for (const key of superseded.stripped) delete c[key];
          expect(full.stack).toEqual(expected);
          const extra = full.notices.filter((n) => n.conversionId !== conversion.id);
          expect(extra.length, 'the retiring entry must actually fire on this fixture').toBeGreaterThan(0);
          for (const n of extra) expect(n.conversionId).toBe(superseded.by);
          expect(full.notices.length - extra.length).toBe(conversion.fixture.expectedNotices);
        }
      });
    }
  });

  it('every superseded fixture names a registered entry and a registered retiring entry', () => {
    const ids = new Set(ALL_CONVERSIONS.map((c) => c.id));
    for (const [id, { by }] of Object.entries(SUPERSEDED_FIXTURES)) {
      expect(ids.has(id), id).toBe(true);
      expect(ids.has(by), by).toBe(true);
    }
  });

  describe('immutability & non-interference', () => {
    it('returns the same reference when nothing converts', () => {
      const clean = { objects: [{ name: 'account' }], flows: [{ name: 'f', nodes: [] }] };
      expect(applyConversions(clean)).toBe(clean);
    });

    // The data-at-rest posture (`includeRetired`): since #23543 F5-http no
    // entry is live on the default path, and a pass that converts nothing
    // would hold both claims below vacuously.
    it('never mutates the caller input', () => {
      const before = {
        flows: [{ name: 'f', nodes: [{ id: 'n', type: 'http_request', config: { url: 'x' } }] }],
      };
      const snapshot = structuredClone(before);
      const out = applyConversions(before, { includeRetired: true });
      expect((out.flows as any[])[0].nodes[0].type, 'premise: the pass converted').toBe('http');
      expect(before).toEqual(snapshot);
    });

    it('shares untouched branches (copy-on-write, so plugins survive)', () => {
      const plugin = { onEnable() {} }; // non-clonable value that must be preserved by reference
      const stack: Record<string, unknown> = {
        plugins: [plugin],
        flows: [{ name: 'f', nodes: [{ id: 'n', type: 'http_request', config: { url: 'x' } }] }],
      };
      const out = applyConversions(stack, { includeRetired: true });
      expect(out).not.toBe(stack);
      expect((out.plugins as unknown[])[0]).toBe(plugin); // same reference, untouched
    });
  });

  // `flow-node-http-callout-rename` left the load path at 18 (#23543 F5-http):
  // the rewrite cases run the data-at-rest posture (`includeRetired`) — the
  // replay stored flows still get — and the retirement itself is pinned in the
  // load-path retirement block.
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
      }, { includeRetired: true });
      const nodes = (stack.flows as any[])[0].nodes;
      expect(nodes.map((n: any) => n.type)).toEqual(['http', 'http', 'http']);
      expect(notices).toHaveLength(2); // 'http' was already canonical
      expect(notices.map((n) => n.path)).toEqual(['flows[0].nodes[0].type', 'flows[0].nodes[2].type']);
    });
  });

  /**
   * The ADR-0078 conflict guard this entry carried until 18 is gone (#23543
   * F5-http): it skipped a node whose old name a live executor owned. The
   * engine now refuses to register an executor under a reserved name
   * (`AutomationEngine.registerNodeExecutor`), so no live owner can exist, and
   * the rewrite is unconditional. Protocol 18 removed the conflict channel with
   * it (#24001): a pass has no live-name set to consult and no conflict sink.
   */
  describe('flow-node-http-callout-rename — the rewrite is unconditional', () => {
    it('rewrites a reserved name with one notice and nothing else', () => {
      const notices: ConversionNotice[] = [];
      const out = applyConversions(
        { flows: [{ name: 'f', nodes: [{ id: 'a', type: 'webhook' }] }] },
        {
          includeRetired: true,
          onNotice: (n) => notices.push(n),
        },
      );
      expect((out.flows as any[])[0].nodes[0].type).toBe('http');
      expect(notices.map((n) => n.conversionId)).toEqual(['flow-node-http-callout-rename']);
    });

    it('reads the reserved-name table the flow parse refuses with', () => {
      const types = Object.keys(FLOW_RESERVED_NODE_TYPES);
      expect([...types].sort()).toEqual(['http_call', 'http_request', 'webhook']);
      const { stack, notices } = collectConversionNotices(
        { flows: [{ name: 'f', nodes: types.map((type, i) => ({ id: `n${i}`, type })) }] },
        { includeRetired: true },
      );
      expect((stack.flows as any[])[0].nodes.map((n: any) => n.type)).toEqual(types.map((t) => FLOW_RESERVED_NODE_TYPES[t]));
      expect(notices).toHaveLength(types.length);
    });
  });

  // `flow-node-crud-filter-alias` and `flow-node-crud-object-alias` left the
  // load path at 18 (#23487): the rewrite cases below run the data-at-rest
  // posture (`includeRetired`) — the replay stored flows still get — and the
  // retirement itself is pinned in the load-path retirement block.
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
      }, { includeRetired: true });
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
      }, { includeRetired: true });
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
  describe('shadowed alias, split by value', () => {
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
        { includeRetired: true },
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
      }, { includeRetired: true });
      expect(configOf(stack)).toEqual({ filter: { status: 'stale' } });
      expect(notices).toHaveLength(1);
    });

    it('is idempotent in shape AND notices — the deduped result replays to itself', () => {
      const once = collectConversionNotices(crudFlow({ objectName: 'task', object: 'task' }), { includeRetired: true });
      expect(once.notices).toHaveLength(1);
      const twice = collectConversionNotices(once.stack, { includeRetired: true });
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
      const { stack, notices } = collectConversionNotices(structuredClone(before), { includeRetired: true });
      expect(stack).toEqual(before);
      expect(configOf(stack)).toEqual({ objectName: 'task', object: 'ticket' });
      expect(notices).toHaveLength(0);
    });

    it('judges each pair on its own value — one twin dedupes while its neighbour survives', () => {
      const { stack, notices } = collectConversionNotices(
        crudFlow({ objectName: 'task', object: 'task', filter: { a: 1 }, filters: { a: 2 } }),
        { includeRetired: true },
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

      // A retired entry (#23421), so the data-at-rest posture replays it.
      const equal = collectConversionNotices(header({ title: 'T', subtitle: 'One', description: 'One' }), { includeRetired: true });
      expect(propsOf(equal.stack)).toEqual({ title: 'T', subtitle: 'One' });
      expect(equal.notices).toHaveLength(1);

      const differs = header({ title: 'T', subtitle: 'One', description: 'Another' });
      const kept = collectConversionNotices(structuredClone(differs), { includeRetired: true });
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

    /**
     * The family closed at 18 (#23487): every entry whose window ran out
     * before 18 has a verdict. Seven left the load path (with #23421's two,
     * nine of the family); eight stayed, each with the reason written into its
     * own docblock and what would have to change for it to retire. The
     * #23543 rulings retired all eight (F1–F5, listed below), so none is kept.
     * A new entry below 18 that is neither retired nor listed here is an
     * entry nobody judged.
     */
    it('every entry whose window ran out before 18 is retired or kept by name', () => {
      const kept = ALL_CONVERSIONS.filter((c) => c.toMajor < 18 && !c.retiredFromLoadPath).map((c) => c.id).sort();
      expect(kept).toEqual([]);
      for (const id of [
        'flow-node-crud-filter-alias',
        'flow-node-crud-object-alias',
        'flow-node-notify-config-aliases',
        'flow-node-map-flow-alias',
        'flow-node-subflow-flow-alias',
        'flow-node-script-config-aliases',
        'sharing-rule-access-level-full-to-edit',
        // #23543 F1: retired once `mongo` itself was retired as a value.
        'datasource-driver-mongo-to-mongodb',
        // #23543 F5-jsx: retired once `jsx` itself was retired as a page kind.
        'page-kind-jsx-to-html',
        // #23543 F3: retired once the flow parse refused the loose `config`
        // keys and each lift deleted the keys its block shadows.
        'flow-node-wait-event-config-lift',
        'flow-node-connector-config-lift',
        // #23543 F2: retired once the job parse refused a `retryPolicy` block
        // whose `maxRetries` is omitted or 0.
        'retry-policy-converged',
        // #23543 F4: retired once the view form's `visibleOn` and the page
        // component's `visibility` were themselves retired as keys.
        'view-visibleOn-to-visibleWhen',
        'page-component-visibility-to-visibleWhen',
        // #23543 F5-http: retired once the three names were reserved inside
        // the open node namespace — refused by the flow parse and by the
        // engine's executor registration.
        'flow-node-http-callout-rename',
      ]) {
        expect(ALL_CONVERSIONS.find((c) => c.id === id), id).toMatchObject({ retiredFromLoadPath: true, retiredAfter: '17.7.0' });
      }
    });

    it('a retired flow-node alias reaches defineStack as authored and is refused naming the rename and the release', () => {
      const authored = {
        flows: [{
          name: 'f',
          label: 'F',
          type: 'autolaunched',
          nodes: [
            { id: 's', type: 'start', label: 'S' },
            { id: 'g', type: 'get_record', label: 'G', config: { objectName: 'lead', object: 'lead' } },
          ],
          edges: [],
        }],
      };
      let refusal: unknown;
      try {
        defineStack(authored as never);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
      const issues = (refusal as { issues: { path: PropertyKey[]; message: string }[] }).issues;
      expect(issues.map((i) => i.path.join('.'))).toEqual(['flows.0.nodes.1.config.object']);
      expect(issues[0]!.message).toContain('`object` was removed in @objectstack/spec 18');
      expect(issues[0]!.message).toContain('Use `objectName`');
    });

    it('a reserved callout node type reaches defineStack as authored and is refused naming http and the release', () => {
      const authored = {
        flows: [{
          name: 'f',
          label: 'F',
          type: 'autolaunched',
          nodes: [
            { id: 's', type: 'start', label: 'S' },
            { id: 'h', type: 'http_request', label: 'H', config: { url: 'https://example.com' } },
          ],
          edges: [],
        }],
      };
      let refusal: unknown;
      try {
        defineStack(authored as never);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
      const issues = (refusal as { issues: { path: PropertyKey[]; message: string }[] }).issues;
      expect(issues.map((i) => i.path.join('.'))).toEqual(['flows.0.nodes.1.type']);
      expect(issues[0]!.message).toContain("Flow node `type: 'http_request'` was removed in @objectstack/spec 18");
      expect(issues[0]!.message).toContain("Use `type: 'http'`");
    });

    // Until #23543 F5-http this block also held 'a live-window conversion still
    // applies at load', driven by the callout rename, the last entry below 18
    // left live. With it retired no real entry is live on the default path, so
    // that claim (and the `normalizeStackInput` sink cases below that rode the
    // same entry) moved to `apply-live-window.test.ts`, which owns a test-only
    // live entry and so does not depend on any real entry's lifecycle.
  });

  /**
   * `flow-decision-mode-inclusive-explicit` (#15429) — the DEFAULT FLIP that
   * carries an edge-branched decision across the exclusive-gateway ruling.
   *
   * The fixture pair above pins the rewrite; what needs its own cover is the
   * PREDICATE's edges (the count, the two shapes it must leave alone, regions)
   * and its JURISDICTION: the chain replays it, the authoring funnel does not,
   * and a second replay is a no-op. The flow rehydration seam's refusal by id
   * is pinned where that seam lives (`service-automation`).
   */
  describe('flow-decision-mode-inclusive-explicit', () => {
    const ID = 'flow-decision-mode-inclusive-explicit';
    const entry = () => ALL_CONVERSIONS.find((c) => c.id === ID)!;
    const decisionFlow = (edges: Record<string, unknown>[], config?: Record<string, unknown>) => ({
      flows: [{
        name: 'gateway',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'check', type: 'decision', label: 'Check', ...(config ? { config } : {}) },
          { id: 'a', type: 'end', label: 'A' },
          { id: 'b', type: 'end', label: 'B' },
          { id: 'c', type: 'end', label: 'C' },
        ],
        edges: [{ id: 'e0', source: 'start', target: 'check' }, ...edges],
      }],
    });
    const chain = (stack: Record<string, unknown>) => applyMetaMigrations(structuredClone(stack), 17, 18);
    const checkConfigAfter = (result: ReturnType<typeof applyMetaMigrations>) =>
      ((result.stack.flows as any[])[0].nodes as any[]).find((n) => n.id === 'check').config;
    const two = [
      { id: 'e1', source: 'check', target: 'a', condition: "x != 'a'" },
      { id: 'e2', source: 'check', target: 'b', condition: "x == 'b'" },
    ];

    it('is registered at protocol 18, retired from the load path, and wired into the step-18 chain', () => {
      expect(entry().toMajor).toBe(18);
      expect(entry().retiredFromLoadPath).toBe(true);
      const result = chain(decisionFlow(two));
      expect(result.applied.map((a) => a.conversionId)).toContain(ID);
    });

    it('writes `mode: inclusive` on two conditioned out-edges, and says what the site relied on', () => {
      const result = chain(decisionFlow(two));
      expect(checkConfigAfter(result)).toEqual({ mode: 'inclusive' });
      const mine = result.applied.filter((a) => a.conversionId === ID);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.path).toBe('flows[0].nodes[1].config.mode');
      expect(mine[0]!.from).toContain('2 conditioned out-edges');
      expect(mine[0]!.to).toBe('inclusive');
    });

    it('counts an envelope condition, and a third conditioned edge, but never a fault edge or a blank one', () => {
      const three = [
        ...two,
        { id: 'e3', source: 'check', target: 'c', condition: { dialect: 'cel', source: "x == 'c'" } },
      ];
      expect(checkConfigAfter(chain(decisionFlow(three)))).toEqual({ mode: 'inclusive' });
      // A `fault` edge is error routing; a blank condition is no condition.
      const notBranches = [
        { id: 'e1', source: 'check', target: 'a', condition: "x != 'a'" },
        { id: 'e2', source: 'check', target: 'b', condition: "x == 'b'", type: 'fault' },
        { id: 'e3', source: 'check', target: 'c', condition: '   ' },
      ];
      expect(checkConfigAfter(chain(decisionFlow(notBranches)))).toBeUndefined();
    });

    it('leaves ONE conditioned out-edge plus a default alone — first-match and every-true-edge cannot differ', () => {
      const guarded = [
        { id: 'e1', source: 'check', target: 'a', condition: "x == 'a'" },
        { id: 'e2', source: 'check', target: 'b', isDefault: true },
      ];
      const result = chain(decisionFlow(guarded));
      expect(checkConfigAfter(result)).toBeUndefined();
      expect(result.applied.filter((a) => a.conversionId === ID)).toEqual([]);
    });

    it('leaves a decision that already declares `mode` alone — either member — and a `conditions` list alone', () => {
      expect(checkConfigAfter(chain(decisionFlow(two, { mode: 'exclusive' })))).toEqual({ mode: 'exclusive' });
      expect(checkConfigAfter(chain(decisionFlow(two, { mode: 'inclusive' })))).toEqual({ mode: 'inclusive' });
      const listed = { conditions: [{ label: 'A', expression: "x == 'a'" }] };
      expect(checkConfigAfter(chain(decisionFlow(two, listed)))).toEqual(listed);
      // An EMPTY list declares no branch: the node routes on its edges, so it is rewritten.
      expect(checkConfigAfter(chain(decisionFlow(two, { conditions: [] })))).toEqual({ conditions: [], mode: 'inclusive' });
    });

    it('never touches a non-decision node with the same two conditioned out-edges', () => {
      const stack = decisionFlow(two);
      (stack.flows[0]!.nodes[1] as Record<string, unknown>).type = 'screen';
      const result = chain(stack);
      expect(checkConfigAfter(result)).toBeUndefined();
      expect(result.applied.filter((a) => a.conversionId === ID)).toEqual([]);
    });

    it('is idempotent: the migrated stack replays to itself with nothing applied', () => {
      const first = chain(decisionFlow(two));
      const again = applyMetaMigrations(structuredClone(first.stack), 17, 18);
      expect(again.stack).toEqual(first.stack);
      expect(again.applied.filter((a) => a.conversionId === ID)).toEqual([]);
    });

    it('⛔ never replays on the authoring funnel — a decision written against the new contract stays exclusive', () => {
      const authored = decisionFlow(two);
      const notices: ConversionNotice[] = [];
      const out = normalizeStackInput(structuredClone(authored), { onConversionNotice: (n) => notices.push(n) });
      expect(out).toEqual(authored);
      expect(notices.map((n) => n.conversionId)).not.toContain(ID);
    });

    it('a seam that opens the retired window can still refuse it by id — the flow rehydration seam does', () => {
      // The primitive behind `CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION` in the
      // automation engine: same bytes, window open, entry refused by name.
      const notices: ConversionNotice[] = [];
      const out = applyConversions(decisionFlow(two), {
        includeRetired: true,
        excludeConversionIds: [ID],
        onNotice: (n) => notices.push(n),
      });
      expect(((out.flows as any[])[0].nodes as any[])[1].config).toBeUndefined();
      expect(notices.map((n) => n.conversionId)).not.toContain(ID);
      // FIRING CONTROL: with the window open and no refusal, it does fire.
      const fired = applyConversions(decisionFlow(two), { includeRetired: true });
      expect(((fired.flows as any[])[0].nodes as any[])[1].config).toEqual({ mode: 'inclusive' });
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
    // The three sink / map-collection cases that stood here moved to
    // `apply-live-window.test.ts` with #23543 F5-http: they need a LIVE entry,
    // and the callout rename that drove them was the last one below 18.
    it('a retired callout name passes the authoring funnel as written, while the stored-row door converts it', () => {
      const notices: ConversionNotice[] = [];
      const authored = { flows: { my_flow: { nodes: [{ id: 'n', type: 'webhook' }] } } as any };
      const out = normalizeStackInput(structuredClone(authored), { onConversionNotice: (n) => notices.push(n) });
      const flows = out.flows as any[];
      expect(flows[0].name).toBe('my_flow'); // the map is still normalized
      expect(flows[0].nodes[0].type).toBe('webhook'); // …but not converted: the parse refuses it
      expect(notices).toEqual([]);
      const stored = applyConversionsToStoredItem('flow', { name: 'my_flow', nodes: [{ id: 'n', type: 'webhook' }] }) as {
        nodes: Array<{ type: string }>;
      };
      expect(stored.nodes[0]!.type).toBe('http');
    });

    /**
     * The jurisdiction pin for `retiredFromLoadPath` (commit 29dd1a6dd).
     *
     * `apply.ts` and `types.ts` now declare that retirement is an AUTHORING
     * surface event: the flag keeps an entry off `normalizeStackInput`, while
     * data-at-rest seams replay it on purpose. Both halves are asserted here,
     * through the real doors rather than through `applyConversions` directly
     * — the cases elsewhere in this file drive the primitive, so they would
     * all stay green if `normalizeStackInput` ever started passing
     * `includeRetired`, and the declaration would go stale unnoticed. This is
     * the test that fails first when either half moves.
     */
    it('⛔ does NOT replay a RETIRED entry, while the stored-row door does', () => {
      const entry = ALL_CONVERSIONS.find((c) => c.id === 'app-hidden-to-unpublished');
      // Premise: without this the assertions below would pass vacuously.
      expect(entry?.retiredFromLoadPath, 'premise: the entry under test is retired').toBe(true);

      const authored = { name: 'account', label: 'Account', hidden: true, navigation: [] };

      // Authoring funnel: the old shape survives verbatim, nothing is reported.
      const notices: ConversionNotice[] = [];
      const out = normalizeStackInput(
        { apps: [structuredClone(authored)] },
        { onConversionNotice: (n) => notices.push(n) },
      );
      expect((out.apps as any[])[0]).toEqual(authored);
      expect(notices).toEqual([]);

      // Data at rest: the SAME bytes through the stored-row door DO convert.
      const stored = applyConversionsToStoredItem('app', structuredClone(authored)) as Record<
        string,
        unknown
      >;
      expect(stored.hidden).toBeUndefined();
      expect(stored._unpublished).toBe(true);
    });
  });

  describe('flow-node-wait-timeout-keys-removed', () => {
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
        expect(() => FlowSchema.parse(flow), `${Object.keys(bad)[0]} must be rejected`)
          .toThrow(/was removed in @objectstack\/spec 17/);
      }
    });
  });

  describe('flow-node-script-branch-keys-removed', () => {
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
        ).toThrow(/was removed in @objectstack\/spec 17/);
      }
      // The flow-level parse is deliberately blind to the TOMBSTONES — pinned so
      // the note above stays true if `FlowNodeSchema.config` is ever tightened.
      // What it does see since #20316 is the one key the script contract
      // requires, left out: a stripped node naming no callable is refused at
      // the build doors now, not only at execute — and by that, never by a
      // tombstone.
      expect(() => FlowSchema.parse((scriptFlow({ function: 'score_lead', actionType: 'email' }).flows as any[])[0])).not.toThrow();
      const stripped = FlowSchema.safeParse((scriptFlow({ actionType: 'email' }).flows as any[])[0]);
      expect(stripped.success).toBe(false);
      expect(stripped.error!.issues.map((i) => i.path.join('.'))).toEqual(['nodes.1.config.function']);
      expect(stripped.error!.issues[0].message).not.toMatch(/was removed in @objectstack\/spec 17/);
    });
  });

  // #23543 F3 retired both sibling-block lifts at 18. Every lift case below
  // replays the chain the way a stored flow meets it (`includeRetired`, the
  // automation engine's rehydration seam); the last describe pins the three
  // claims the retirement makes together.
  describe('flow-node-wait-event-config-lift (PD #12 retirement)', () => {
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
    const stored = (stack: Record<string, unknown>) => collectConversionNotices(stack, { includeRetired: true });

    it('lifts the undeclared `duration` / `signal` spellings onto the declared block', () => {
      const { stack, notices } = stored(waitFlow({ config: { duration: 'PT1M' } }));
      expect(waitNodeOf(stack).waitEventConfig).toEqual({ timerDuration: 'PT1M', eventType: 'timer' });
      expect(waitNodeOf(stack).config).toEqual({});
      expect(notices).toHaveLength(1);

      const sig = stored(waitFlow({ config: { eventType: 'signal', signal: 'order_paid' } }));
      expect(waitNodeOf(sig.stack).waitEventConfig).toEqual({ eventType: 'signal', signalName: 'order_paid' });
      expect(sig.notices).toHaveLength(2);
    });

    it('lets a declared value win and deletes its shadowed loose counterpart', () => {
      const { stack, notices } = stored(
        waitFlow({
          waitEventConfig: { eventType: 'timer', timerDuration: 'PT5M' },
          // (Not `timeoutMs` as the second key: with the full chain replayed,
          // protocol 17's `flow-node-wait-timeout-keys-removed` deletes it
          // from the block again.)
          config: { duration: 'PT9M', signalName: 'order_paid' },
        }),
      );
      expect(waitNodeOf(stack).waitEventConfig).toEqual({
        eventType: 'timer',
        timerDuration: 'PT5M',
        signalName: 'order_paid',
      });
      // #23543 F3: the shadowed loose key is deleted, not left in place — the
      // flow parse refuses every named loose key since 18, so a kept one would
      // stop the stored flow loading. One notice per key: the lift and the drop.
      expect(waitNodeOf(stack).config).toEqual({});
      expect(notices.map((n) => n.to)).toEqual([
        '(removed — `waitEventConfig.timerDuration` already set, so it was never read)',
        'waitEventConfig.signalName',
      ]);
    });

    it('prefers the declared spelling over the undeclared one among loose keys, and drops the loser', () => {
      const { stack } = stored(waitFlow({ config: { timerDuration: 'PT1H', duration: 'PT2H' } }));
      expect(waitNodeOf(stack).waitEventConfig.timerDuration).toBe('PT1H');
      // `duration` was never reachable past the `??` chain either — deleted.
      expect(waitNodeOf(stack).config).toEqual({});
    });

    it('a loose `null` is skipped by the precedence and deleted, as the `??` chain skipped it', () => {
      const { stack } = stored(waitFlow({ config: { timerDuration: null, duration: 'PT2H', note: 'keep me' } }));
      expect(waitNodeOf(stack).waitEventConfig).toEqual({ timerDuration: 'PT2H', eventType: 'timer' });
      expect(waitNodeOf(stack).config).toEqual({ note: 'keep me' });
    });

    /**
     * The exact shape the showcase's `wait_revision` node carried before this
     * change — the declared spelling sitting in the undeclared LOCATION, which is
     * the combination the ledger's candidate order has to get right.
     */
    it('lifts the showcase shape: declared key names in a loose `config`', () => {
      const { stack, notices } = stored(waitFlow({ config: { eventType: 'signal', signalName: 'budget_revision' } }));
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
      const { stack, notices } = stored(structuredClone(before));
      expect(waitNodeOf(stack)).toEqual(waitNodeOf(before as any));
      expect(notices).toHaveLength(0);
    });

    it('only touches `wait` — the same keys on another node type are not its surface', () => {
      const { stack, notices } = stored({
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
      const { stack } = stored(waitFlow({ config: { duration: 'PT1M' } }));
      const converted = (stack.flows as any[])[0];
      expect(() => FlowSchema.parse(converted)).not.toThrow();

      const withoutDefault = structuredClone(converted);
      delete withoutDefault.nodes[1].waitEventConfig.eventType;
      expect(() => FlowSchema.parse(withoutDefault)).toThrow();
    });
  });

  describe('flow-node-connector-config-lift (stored rows)', () => {
    const connectorFlow = (node: Record<string, unknown>) => ({
      flows: [
        {
          name: 'notify_slack',
          label: 'Notify Slack',
          type: 'autolaunched',
          edges: [],
          nodes: [
            { id: 'n1', type: 'start', label: 'Start' },
            { id: 'c', type: 'connector_action', label: 'Call', ...node },
          ],
        },
      ],
    });
    const nodeOf = (stack: Record<string, unknown>) => (stack.flows as any[])[0].nodes[1];
    const stored = (stack: Record<string, unknown>) => collectConversionNotices(stack, { includeRetired: true });

    it('lifts the mis-taught trio into the block', () => {
      const { stack, notices } = stored(
        connectorFlow({ config: { connectorId: 'slack', actionId: 'chat.postMessage', input: { text: 'Hi' } } }),
      );
      expect(nodeOf(stack).connectorConfig).toEqual({ connectorId: 'slack', actionId: 'chat.postMessage', input: { text: 'Hi' } });
      expect(nodeOf(stack).config).toEqual({});
      expect(notices).toHaveLength(3);
      expect(FlowSchema.safeParse((stack.flows as any[])[0]).success).toBe(true);
    });

    it('deletes a loose key the complete block shadows, and lifts the one it does not', () => {
      const { stack, notices } = stored(
        connectorFlow({
          connectorConfig: { connectorId: 'rest', actionId: 'get' },
          config: { connectorId: 'ignored', input: { path: '/health' }, note: 'keep me' },
        }),
      );
      expect(nodeOf(stack).connectorConfig).toEqual({ connectorId: 'rest', actionId: 'get', input: { path: '/health' } });
      expect(nodeOf(stack).config).toEqual({ note: 'keep me' });
      expect(notices.map((n) => n.from).sort()).toEqual(['config.connectorId', 'config.input']);
    });

    it('the completeness guard leaves a node it cannot complete untouched — it fails to load either way', () => {
      const before = connectorFlow({ config: { connectorId: 'slack' } });
      const { stack, notices } = stored(structuredClone(before));
      expect(nodeOf(stack)).toEqual(nodeOf(before));
      expect(notices).toHaveLength(0);
      const parsed = FlowSchema.safeParse((stack.flows as any[])[0]);
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues.map((i) => i.path.join('.'))).toEqual(['nodes.1.connectorConfig', 'nodes.1.config.connectorId']);
    });
  });

  // #23543 F3 — the retirement's three claims, for both node types: a STORED
  // flow (the `includeRetired` seams) still loads, shadowed loose key and all;
  // the authoring funnel no longer rewrites an authored loose key; and an
  // authored loose key meets the prescription naming its block key instead.
  describe('the sibling-block lifts are retired (#23543 F3)', () => {
    const flowOf = (node: Record<string, unknown>) => ({
      name: 'settle',
      label: 'Settle',
      type: 'autolaunched',
      edges: [],
      nodes: [
        { id: 'n1', type: 'start', label: 'Start' },
        { label: 'Step', ...node },
      ],
    });
    const LOOSE_WAIT = { id: 'w', type: 'wait', config: { eventType: 'signal', signal: 'order_paid' } };
    const SHADOWED_WAIT = {
      id: 'w',
      type: 'wait',
      waitEventConfig: { eventType: 'timer', timerDuration: 'PT5M' },
      config: { duration: 'PT9M' },
    };
    const LOOSE_CONNECTOR = { id: 'c', type: 'connector_action', config: { connectorId: 'slack', actionId: 'chat.postMessage' } };
    const SHADOWED_CONNECTOR = {
      id: 'c',
      type: 'connector_action',
      connectorConfig: { connectorId: 'slack', actionId: 'chat.postMessage', input: { text: 'Hi' } },
      config: { input: { text: 'stale' } },
    };

    it.each([
      ['a loose-only wait row', LOOSE_WAIT, { waitEventConfig: { eventType: 'signal', signalName: 'order_paid' }, config: {} }],
      ['a wait row whose block shadows a loose key', SHADOWED_WAIT, { waitEventConfig: SHADOWED_WAIT.waitEventConfig, config: {} }],
      ['a loose-only connector row', LOOSE_CONNECTOR, { connectorConfig: LOOSE_CONNECTOR.config, config: {} }],
      ['a connector row whose block shadows a loose key', SHADOWED_CONNECTOR, { connectorConfig: SHADOWED_CONNECTOR.connectorConfig, config: {} }],
    ])('%s still loads at the rehydration seam, with the block alone', (_name, node, expected) => {
      const raw = flowOf(node);
      // The stored row as written is what the parse now refuses …
      expect(FlowSchema.safeParse(raw).success).toBe(false);
      // … and the seam's replay (the automation engine's call) makes it load.
      const converted = applyConversionsToFlow(structuredClone(raw), { includeRetired: true }) as ReturnType<typeof flowOf>;
      expect(converted.nodes[1]).toMatchObject(expected);
      expect(FlowSchema.safeParse(converted).success).toBe(true);
    });

    it('is retired from the load path — the authoring funnel no longer lifts an authored loose key', () => {
      for (const node of [LOOSE_WAIT, SHADOWED_WAIT, LOOSE_CONNECTOR, SHADOWED_CONNECTOR]) {
        const before = { flows: [flowOf(node)] };
        const { stack, notices } = collectConversionNotices(structuredClone(before));
        expect(stack, node.type).toEqual(before);
        expect(notices, node.type).toHaveLength(0);
      }
    });

    it.each([
      ['wait', SHADOWED_WAIT, 'nodes.1.config.duration', "A `wait` node's `config.duration` was removed in @objectstack/spec 18", '`waitEventConfig.timerDuration`'],
      ['connector_action', SHADOWED_CONNECTOR, 'nodes.1.config.input', "A `connector_action` node's `config.input` was removed in @objectstack/spec 18", '`connectorConfig.input`'],
    ])('an authored loose key on a %s node reaches defineStack as written and is refused naming its block key', (_type, node, path, first, target) => {
      let refusal: unknown;
      try {
        defineStack({ flows: [flowOf(node)] } as never);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
      const issues = (refusal as { issues: { path: PropertyKey[]; message: string }[] }).issues;
      // The loose key is the ONE issue: the block is complete, so the refusal
      // is about the location alone.
      expect(issues.map((i) => i.path.join('.'))).toEqual([`flows.0.${path}`]);
      expect(issues[0]!.message.startsWith(first)).toBe(true);
      expect(issues[0]!.message).toContain(`Move it to ${target}`);
    });

    it('refuses every named loose key and no other — the table is the lifts\' own', () => {
      const parsed = FlowSchema.safeParse(flowOf({
        id: 'w',
        type: 'wait',
        waitEventConfig: { eventType: 'timer', timerDuration: 'PT5M' },
        config: { eventType: 'timer', timerDuration: 'PT1M', duration: 'PT1M', signalName: 's', signal: 's', timeoutMs: 1, note: 'not a lifted key' },
      }));
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues.map((i) => i.path.slice(3).join('.')).sort()).toEqual(
        ['duration', 'eventType', 'signal', 'signalName', 'timeoutMs', 'timerDuration'],
      );
      // CONTROL — the declared blocks alone parse, and the same keys under
      // another node type's `config` are not this refusal's.
      expect(FlowSchema.safeParse(flowOf({ id: 'w', type: 'wait', waitEventConfig: { eventType: 'timer', timerDuration: 'PT5M' } })).success).toBe(true);
      expect(FlowSchema.safeParse(flowOf({ id: 'c', type: 'connector_action', connectorConfig: SHADOWED_CONNECTOR.connectorConfig })).success).toBe(true);
      const other = FlowSchema.safeParse(flowOf({ id: 'a', type: 'assignment', config: { input: 1, duration: 'PT1M' } }));
      expect(other.success ? [] : other.error.issues.map((i) => i.message)).not.toContainEqual(expect.stringContaining('was removed in @objectstack/spec 18'));
    });
  });

  // #23543 F2 — the job half of `retry-policy-converged` was the only reason
  // it stayed on the load path. The retirement's claims: an AUTHORED block with
  // no attempts meets the prescription instead of a silent `maxRetries: 3`; a
  // STORED row still loads with the numbers it ran with (the data-at-rest seams
  // replay the entry); the flow half needed nothing beyond the retirement,
  // because the `retryDelayMs` tombstone already carries its rename.
  describe('retry-policy-converged is retired (#23543 F2)', () => {
    const jobOf = (retryPolicy: Record<string, unknown>) => ({
      name: 'nightly_sync',
      schedule: { type: 'cron', expression: '0 0 * * *' },
      handler: 'syncOrders',
      retryPolicy,
    });
    const refusalOf = (authored: Record<string, unknown>) => {
      let refusal: unknown;
      try {
        defineStack(authored as never);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
      return (refusal as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    };

    it.each([
      ['omits `maxRetries`', { backoffMs: 5000 }],
      ['writes `maxRetries: 0`', { maxRetries: 0, backoffMs: 5000 }],
    ])('an authored job block that %s reaches defineStack as written and is refused at the key', (_name, policy) => {
      const issues = refusalOf({ jobs: [jobOf(policy)] });
      // The count is the ONE issue: the job is otherwise complete.
      expect(issues.map((i) => i.path.join('.'))).toEqual(['jobs.0.retryPolicy.maxRetries']);
      expect(issues[0]!.message.startsWith(
        'A retry block with no attempts is no retry block: state `maxRetries` ≥ 1, for example 3, or delete the block.',
      )).toBe(true);
    });

    it('is retired from the load path — the authoring funnel writes no count into an authored block', () => {
      const before = { jobs: [jobOf({ backoffMs: 5000 })] };
      const { stack, notices } = collectConversionNotices(structuredClone(before));
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
    });

    it('a stored job row with no count still loads at the rehydration seam, with the pre-17 numbers', () => {
      const raw = jobOf({ backoffMs: 5000 });
      // The row as written is what the parse now refuses …
      expect(JobSchema.safeParse(raw).success).toBe(false);
      // … and the seam's replay (stored-row rehydration) makes it load, three retries and all.
      const converted = applyConversionsToStoredItem('job', structuredClone(raw));
      expect(converted.retryPolicy).toEqual({ backoffMs: 5000, maxRetries: 3, backoffMultiplier: 2 });
      expect(JobSchema.safeParse(converted).success).toBe(true);
    });

    it('the flow half needed nothing more: an authored `retryDelayMs` meets its tombstone naming `backoffMs`', () => {
      const issues = refusalOf({
        flows: [{
          name: 'sync_orders',
          label: 'Sync',
          type: 'autolaunched',
          errorHandling: { strategy: 'retry', maxRetries: 3, retryDelayMs: 2000 },
          nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
          edges: [{ id: 'e1', source: 'start', target: 'end' }],
        }],
      });
      expect(issues.map((i) => i.path.join('.'))).toEqual(['flows.0.errorHandling.retryDelayMs']);
      expect(issues[0]!.message).toContain('Rename the key to `backoffMs`');
    });

    it('CONTROL — a job with no block, and a block stating `maxRetries: 1`, both parse; an omitted multiplier keeps its default', () => {
      const { retryPolicy: _none, ...bare } = jobOf({});
      expect(JobSchema.safeParse(bare).success).toBe(true);
      const one = JobSchema.safeParse(jobOf({ maxRetries: 1 }));
      expect(one.success).toBe(true);
      expect(one.data!.retryPolicy).toMatchObject({ maxRetries: 1, backoffMultiplier: 1 });
      expect(() => defineStack({ jobs: [jobOf({ maxRetries: 1 }), { ...bare, name: 'weekly_purge' }] } as never)).not.toThrow();
    });

    it('the same block on a `try_catch` node\'s `retry` is not this rule\'s — the shared schema is unchanged', () => {
      expect(RetryPolicySchema.safeParse({ backoffMs: 5000 }).success).toBe(true);
    });
  });

  // Commit e2798fab7 renamed the canonical id `mongo` → `mongodb`; #23543 F1
  // retired `mongo` as a value at 18. Three claims hold together: the stored
  // value still CONVERGES (the data-at-rest seams replay the retired entry), an
  // AUTHORED `mongo` meets the prescription instead of a silent rewrite, and a
  // stored row the chain has not reached keeps its contract — the half that
  // keeps its credential redaction (`DriverVocabularyEntry.retiredAliases`).
  describe('datasource-driver-mongo-to-mongodb', () => {
    const convert = (datasources: unknown[]) =>
      collectConversionNotices({ datasources }, { includeRetired: true });

    it('converts a stored `driver: "mongo"` row to `mongodb`', () => {
      const row = { name: 'events', driver: 'mongo', config: { url: 'mongodb://db/x' }, origin: 'runtime' };
      const out = applyConversionsToStoredItem('datasource', row) as { driver: string };
      expect(out.driver).toBe('mongodb');
      // …and the converted row parses: the refusal below is never what a stored row meets.
      expect(DatasourceSchema.safeParse(out).success).toBe(true);
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

    it('is retired from the load path — the authoring funnel no longer rewrites an authored `mongo`', () => {
      const before = { datasources: [{ name: 'events', driver: 'mongo', config: { url: 'mongodb://db/x' } }] };
      const { stack, notices } = collectConversionNotices(structuredClone(before));
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
    });

    it('an authored `mongo` reaches defineStack as written and is refused naming `mongodb` and the release', () => {
      let refusal: unknown;
      try {
        defineStack({
          datasources: [{ name: 'events', label: 'Events', driver: 'mongo', config: { url: 'mongodb://db/x' } }],
        } as never);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
      const issues = (refusal as { issues: { path: PropertyKey[]; message: string }[] }).issues;
      // The driver is the ONE issue: the config is a valid mongodb config, so
      // the refusal is about the spelling alone.
      expect(issues.map((i) => i.path.join('.'))).toEqual(['datasources.0.driver']);
      expect(issues[0]!.message).toMatch(/^Datasource `driver: 'mongo'` was removed in @objectstack\/spec 18 \(ADR-0087 D2\)/);
      expect(issues[0]!.message).toContain("Use `driver: 'mongodb'`");
      // Case and whitespace do not slip past it, and the canonical id is untouched.
      for (const driver of ['Mongo', ' MONGO ']) {
        const parsed = DatasourceSchema.safeParse({ name: 'events', driver, config: { url: 'mongodb://db/x' } });
        expect(parsed.success, driver).toBe(false);
        expect(parsed.error!.issues.map((i) => i.path.join('.')), driver).toEqual(['driver']);
      }
      expect(DatasourceSchema.safeParse({ name: 'events', driver: 'mongodb', config: { url: 'mongodb://db/x' } }).success).toBe(true);
    });

    // The other half of the migration proof. A stored row the chain has not
    // reached (a raw body served by the read-path redactor, say) still resolves
    // the mongodb contract: deleting the spelling outright was measured to
    // serve every mongodb passthrough secret of such a row in cleartext.
    it('an UNCONVERTED stored `mongo` row keeps its contract — same schema, same validation', () => {
      expect(resolveDriverId('mongo')).toBe('mongodb');
      expect(getDriverConfigSchema('mongo')).toBe(getDriverConfigSchema('mongodb'));
      expect(validateDriverConfig('mongo', { url: 'mongodb://db/x' })).toEqual({ known: true, issues: [] });
    });
  });

  // #23543 F5-jsx retired `jsx` as a page kind at 18. Three claims hold
  // together: a STORED `jsx` page still converges to `html` and parses (the
  // data-at-rest seams replay the retired entry), the authoring funnel no
  // longer rewrites an authored `jsx`, and an authored `jsx` meets the
  // prescription naming `html` instead.
  describe('page-kind-jsx-to-html', () => {
    const page = (kind: string) => ({ name: 'landing', label: 'Landing', kind, source: '<div>hi</div>' });

    it('a stored `jsx` page row still converges to `html`, and the converted row parses', () => {
      const out = applyConversionsToStoredItem('page', page('jsx')) as { kind: string };
      expect(out.kind).toBe('html');
      expect(PageSchema.safeParse(out).success).toBe(true);
    });

    it('is retired from the load path — the authoring funnel no longer rewrites an authored `jsx`', () => {
      const before = { pages: [page('jsx')] };
      const { stack, notices } = collectConversionNotices(structuredClone(before));
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
    });

    it('an authored `jsx` reaches defineStack as written and is refused naming `html` and the release', () => {
      let refusal: unknown;
      try {
        defineStack({ pages: [page('jsx')] } as never);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
      const issues = (refusal as { issues: { path: PropertyKey[]; message: string }[] }).issues;
      // The kind is the ONE issue: the page is otherwise a complete html page.
      expect(issues.map((i) => i.path.join('.'))).toEqual(['pages.0.kind']);
      expect(issues[0]!.message).toMatch(/^Page `kind: 'jsx'` was removed in @objectstack\/spec 18 \(ADR-0087 D2\)/);
      expect(issues[0]!.message).toContain("Use `kind: 'html'`");
      // The canonical kind is untouched, and so is a misspelling's own message.
      expect(PageSchema.safeParse(page('html')).success).toBe(true);
      const typo = PageSchema.safeParse(page('htm'));
      expect(typo.success).toBe(false);
      expect(typo.error!.issues[0]!.message).not.toContain('was removed');
    });
  });

  // #4456 — the driver-factory `??` fallback graduation. The mappings are
  // driver-scoped by construction; these pin the two edges the flat fixture
  // pair cannot express as sharply: the same key converting under one driver
  // and not another, and the load-path posture.
  describe('datasource-config-driver-key-aliases', () => {
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

    it('still lands for a row whose driver id is ITSELF being renamed', () => {
      // The pairs are keyed by CANONICAL driver id, and commit e2798fab7 renamed mongo's.
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
  describe('dashboard-widget-compareto-converged', () => {
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
   * the page header. Its protocol-17 window has run: the entry is retired from
   * the load path at 18 (#23421), so the authoring funnel no longer rewrites
   * the key and an author meets `PageHeaderProps`' refusal naming the rename.
   * The rewrite cases below therefore run the data-at-rest posture
   * (`includeRetired`) — the replay stored rows, the artifact door and
   * `os migrate meta` still perform — and one case pins the authoring posture.
   */
  describe('page-header-subtitle-alias (the `subtitle ?? description` retirement)', () => {
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

      const { stack, notices } = collectConversionNotices(structuredClone(before), { includeRetired: true });

      // …and this is what the runtime sees: the second line survives under the
      // canonical key, and the dialect spelling is gone rather than shadowing it.
      expect(componentsOf(stack)[0]!.properties).toEqual({ title: 'Leads', subtitle: 'All open leads' });
      expect(componentsOf(stack)[0]!.properties).not.toHaveProperty('description');
      expect(notices).toHaveLength(1);
    });

    it('rewrites it on the CANONICAL `page:header` node too — where it is dropped on the floor today', () => {
      const { stack, notices } = collectConversionNotices(
        pageWith({ type: 'page:header', properties: { title: 'Lead', description: 'One lead' } }),
        { includeRetired: true },
      );
      expect(componentsOf(stack)[0]!.properties).toEqual({ title: 'Lead', subtitle: 'One lead' });
      expect(notices).toHaveLength(1);
    });

    it('does NOT rewrite the node TYPE — the kebab alias is objectui\'s to retire', () => {
      const { stack } = collectConversionNotices(
        pageWith({ type: 'page-header', properties: { title: 'Leads', description: 'All open leads' } }),
        { includeRetired: true },
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
      const { stack, notices } = collectConversionNotices(structuredClone(before), { includeRetired: true });
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
      const { stack, notices } = collectConversionNotices(structuredClone(before), { includeRetired: true });
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
    });

    it('emits a notice that names the surface, the site and the window it had', () => {
      const { notices } = collectConversionNotices(
        pageWith(
          { type: 'element:divider' },
          { type: 'page-header', properties: { title: 'Leads', description: 'All open leads' } },
        ),
        { includeRetired: true },
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
      const { stack, notices } = collectConversionNotices(structuredClone(before), { includeRetired: true });
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
    });

    it('copies on write — a page with no header passes through by reference', () => {
      const stack = pageWith({ type: 'record:details' });
      expect(applyConversions(stack, { includeRetired: true })).toBe(stack);
    });

    it('is retired from the load path at 18 — the authoring posture rewrites nothing, on either node type', () => {
      // Without `includeRetired` (the normalizeStackInput posture) the authored
      // `description` reaches the props gate as written, where the rename is
      // said to the author (the premise pin below) instead of absorbed.
      expect(ALL_CONVERSIONS.find((c) => c.id === 'page-header-subtitle-alias')).toMatchObject({
        toMajor: 17,
        retiredFromLoadPath: true,
        retiredAfter: '17.7.0',
      });
      for (const type of ['page:header', 'page-header']) {
        const before = pageWith({ type, properties: { title: 'Leads', description: 'All open leads' } });
        const { stack, notices } = collectConversionNotices(structuredClone(before));
        expect(stack).toEqual(before);
        expect(notices).toHaveLength(0);
      }
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
     * spelling.
     *
     * ⚠️ The SECOND half of this pin changed at #4001 batch A, and the change
     * is the point rather than an accommodation of it. It used to assert that
     * `PageHeaderProps` *silently strips* `description` — "which is precisely
     * why an authored `description` needed a conversion rather than an error".
     * That reading was upside down: the silent strip is what left the
     * conversion as the ONLY thing between an author and a dropped key, and
     * `conversions/walk.ts` records the consequence in as many words — a
     * `description` at a nested site got no diagnostic from any layer, because
     * the conversion did not fire there, `PageSchema` stayed green, and the
     * props gate is CLI-only.
     *
     * With the shape closed, a `description` that reaches this parse is
     * rejected BY NAME carrying the rename — and since the conversion retired
     * from the load path at 18 (#23421), every authored `description` reaches
     * it: this refusal is now the authoring answer at every door that judges
     * page props, while the conversion canonicalizes data at rest only. The
     * alias entry is what makes the refusal teach rather than merely refuse.
     */
    it('the canonical props schema declares `subtitle` and no `description`', () => {
      expect(PageHeaderProps.parse({ title: 'Leads', subtitle: 'All open leads' }).subtitle)
        .toBe('All open leads');

      const rejected = PageHeaderProps.safeParse({ title: 'Leads', description: 'All open leads' });
      expect(rejected.success).toBe(false);
      const message = rejected.error!.issues.map((i) => i.message).join('\n');
      expect(message).toContain('`description`');
      // The rename the conversion performs, said out loud to the author who is
      // typing the key right now.
      expect(message).toContain('subtitle');
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
   *
   * Retired from the load path at 18 (#23421): the rewrite cases run the
   * data-at-rest posture (`includeRetired`), and one case pins that the
   * authoring posture rewrites nothing, so the array-only field's refusal
   * naming `bodyExtra` is what an author meets.
   */
  describe('inline-action-api-params-to-body-extra', () => {
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
        { includeRetired: true, onNotice: (n) => notices.push(n) },
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
      const out = applyConversions(stack, { includeRetired: true });
      // Identity, not just equality: nothing converted, so copy-on-write shares.
      expect(out).toBe(stack);
    });

    it('leaves a type:"url" action alone — object `params` is the interpolation scope there', () => {
      // ActionRunner.interpolateTarget reads a non-array `params` as the
      // `${param.X}` scope, and executeUrl reads `params.newTab`. Rewriting
      // those into an api request body would be lossy, so the guard is not a
      // conservatism — it is the difference between lossless and not.
      const stack = button({ type: 'url', target: '/x?id=${param.id}', params: { id: 'abc' } });
      expect(applyConversions(stack, { includeRetired: true })).toBe(stack);
    });

    it('keeps BOTH when `bodyExtra` already says something different', () => {
      const stack = button({ type: 'api', target: '/x', params: { a: 1 }, bodyExtra: { b: 2 } });
      const out = applyConversions(stack, { includeRetired: true });
      expect(out).toBe(stack);
      expect(actionOf(out)).toEqual({ type: 'api', target: '/x', params: { a: 1 }, bodyExtra: { b: 2 } });
    });

    it('is idempotent — the converted result replays to itself with no second notice', () => {
      const once = applyConversions(button({ type: 'api', target: '/x', params: { a: 1 } }), { includeRetired: true });
      const notices: ConversionNotice[] = [];
      const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
      expect(twice).toBe(once);
      expect(notices).toEqual([]);
    });

    it('is retired from the load path at 18 — the authoring posture leaves the object form for the props gate', () => {
      expect(ALL_CONVERSIONS.find((c) => c.id === 'inline-action-api-params-to-body-extra')).toMatchObject({
        toMajor: 17,
        retiredFromLoadPath: true,
        retiredAfter: '17.7.0',
      });
      const before = button({ type: 'api', target: '/api/v1/forms/contact-us/submit', params: { name: '{{page.n}}' } });
      const { stack, notices } = collectConversionNotices(structuredClone(before));
      expect(stack).toEqual(before);
      expect(notices).toHaveLength(0);
      // …where the refusal names the rename the conversion used to perform.
      const refused = ElementButtonPropsSchema.safeParse({ label: 'Go', action: actionOf(stack) });
      expect(refused.success).toBe(false);
      expect(refused.error!.issues.map((i) => i.message).join('\n')).toContain('bodyExtra');
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
  describe('page-tabs-type-to-tab-style', () => {
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

    it('keeps BOTH when `tabStyle` already says something different', () => {
      const stack = regionPage({ tabStyle: 'pill', type: 'card', items: [] });
      const { out, notices } = convert(stack);
      expect(out).toBe(stack);
      expect(notices).toEqual([]);
    });

    it('drops the redundant twin when both spellings agree', () => {
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
  describe('app-hidden-to-unpublished', () => {
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

    it('a row that already carries `_unpublished` keeps BOTH keys, untouched', () => {
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

    // ---- the seam's own refusal (`excludeConversionIds`, #17885) ----

    /**
     * A seam that has opened the retired window may still refuse a named
     * entry. The artifact-ingestion door does exactly this for the DEFAULT-FLIP
     * class: its evidence is the artifact's DECLARED `engines.protocol` floor,
     * which is a dependency range and not an age, so "this input predates the
     * flip" is a guess there — while at the stored-row seam above it is a fact.
     * Pinned on the primitive so the option cannot quietly stop working while
     * the door's own suite still reads green for another reason.
     */
    it('a seam can refuse a named entry by id even with `includeRetired: true`', () => {
      const before = storedApp({ hidden: true, label: 'PM', navigation: [] });
      const notices: ConversionNotice[] = [];
      const out = applyConversions(before, {
        includeRetired: true,
        excludeConversionIds: ['app-hidden-to-unpublished'],
        onNotice: (n) => notices.push(n),
      });
      expect(out).toBe(before);
      expect(appOf(out)).toEqual({ name: 'production_management', hidden: true, label: 'PM', navigation: [] });
      expect(notices).toEqual([]);
    });

    /**
     * ⭐ FIRING CONTROL for the refusal above — it excludes ONE id, not the
     * window. `page-kind-jsx-to-html` (retired too, at 18) and the retired app
     * entry are driven through the SAME call: the named one is refused, the other
     * still fires.
     */
    it('refuses only the named id — the rest of the chain still runs', () => {
      const notices: ConversionNotice[] = [];
      const out = applyConversions(
        {
          apps: [{ name: 'production_management', hidden: true, navigation: [] }],
          pages: [{ name: 'landing', kind: 'jsx', source: '<div>hi</div>' }],
        },
        {
          includeRetired: true,
          excludeConversionIds: ['app-hidden-to-unpublished'],
          onNotice: (n) => notices.push(n),
        },
      );
      expect(appOf(out).hidden, 'the refused entry did not fire').toBe(true);
      expect(appOf(out)._unpublished).toBeUndefined();
      expect((out.pages as Record<string, unknown>[])[0]!.kind, 'the rest of the chain did').toBe('html');
      expect(notices.map((n) => n.conversionId)).toEqual(['page-kind-jsx-to-html']);
    });

    it('an absent or empty exclusion list changes nothing', () => {
      const shape = () => storedApp({ hidden: true, navigation: [] });
      const withEmpty = applyConversions(shape(), { includeRetired: true, excludeConversionIds: [] });
      const without = applyConversions(shape(), { includeRetired: true });
      expect(appOf(withEmpty)._unpublished).toBe(true);
      expect(appOf(without)._unpublished).toBe(true);
    });
  });

  /**
   * `field-reference-to-alias` (#13700 — ui#6837 half 1).
   *
   * The fixture pair pins before → after; what needs its own cover is the
   * SPLIT this entry lives on: the authoring surface keeps REJECTING
   * `reference_to` by name (the schema pin below), while the stored/migrate
   * paths — the only paths that meet data written around the Zod gate —
   * canonicalize it. Every conversion case here therefore runs
   * `includeRetired` (the stored posture); the one case without it pins that
   * the load seam does NOT quietly accept the dialect.
   */
  describe('field-reference-to-alias (the stored `reference_to` dialect canonicalizes)', () => {
    const stackWith = (fields: Record<string, unknown>) => ({
      objects: [{ name: 'crm_contact', label: 'Contact', fields }],
    });
    const fieldsOf = (stack: Record<string, unknown>) =>
      (stack.objects as Array<{ fields: Record<string, Record<string, unknown>> }>)[0]!.fields;
    const convert = (stack: Record<string, unknown>, notices?: ConversionNotice[]) =>
      applyConversions(stack, { includeRetired: true, onNotice: notices ? (n) => notices.push(n) : undefined });

    it('renames the dialect key on a lookup field (stored posture)', () => {
      const notices: ConversionNotice[] = [];
      const out = convert(
        stackWith({ company_id: { type: 'lookup', label: 'Company', reference_to: 'crm_company' } }),
        notices,
      );
      expect(fieldsOf(out).company_id).toEqual({ type: 'lookup', label: 'Company', reference: 'crm_company' });
      expect(fieldsOf(out).company_id).not.toHaveProperty('reference_to');
      expect(notices.filter((n) => n.conversionId === 'field-reference-to-alias')).toHaveLength(1);
    });

    it('emits a notice that names the surface, the site and the graduation', () => {
      const notices: ConversionNotice[] = [];
      convert(stackWith({ company_id: { type: 'lookup', reference_to: 'crm_company' } }), notices);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        conversionId: 'field-reference-to-alias',
        surface: 'field.reference_to',
        from: 'reference_to',
        to: 'reference',
        path: 'objects[0].fields.company_id.reference',
        toMajor: 18,
        retiresIn: 19,
      });
    });

    it('keeps a `reference_to` that DISAGREES with an existing `reference` (both survive)', () => {
      // The house precedence `renameKey` encodes since #4923: two different
      // targets are the author's to reconcile — no rewrite, no notice.
      const before = stackWith({
        parent_id: { type: 'lookup', reference: 'crm_account', reference_to: 'crm_branch' },
      });
      const notices: ConversionNotice[] = [];
      const out = convert(structuredClone(before), notices);
      expect(out).toEqual(before);
      expect(notices).toHaveLength(0);
    });

    it('is idempotent — the canonical shape is not a match', () => {
      const before = stackWith({ company_id: { type: 'lookup', reference: 'crm_company' } });
      const out = applyConversions(before, { includeRetired: true });
      expect(out).toBe(before);
    });

    it('does NOT run on the plain load posture — the authoring surface keeps its rejection', () => {
      // `retiredFromLoadPath`: without `includeRetired` (the
      // `normalizeStackInput` posture) the dialect is untouched here, so the
      // schema's named rejection stays the ONLY authoring-surface answer —
      // accepting it quietly at load would widen the authoring surface, which
      // is exactly what #11567/#13222 spent their refusal doors closing.
      const before = stackWith({ company_id: { type: 'lookup', reference_to: 'crm_company' } });
      const notices: ConversionNotice[] = [];
      const out = applyConversions(structuredClone(before), { onNotice: (n) => notices.push(n) });
      expect(out).toEqual(before);
      expect(notices).toHaveLength(0);
    });

    it('reaches a STORED object row, so data at rest canonicalizes on rehydration', () => {
      // `applyConversionsToStoredItem` wraps the row as `{ objects: [row] }`
      // (#3903) and pins `includeRetired` — the serve-face guarantee ui#6837
      // half 2 waits on lives on this seam.
      const notices: ConversionNotice[] = [];
      const row = {
        name: 'crm_contact',
        label: 'Contact',
        fields: { company_id: { type: 'lookup', label: 'Company', reference_to: 'crm_company' } },
      };
      const out = applyConversionsToStoredItem('object', row, { onNotice: (n) => notices.push(n) });
      expect(out.fields.company_id).toEqual({ type: 'lookup', label: 'Company', reference: 'crm_company' });
      expect(notices.map((n) => n.conversionId)).toEqual(['field-reference-to-alias']);
    });

    /**
     * The premise pin: this conversion is only correct while `FieldSchema`
     * declares exactly one relationship spelling and refuses the dialect BY
     * NAME. If the alias ever becomes a declared key, the entry above turns
     * from history-replay into a silent overwrite of live data — this is the
     * test that fails first.
     */
    it('the canonical field schema declares `reference` and rejects `reference_to` with the rename', async () => {
      const { FieldSchema } = await import('../data/field.zod.js');
      expect(
        FieldSchema.safeParse({ name: 'company_id', type: 'lookup', reference: 'crm_company' }).success,
      ).toBe(true);

      const rejected = FieldSchema.safeParse({ name: 'company_id', type: 'lookup', reference_to: 'crm_company' });
      expect(rejected.success).toBe(false);
      const issue = rejected.error!.issues.find((i) => i.code === 'unrecognized_keys');
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('`reference_to`');
      // The rename the conversion performs, said out loud to the author who is
      // typing the key right now.
      expect(issue!.message).toContain('`reference`');
    });
  });
});

/**
 * ⛔ The registry must carry NO conversion that turns `required: true` into a
 * column constraint (#16693, maintainer ruling, decision batch #85,
 * 2026-09-08, option A).
 *
 * ADR-0113 split the pre-17 tri-binding: `required` is the write-time contract
 * and NOT a column constraint, `storage.notNull` alone binds the column. A
 * conversion that adds `storage.notNull` wherever it finds `required: true`
 * asserts exactly the implication the ADR abolished — and it did not stay in
 * `os migrate meta` where its docblock claimed: the artifact-ingestion door
 * replays retired conversions (`includeRetired: true`), so every artifact
 * declaring a floor below the running spec got the stamp, plus a boot warning
 * telling its author to write the same tightening into the source. That
 * instruction is a `destructive` `tighten_not_null` migration on a populated
 * database, issued as the remedy for a deprecation notice.
 *
 * Written against the SEAM rather than the id, so re-adding the behaviour
 * under a different id fails here too.
 */
describe('no conversion invents a NOT NULL column (ADR-0113)', () => {
  const requiredOnly = () => ({
    objects: [{
      name: 'clm_party',
      label: 'Party',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        notes: { type: 'textarea', label: 'Notes' },
      },
    }],
  });

  it('leaves `required: true` alone in the load posture AND in the full replay', () => {
    for (const includeRetired of [false, true]) {
      const { stack, notices } = collectConversionNotices(requiredOnly(), { includeRetired });
      const fields = (stack as ReturnType<typeof requiredOnly>).objects[0]!.fields as
        Record<string, { required?: boolean; storage?: unknown }>;
      expect(fields.name!.required, `required survives (includeRetired=${includeRetired})`).toBe(true);
      expect(fields.name!.storage, `no NOT NULL invented (includeRetired=${includeRetired})`).toBeUndefined();
      expect(notices, `nothing to report (includeRetired=${includeRetired})`).toHaveLength(0);
    }
  });

  it('no registered conversion declares the storage.notNull surface at all', () => {
    const offenders = ALL_CONVERSIONS.filter((c) => c.surface.includes('storage.notNull'));
    expect(offenders.map((c) => c.id)).toEqual([]);
    // ⭐ ANTI-VACUITY: `surface` is a populated field on a populated registry,
    // so the empty list above is a verdict and not an empty scan.
    expect(ALL_CONVERSIONS.length).toBeGreaterThan(0);
    expect(ALL_CONVERSIONS.every((c) => c.surface.length > 0)).toBe(true);
  });

  it("`storage.notNull` is still the author's own way to bind the column", async () => {
    const { FieldSchema } = await import('../data/field.zod.js');
    const parsed = FieldSchema.safeParse({
      name: 'name', type: 'text', label: 'Name', required: true, storage: { notNull: true },
    });
    expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues.slice(0, 3))).toBe(true);
    expect(parsed.data!.storage).toEqual({ notNull: true });
  });
});
