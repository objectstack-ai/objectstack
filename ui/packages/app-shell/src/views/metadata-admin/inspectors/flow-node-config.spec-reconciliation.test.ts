// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Hand-written `FLOW_NODE_CONFIG` ↔ spec-published executor contracts**
 * (framework#4278).
 *
 * Five builtins deliberately publish no descriptor `configSchema` (framework
 * `config-schemas.test.ts`): the schema-driven online form cannot express
 * their editors — decision's virtual Target column, script's
 * actionType-conditional groups, the spec-structured sibling blocks. Their
 * Studio form is therefore this package's hand-written table, and until #4278
 * nothing reconciled that table against what the executors actually read.
 * `script` had drifted user-visibly: an `outputVariables` field nothing reads,
 * `sms` / `notification` options that fail every run, a no-op `code` default,
 * and no way to author the `function` / `inputs` / `outputVariable` path that
 * works.
 *
 * The machine-readable half now lives in `@objectstack/spec/automation`:
 * executor-derived config Zods for `script` / `subflow` / `decision`
 * (`schemaless-node-config.zod.ts`) plus the `FlowNodeSchema` sibling blocks
 * for `wait` / `connector_action` / `boundary_event`. This file is the
 * objectui half of the ledger — the same bidirectional key-set comparison
 * service-automation's `builtin-node-form-zod-ledger.test.ts` performs for the
 * descriptor-schema'd builtins, carried across the repo seam by the
 * `@objectstack/spec` dependency this package already has.
 *
 * The script/subflow/decision panels feature-detect their spec exports and
 * skip while the installed spec predates them (they arm themselves on the next
 * `@objectstack/spec` bump — see the version-alignment section of AGENTS.md);
 * the sibling-block panels run against every spec version this repo supports.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import * as Automation from '@objectstack/spec/automation';
// The Zod wrapper-key vocabulary — one list, read by the `.mjs` CI gates that
// walk the same internals (objectui#6923, ruled 2026-08-31).
import { ZOD_WRAPPER_KEYS } from '@object-ui/test-support';
import { fieldsForNodeType, FLOW_NODE_CONFIG_TYPES, type FlowConfigField } from './flow-node-config';

// Feature-detected exports — absent on a spec that predates framework#4278.
// (Truthiness alone never resolves a lazySchema proxy.)
const spec = Automation as Record<string, unknown>;
const ScriptConfigSchema = spec.ScriptConfigSchema;
const SubflowConfigSchema = spec.SubflowConfigSchema;
const DecisionConfigSchema = spec.DecisionConfigSchema;
const DecisionConditionSchema = spec.DecisionConditionSchema;
// Also the #4343 discriminator: the spec that converges `script` removes this
// constant along with the dispatch branches it described.
const SCRIPT_BUILTIN_ACTION_TYPES = spec.SCRIPT_BUILTIN_ACTION_TYPES as readonly string[] | undefined;

/**
 * Keys a Zod object schema accepts, read straight off `.shape`.
 *
 * `retiredKey()` tombstones are excluded: a retired key stays in the shape so
 * its rejection carries the upgrade prescription (spec `shared/retired-key.ts`
 * marks it with a `[REMOVED]` description), but it is NOT part of the
 * authorable contract — a form field writing one produces metadata the loader
 * rejects. Counting tombstones as contract keys would false-pass exactly that
 * drift (e.g. `waitEventConfig.timeoutMs` / `.onTimeout`, retired by
 * framework#4198 — this filter is what makes the `wait` panel fire on the spec
 * bump that carries their tombstones, until the form drops the two fields).
 *
 * That bump is a **17.0.0-rc refresh**, not the "spec 18" the tombstone text
 * itself names: changesets computes a pre-release train off the last
 * *published* major (`@objectstack/spec` latest is 16.1.0, `rc` is
 * 17.0.0-rc.0), so the retirement's `major` resolves to **17.0.0** — and
 * framework main carries the tombstones with `PROTOCOL_VERSION = '17.0.0'`.
 * The trigger is the next rc this repo installs, not a major that the current
 * release train cannot produce. Tracked in #3101.
 */
function zodKeys(schema: unknown): string[] {
  const shape = (schema as { shape?: Record<string, unknown> }).shape;
  expect(shape, 'expected a Zod object schema exposing .shape').toBeDefined();
  return Object.keys(shape ?? {})
    .filter((k) => {
      const description = (shape![k] as { description?: string } | undefined)?.description;
      return !(typeof description === 'string' && description.startsWith('[REMOVED]'));
    })
    .sort();
}

/** Unwrap `.optional()` / `.default()` wrappers down to the object schema. */
function unwrapped(schema: unknown): unknown {
  let cur = schema as { shape?: unknown; unwrap?: () => unknown } | undefined;
  for (let i = 0; cur && !cur.shape && typeof cur.unwrap === 'function' && i < 5; i++) {
    cur = cur.unwrap() as typeof cur;
  }
  return cur;
}

/**
 * The object shape behind a schema that may be wrapped in a pipe/effect.
 *
 * `unwrap()` above only walks `.optional()`/`.default()`; it cannot get past a
 * `ZodPipe` or a refinement wrapper, which expose neither `.shape` nor
 * `.unwrap`. `FlowNodeSchema` became one of those in @objectstack/spec
 * 17.0.0-rc.6, so the direct `FlowNodeSchema.shape` this file used to read went
 * `undefined` and every assertion below died on `Cannot read properties of
 * undefined`. The BLOCKS themselves are untouched — `connectorConfig`,
 * `waitEventConfig` and `boundaryConfig` are all still declared, verified by
 * walking the wrapper — so this is an access-path repair, not a changed
 * expectation.
 */
function objectShape(schema: unknown, depth = 0): Record<string, unknown> | null {
  const s = schema as Record<string, unknown> | undefined;
  if (!s || depth > 8) return null;
  if (s.shape) return s.shape as Record<string, unknown>;
  const def = (s._def ?? s.def) as Record<string, unknown> | undefined;
  if (!def) return null;
  if (def.shape) return def.shape as Record<string, unknown>;
  for (const key of ZOD_WRAPPER_KEYS) {
    const found = def[key] ? objectShape(def[key], depth + 1) : null;
    if (found) return found;
  }
  return null;
}

/** A field render-gated behind the never-matching `__legacy__` controller. */
function isLegacyGated(f: FlowConfigField): boolean {
  return f.showWhen?.field === '__legacy__';
}

/** Config keys the form OFFERS for new authoring (legacy render-only excluded). */
function offeredConfigKeys(type: string): string[] {
  return [...new Set(
    fieldsForNodeType(type)
      .filter((f) => f.path[0] === 'config' && !isLegacyGated(f))
      .map((f) => f.path[1]!),
  )].sort();
}

/**
 * Reconcile one node type's config-rooted form keys against its executor
 * contract. `renderOnly` names contract keys the form deliberately does NOT
 * offer for new authoring — each must still be present as a legacy-gated
 * field so stored metadata keeps rendering, and each needs its reason here.
 */
function reconcile(type: string, zod: unknown, renderOnly: Record<string, string> = {}) {
  const offered = offeredConfigKeys(type);
  const contract = zodKeys(zod);

  // Read by the executor, absent from the form ⇒ authorable only by hand —
  // the exact shape #4278 found for script's function/inputs/outputVariable.
  expect(
    contract.filter((k) => !offered.includes(k) && !(k in renderOnly)),
    `${type}: read by the executor but not offered by the designer form`,
  ).toEqual([]);

  // Offered by the form, never read by the executor ⇒ a Studio field that
  // does nothing — the #3528 / outputVariables shape.
  expect(
    offered.filter((k) => !contract.includes(k)),
    `${type}: offered by the designer form but never read by the executor`,
  ).toEqual([]);

  // Every render-only exemption must (a) be part of the executor contract and
  // (b) still render for stored metadata via a legacy-gated field.
  for (const key of Object.keys(renderOnly)) {
    expect(contract, `${type}: render-only exemption '${key}' must be a contract key`).toContain(key);
    const field = fieldsForNodeType(type).find((f) => f.path[0] === 'config' && f.path[1] === key);
    expect(field, `${type}: render-only key '${key}' must keep a (legacy-gated) field`).toBeDefined();
    expect(isLegacyGated(field!), `${type}: '${key}' must be legacy-gated, not offered`).toBe(true);
  }
}

/**
 * The `script` panel spans a spec bump, so it asserts what is true on EITHER
 * side of it (framework#4343).
 *
 * The form has converged to the one thing the node does — call a registered
 * function — and the five dispatch keys it used to offer are legacy render-only
 * here. On the spec that retires them those keys leave the contract too
 * (`zodKeys` drops `[REMOVED]` tombstones), so the full bidirectional ledger
 * applies. On the spec still installed today they are live contract keys the
 * form no longer offers, and only the "offers nothing the executor ignores"
 * direction is meaningful — asserting the other one would demand the form keep
 * authoring branches that never delivered anything.
 *
 * `SCRIPT_BUILTIN_ACTION_TYPES` is the discriminator: framework#4343 removes it
 * along with the branches it described, so this arms itself on the bump.
 */
const SPEC_PREDATES_SCRIPT_CONVERGENCE = SCRIPT_BUILTIN_ACTION_TYPES !== undefined;

describe.skipIf(!ScriptConfigSchema)('script form ↔ ScriptConfigSchema (framework#4278, #4343)', () => {
  it.skipIf(SPEC_PREDATES_SCRIPT_CONVERGENCE)('offers exactly the executor-read keys', () => {
    reconcile('script', ScriptConfigSchema);
  });

  it.skipIf(!SPEC_PREDATES_SCRIPT_CONVERGENCE)(
    'offers nothing the executor ignores (pre-#4343 spec: the retired branches are still contract keys)',
    () => {
      const contract = zodKeys(ScriptConfigSchema);
      expect(
        offeredConfigKeys('script').filter((k) => !contract.includes(k)),
        'script: offered by the designer form but never read by the executor',
      ).toEqual([]);
    },
  );

  it('offers the function path and nothing else', () => {
    // The whole authorable surface, on either spec. `timeoutMs` is node-level,
    // so `offeredConfigKeys` (config-rooted only) does not carry it.
    expect(offeredConfigKeys('script')).toEqual(['function', 'inputs', 'outputVariable']);
  });

  it('keeps every retired key rendering for stored nodes, without offering it', () => {
    // Stored metadata is never hidden — the same rule that kept the inline
    // `script` body visible after #3099 dropped it from new authoring.
    for (const key of ['actionType', 'template', 'recipients', 'variables', 'script']) {
      const field = fieldsForNodeType('script').find((f) => f.path[0] === 'config' && f.path[1] === key);
      expect(field, `script: retired key '${key}' must keep a field so stored values render`).toBeDefined();
      expect(isLegacyGated(field!), `script: '${key}' must be legacy-gated, not offered`).toBe(true);
      expect(field!.help, `script: '${key}' must name its replacement`).toMatch(/[Rr]etired in spec 17/);
    }
  });
});

describe.skipIf(!SubflowConfigSchema)('subflow form ↔ SubflowConfigSchema (framework#4278)', () => {
  it('offers exactly the executor-read keys', () => {
    reconcile('subflow', SubflowConfigSchema);
  });
});

describe.skipIf(!DecisionConfigSchema)('decision form ↔ DecisionConfigSchema (framework#4278)', () => {
  it('offers exactly the executor-read keys (legacy single `condition` stays render-only)', () => {
    // `condition` (singular) is legacy-gated in the form and deliberately NOT
    // in the contract: the decision executor never reads it — branching lives
    // in `conditions[]` or on edge conditions. Legacy-gated fields are already
    // excluded from `offered`, so plain reconciliation covers it.
    reconcile('decision', DecisionConfigSchema);
  });

  it('branch columns match DecisionConditionSchema one level down (Target is virtual)', () => {
    const conditions = fieldsForNodeType('decision').find((f) => f.id === 'conditions')!;
    const columnKeys = conditions.columns!.map((c) => c.key).sort();
    const contract = zodKeys(DecisionConditionSchema);
    // `target` is a VIRTUAL column — projected from / applied to the out-edges
    // by flow-decision-edges, never stored on the branch — so it is the one
    // legitimate column the stored-shape contract does not carry.
    expect(columnKeys.filter((k) => k !== 'target')).toEqual(contract);
    expect(columnKeys).toContain('target');
  });
});

describe('sibling-block forms ↔ FlowNodeSchema blocks (framework#4278 ratchet)', () => {
  // These blocks are published by every spec version this repo supports, so
  // no feature detection: the hand-written groups for wait / connector_action
  // / boundary_event must edit exactly the keys the spec block declares —
  // #4161 / #4210 verified them by hand once; this keeps them verified.
  const flowNodeShape = objectShape(spec.FlowNodeSchema);

  it('the spec still exposes the FlowNode block shape this suite reads', () => {
    // Guards the assertions below from passing vacuously if the walk stops
    // resolving — the failure mode rc.6 produced, seen one level up.
    expect(flowNodeShape, 'could not resolve FlowNodeSchema’s object shape').toBeTruthy();
    expect(Object.keys(flowNodeShape ?? {})).toEqual(
      expect.arrayContaining(['waitEventConfig', 'connectorConfig', 'boundaryConfig']),
    );
  });

  const BLOCKS: ReadonlyArray<{ type: string; block: string }> = [
    { type: 'wait', block: 'waitEventConfig' },
    { type: 'connector_action', block: 'connectorConfig' },
    { type: 'boundary_event', block: 'boundaryConfig' },
  ];

  it.each(BLOCKS)('$type: the $block fields match the spec block exactly', ({ type, block }) => {
    const formKeys = [...new Set(
      fieldsForNodeType(type)
        .filter((f) => f.path[0] === block)
        .map((f) => f.path[1]!),
    )].sort();
    const blockKeys = zodKeys(unwrapped(flowNodeShape?.[block]));

    expect(
      blockKeys.filter((k) => !formKeys.includes(k)),
      `${type}: declared by the spec block but absent from the designer form`,
    ).toEqual([]);
    expect(
      formKeys.filter((k) => !blockKeys.includes(k)),
      `${type}: edited by the designer form but not declared by the spec block`,
    ).toEqual([]);
  });
});

/**
 * **Declared defaults ↔ spec defaults — EVERY declaring field** (#6794, #6620,
 * objectui#9109).
 *
 * Everything above is a KEY-set ledger: it proves the form edits exactly the
 * keys the executor reads. The default a field DECLARES is the other axis, and
 * it has drifted here twice — first `escalation.notifySubmitter`, which declared
 * no `defaultValue` at all while the spec defaults the key to `true` (#6794),
 * then `escalation.enabled`, which declared `'false'` against a spec that had
 * flipped to `.default(true)` (#6620). Not cosmetic: `defaultValue` is what
 * `controllerAdmits` resolves an unset controller against, what a `boolean`
 * control seeds from, and (since objectui#6830 arm A) what a `select` control
 * states as its placeholder — and it is what the ONLINE half of this form
 * already carries (a published `configSchema` sends `default: true`, which
 * `json-schema-to-fields` turns into `defaultValue: 'true'`), so offline and
 * online rendered the same node from two different claims about the spec.
 *
 * ⭐ **Why this is now table-wide, and why that is objectui#9109.** The previous
 * revision walked `field.path[1] === 'escalation'` ALONE, and said so: the
 * scoping was deliberate while objectui#6620 was on hold. objectui#6620 closed
 * on 2026-09-08 and the reason is spent — but the cost of that scoping had
 * already been paid, because FOUR declarations outside the escalation block
 * were claiming a default the installed spec applies none of, and nothing
 * reddened. A ledger that stops one block short is the same defect as no
 * ledger, one block later. This walks every node type in `FLOW_NODE_CONFIG`
 * against its OWN spec schema, so a declaration cannot sit outside it.
 *
 * The expected values are READ FROM THE INSTALLED SPEC, never spelled out here:
 * objectui is the consumer, and a literal restates exactly the claim that
 * drifts — it would pass just as happily on the next upstream flip.
 *
 * ⛔ **What this file does NOT decide.** Both registers below record live
 * divergences rather than asserting them away, and neither register is a
 * waiver: every entry re-measures the spec state it claims, and the register
 * sets must match the measured divergence sets EXACTLY, so an entry cannot
 * outlive the divergence and a new divergence cannot hide behind one. Which END
 * of each divergence to move — delete the declaration, or back it upstream — is
 * a product call this repo cannot make alone (objectui#9109 triage fence 2), and
 * a test is the wrong place to make it.
 */
describe('declared defaults ↔ per-node-type spec schemas (#6794, #6620, objectui#9109)', () => {
  // ⛔ The subpath is load bearing. `ApprovalEscalationSchema` is NOT on the
  // package root: `require('@objectstack/spec').ApprovalEscalationSchema` is
  // `undefined`, so a probe written that way dies with `Cannot read properties
  // of undefined` — a failure that reads as "the spec does not have it yet" and
  // sends the reader back to waiting. #6620 sat on hold behind exactly that
  // misreading. This file's own `import * as Automation` is the working spelling.
  const flowNodeShape = objectShape(spec.FlowNodeSchema);

  /**
   * The node-type universe, read from the TABLE'S OWN SOURCE rather than from a
   * hand-kept list.
   *
   * `FLOW_NODE_CONFIG` is module-private and `fieldsForNodeType` answers `[]`
   * for a type it has never heard of, so a type added to the table but missing
   * from a hand-kept list contributes zero fields and the ledger reports a
   * confident nothing — which is precisely how the four declarations this card
   * is about stayed invisible. Enumerating from the source makes the TOTAL come
   * from the same place the readings come from (AGENTS.md: "当一次扫描的「总体」
   * 和「逐项读取」来自不同来源时,对照必须取自总体那一侧").
   *
   * Rooted at `import.meta.url`, never `process.cwd()` — the cwd differs between
   * the repo-root and package-level invocations (objectui#7791/#7799).
   */
  function nodeTypesFromSource(): string[] {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'flow-node-config.ts'), 'utf8');
    const open = src.indexOf('const FLOW_NODE_CONFIG: Record<string, FlowConfigField[]> = {');
    expect(open, 'FLOW_NODE_CONFIG must still be declared with this signature').toBeGreaterThan(-1);
    const close = src.indexOf('\n};', open);
    expect(close, 'FLOW_NODE_CONFIG must still close at column 0').toBeGreaterThan(open);
    return [...src.slice(open, close).matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]!);
  }

  const NODE_TYPES = nodeTypesFromSource();

  it('the node-type enumeration is live, not an empty regex', () => {
    // The positive control for the scan above. A regex that stopped matching
    // returns `[]`, and every walk below would then pass over nothing — the
    // vacuous-green shape this whole file exists to prevent. Aliases need no
    // sweep of their own: `fieldsForNodeType` resolves every alias to one of
    // these canonical tables, so walking the table keys walks every field.
    expect(NODE_TYPES.length, 'FLOW_NODE_CONFIG declares node types').toBeGreaterThan(20);
    expect(
      [...NODE_TYPES].sort(),
      'and they are exactly the table types the module exports (objectui#11778)',
    ).toEqual([...FLOW_NODE_CONFIG_TYPES].sort());
    expect(NODE_TYPES, 'including the off-picker tables a picker-only sweep would miss').toEqual(
      expect.arrayContaining(['boundary_event', 'notify', 'legacy_action', 'join_gateway']),
    );
  });

  /**
   * One reconcilable region of the form: the fields under `prefix`, and the
   * spec schema that decides what an omitted key there actually does.
   *
   * `supplied` names the region's REQUIRED keys. They are sent as input so the
   * parse can succeed, then subtracted from the materialised result — counting
   * them would demand the form declare a default for a key that has none.
   */
  interface DefaultScope {
    readonly type: string;
    readonly prefix: readonly string[];
    readonly schema: () => unknown;
    readonly supplied: Record<string, unknown>;
  }

  const SCOPES: readonly DefaultScope[] = [
    {
      type: 'approval',
      prefix: ['config'],
      schema: () => spec.ApprovalNodeConfigSchema,
      supplied: { approvers: [{ type: 'user', value: 'u1' }] },
    },
    {
      type: 'approval',
      prefix: ['config', 'escalation'],
      schema: () => spec.ApprovalEscalationSchema,
      supplied: { timeoutHours: 24 },
    },
    {
      type: 'http',
      prefix: ['config'],
      schema: () => spec.HttpConfigSchema,
      supplied: { url: 'https://example.invalid/x' },
    },
    { type: 'screen', prefix: ['config'], schema: () => spec.ScreenConfigSchema, supplied: {} },
    {
      type: 'wait',
      prefix: ['waitEventConfig'],
      schema: () => unwrapped(flowNodeShape?.waitEventConfig),
      // `timerDuration` joined the minimal region at `@objectstack/spec` 17.5.0,
      // which REFUSES a timer wait with no duration (it would park the run
      // forever while reporting success). `'PT1H'` is the value the designer now
      // seeds (objectui#11088 decision 2 = A; objectui#11073).
      supplied: { eventType: 'timer', timerDuration: 'PT1H' },
    },
    {
      type: 'boundary_event',
      prefix: ['boundaryConfig'],
      schema: () => unwrapped(flowNodeShape?.boundaryConfig),
      supplied: { attachedToNodeId: 'n1', eventType: 'error' },
    },
    // objectui#9337 turned `end.config.outcome` into a spec-derived select that
    // DECLARES `'completed'`, which made it a declaring field — and a declaring
    // field sitting outside every scope is precisely what the ratchet above
    // refuses. `EndConfigSchema` is the schema that governs the region, so the
    // ledger can now check the declaration instead of stepping around it.
    { type: 'end', prefix: ['config'], schema: () => spec.EndConfigSchema, supplied: {} },
  ];

  const scopeId = (type: string, prefix: readonly string[]) => `${type}:${prefix.join('.')}`;

  /** Every field in the table that DECLARES a default, with the scope it sits in. */
  function declaringFields(): Array<{ scope: string; key: string; field: FlowConfigField }> {
    const out: Array<{ scope: string; key: string; field: FlowConfigField }> = [];
    for (const type of NODE_TYPES) {
      for (const field of fieldsForNodeType(type)) {
        if (field.defaultValue === undefined) continue;
        out.push({
          scope: scopeId(type, field.path.slice(0, -1)),
          key: field.path[field.path.length - 1]!,
          field,
        });
      }
    }
    return out;
  }

  /** The form fields inside one scope, keyed by the spec key each edits. */
  function fieldsInScope(scope: DefaultScope): Map<string, FlowConfigField> {
    const out = new Map<string, FlowConfigField>();
    for (const f of fieldsForNodeType(scope.type)) {
      if (f.path.length !== scope.prefix.length + 1) continue;
      if (!scope.prefix.every((seg, i) => f.path[i] === seg)) continue;
      out.set(f.path[f.path.length - 1]!, f);
    }
    return out;
  }

  /**
   * Every key the spec MATERIALISES from an omitted-key region, with its value —
   * the runtime's own answer to "what does this node actually do", read fresh.
   */
  function specDefaults(scope: DefaultScope): Record<string, unknown> {
    const schema = scope.schema() as
      | { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown> } }
      | undefined;
    expect(
      schema?.safeParse,
      `@objectstack/spec/automation must expose a parseable schema for ${scopeId(scope.type, scope.prefix)}`,
    ).toBeTypeOf('function');
    const parsed = schema!.safeParse({ ...scope.supplied });
    expect(parsed.success, `a minimal ${scopeId(scope.type, scope.prefix)} region must parse`).toBe(true);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data ?? {})) if (!(k in scope.supplied)) out[k] = v;
    return out;
  }

  /**
   * ⛔ **The two registers — live divergences, recorded, not waived.**
   *
   * ⭐ The four unbacked declarations are NOT one class, and a register that
   * recorded them as one would be wrong about half of them (objectui#9109
   * measurement comment, 2026-09-11). Each entry therefore carries the spec
   * state it claims, and `state` is RE-MEASURED below — an entry whose claim
   * stops being true reddens as loudly as an unregistered divergence.
   *
   * - `required-no-default` — the spec key is REQUIRED. There is no runtime
   *   default to state: an omitted key does not behave as the declared value,
   *   it FAILS TO PARSE. "Unset behaves as X" is not merely unbacked here, it
   *   is the wrong SHAPE of statement, and both of these already have on-screen
   *   effect — each gates siblings through `controllerAdmits` on a node that
   *   stored no value at all.
   * - `optional-no-default` — the spec key is OPTIONAL and the installed Zod
   *   materialises nothing for it. ⚠️ That is a statement about SCHEMA
   *   DEFAULTING and nothing else: the flow EXECUTOR lives in `objectstack`,
   *   `@objectstack/spec` is only the parse contract, so whether the engine
   *   applies `GET` / create-mode when it runs the node is **NOT MEASURED**
   *   here — ⛔ not "measured false". If it does, the fix is upstream and this
   *   register entry is how the two ends stay connected.
   *
   * ⭐ **The register is EMPTY, and that is objectui#9109's resolution.** The
   * four rows it opened with — `wait:waitEventConfig.eventType`,
   * `boundary_event:boundaryConfig.eventType`, `http_request:config.method` (the group is keyed `http` since
   * objectui#12742) and
   * `screen:config.mode` — were repaid by DELETING the declarations, which is
   * triage's ruling on that card and not this file's opinion: the
   * `defaultValue` doc comment defines the property AS the spec default for its
   * key, so a declaration the installed spec applies none of is false by that
   * definition, and deleting it restores the invariant. ⛔ The other end —
   * adding four `.default()`s to a published contract — was refused there as a
   * maintainer-floor product call, so ⛔ do not "repay" a future row that way
   * from this repo.
   *
   * ⚠️ Both `state` kinds stay documented above because the register stays
   * ARMED, not because a row exists: the next unbacked declaration is recorded
   * here with its measured state rather than asserted away.
   */
  const UNBACKED_REGISTER: ReadonlyArray<{
    region: string;
    key: string;
    state: 'required-no-default' | 'optional-no-default';
  }> = [];

  /**
   * The other direction's register: the spec APPLIES a default and the form
   * field for that key declares none — the #6794 shape exactly, found by this
   * widening in places the escalation-only walk could never reach.
   *
   * ⭐ A row here is an EXCEPTION, and an exception is meant to be repaid.
   * The two this register opened with — `approval:config.lockRecord` and
   * `boundary_event:boundaryConfig.interrupting` — were repaid at the form by
   * objectui#9339, which declared both from the installed spec. They are
   * therefore RETIRED, not carried: a row that outlives its divergence asserts
   * something false about the contract, which is worse than no row at all.
   *
   * ⛔ Read what this register holds from the declaration below, never from a
   * count restated in prose (AGENTS.md #9) — and never from the SHAPE of the
   * test that walks it. That test iterates `SCOPES`, not this array, exactly so
   * that an empty register still states its claim region by region instead of
   * contributing no case and reporting green.
   */
  const UNDECLARED_REGISTER: ReadonlyArray<{ region: string; key: string }> = [];

  // ⚠️ `region`, not `scope`: vitest reads `$a.$b` in an `it.each` title as the
  // PATH `a.$b`, so a dotted pair of placeholders renders `undefined` and every
  // register row gets the same nameless title. The separator below keeps both
  // halves addressable.
  const rowId = (r: { region: string; key: string }) => `${r.region}.${r.key}`;

  it('the gate `enabled` is inside the ledger — and the ledger is not empty', () => {
    // THE VACUITY GUARD, and the reason it names a key. Every walk below
    // iterates materialised defaults; a spec that stopped materialising
    // anything would make each of them pass over an empty collection, which is
    // the shape #6620's old tripwire failed in. This row fails instead — and it
    // names `enabled` because that is the key that card was about, so the
    // ledger's coverage of it is visible in a test name rather than only
    // inferable from a loop.
    const escalation = SCOPES.find((s) => scopeId(s.type, s.prefix) === 'approval:config.escalation')!;
    const defaults = specDefaults(escalation);
    expect(Object.keys(defaults).length, 'the spec materialises at least one default here').toBeGreaterThan(0);
    expect(typeof defaults.enabled, 'the spec materialises `enabled` from an omitted key').toBe('boolean');

    const everything = SCOPES.flatMap((s) => Object.keys(specDefaults(s)));
    expect(everything.length, 'and the table-wide walk materialises defaults in more than one scope').toBeGreaterThan(
      Object.keys(defaults).length,
    );
  });

  it('every declaring field in the whole table sits inside a scope', () => {
    // ⭐ THE RATCHET, and the whole point of objectui#9109. The old walk was
    // `field.path[1] === 'escalation'`, so four declarations sat outside it and
    // nothing reddened. A declaration added anywhere the `SCOPES` table does not
    // cover now fails HERE, naming itself — it can no longer go unchecked by
    // being somewhere nobody looked.
    const uncovered = declaringFields()
      .filter((d) => !SCOPES.some((s) => scopeId(s.type, s.prefix) === d.scope))
      .map((d) => `${d.scope}.${d.key} declares ${JSON.stringify(d.field.defaultValue)} with no spec scope to check it against`);
    expect(uncovered, 'add a DefaultScope for this region, with the spec schema that governs it').toEqual([]);
    // …and the scopes are not all empty, which is the way the line above lies.
    expect(declaringFields().length, 'the table still declares defaults at all').toBeGreaterThan(5);
  });

  it('every default the spec applies is declared by the form, with the same value, beyond its register rows', () => {
    const mismatches: string[] = [];
    const noField: string[] = [];
    const undeclared: string[] = [];
    for (const scope of SCOPES) {
      const id = scopeId(scope.type, scope.prefix);
      const fields = fieldsInScope(scope);
      for (const [key, value] of Object.entries(specDefaults(scope))) {
        const field = fields.get(key);
        if (!field) {
          noField.push(`${id}.${key}: the spec defaults it, the form offers no field for it`);
        } else if (field.defaultValue === undefined) {
          undeclared.push(`${id}.${key}`);
        } else if (field.defaultValue !== String(value)) {
          // Defaults are strings in this table — booleans spelled 'true' /
          // 'false', the spelling `controllerAdmits` compares a controller
          // against.
          mismatches.push(
            `${id}.${key}: the form declares ${JSON.stringify(field.defaultValue)}, the spec applies ${JSON.stringify(String(value))}`,
          );
        }
      }
    }
    expect(
      mismatches,
      'the hand-written table must state what an omitted key actually does at runtime',
    ).toEqual([]);
    expect(
      noField,
      'a spec default with no field at all is a key-set hole, never a registerable divergence',
    ).toEqual([]);
    expect(
      undeclared.sort(),
      'the spec applies a default the form states nowhere — register it or declare it',
    ).toEqual(UNDECLARED_REGISTER.map(rowId).sort());
  });

  it('and the form declares no default the spec does not apply, beyond its register rows', () => {
    // The other direction, and not symmetric decoration: a `defaultValue` with
    // no spec counterpart is a claim about the contract with nothing behind it,
    // and it is ACTED ON — it resolves a `showWhen` controller, seeds a boolean
    // control, and states itself as a select trigger's placeholder, off a value
    // the runtime never applies.
    const byScope = new Map(SCOPES.map((s) => [scopeId(s.type, s.prefix), specDefaults(s)]));
    const invented = declaringFields()
      .filter((d) => byScope.has(d.scope) && !(d.key in byScope.get(d.scope)!))
      .map((d) => rowId({ region: d.scope, key: d.key }));
    expect(
      invented.sort(),
      'a declared default with no spec counterpart — register it or remove it',
    ).toEqual(UNBACKED_REGISTER.map(rowId).sort());
  });

  /**
   * Re-measure ONE key's claimed spec state — the assertion a register row
   * makes, and the one objectui#9109's deletion pin makes about a key the form
   * now declares nothing for. Shared so the two callers cannot drift into
   * measuring "unbacked" two different ways.
   */
  function measureState(
    scope: DefaultScope,
    key: string,
    state: 'required-no-default' | 'optional-no-default',
    who: string,
  ): void {
    const withoutKey = Object.fromEntries(
      Object.entries(scope.supplied).filter(([k]) => k !== key),
    );
    const schema = scope.schema() as {
      safeParse: (v: unknown) => {
        success: boolean;
        data?: Record<string, unknown>;
        error?: { issues: Array<{ path: PropertyKey[] }> };
      };
    };
    const parsed = schema.safeParse(withoutKey);

    if (state === 'required-no-default') {
      // The sharper of the two, and it needs no executor: an omitted key does
      // not behave as the declared value, it is REFUSED at the door.
      expect(parsed.success, `${who}: a REQUIRED key must refuse an omitted value`).toBe(false);
      expect(
        parsed.error?.issues.map((i) => i.path.join('.')),
        `${who}: and the refusal must name this key`,
      ).toContain(key);
    } else {
      // Optional, and the installed Zod materialises nothing. ⚠️ Evidence
      // about SCHEMA DEFAULTING only — the executor is in `objectstack` and
      // is NOT MEASURED by this repo.
      expect(parsed.success, `${who}: an OPTIONAL key must parse when omitted`).toBe(true);
      expect(
        parsed.data && key in parsed.data,
        `${who}: and the spec must materialise nothing for it`,
      ).toBe(false);
    }
  }

  // ⛔ THE UNBACKED REGISTER'S RE-MEASUREMENT, and it walks `SCOPES` rather
  // than `UNBACKED_REGISTER` for exactly the reason spelled out on the other
  // register below. Written as `it.each(UNBACKED_REGISTER)` it contributed one
  // case per ROW — so the empty register objectui#9109 left behind would
  // contribute NO case, run nothing, and still report green, leaving a reader
  // to see a re-measured register where nothing whatever was measured. The
  // scope table is this file's fixed population (the vacuity guard above
  // reddens if it stops materialising defaults), so every region answers for
  // itself: a region carrying no row answers with the positive statement —
  // nothing here is unbacked — and a region carrying one re-measures the spec
  // state that row CLAIMS. A row is an ASSERTION, never a waiver: one whose key
  // has since gained a `.default()` reddens here instead of outliving its
  // divergence.
  it.each(SCOPES.map((s) => ({ scope: s, region: scopeId(s.type, s.prefix) })))(
    'region $region declares nothing the spec leaves unbacked, beyond its register rows',
    ({ scope, region }) => {
      const defaults = specDefaults(scope);
      const rows = UNBACKED_REGISTER.filter((r) => r.region === region);

      const unbacked = [...fieldsInScope(scope).entries()]
        .filter(([key, field]) => field.defaultValue !== undefined && !(key in defaults))
        .map(([key]) => key)
        .sort();
      expect(
        unbacked,
        `${region}: a declared default with no spec counterpart — register it with its measured state, or remove the declaration`,
      ).toEqual(rows.map((r) => r.key).sort());

      for (const row of rows) measureState(scope, row.key, row.state, `${region}.${row.key}`);
    },
  );

  /**
   * ⭐ **objectui#9109's deletion, pinned from the spec side.**
   *
   * The four declarations this card removed, each named with the spec state
   * that made removal the right end to move. Three remain rows: the spec side
   * of the fourth, `screen:config.mode`, moved at 17.5.0 and the declaration
   * came back as the first bullet below prescribes (objectui#11073). This is the register's
   * re-measurement applied to keys that now carry NO row, and it is what keeps
   * the two ends connected after the register emptied:
   *
   *  - if the installed spec ever starts materialising one of these keys, the
   *    `state` row below reddens AND the table-wide "every default the spec
   *    applies is declared by the form" assertion reddens — the form should
   *    then DECLARE it again, derived from the spec;
   *  - if someone re-adds a `defaultValue` here by hand, the `declares nothing`
   *    row reddens, naming the key.
   *
   * ⚠️ `was` is HISTORY — the string the table used to carry — and nothing
   * re-derives it; it is here so a failure message can say what was removed,
   * ⛔ never as a claim about the spec. The live claims are `state` and
   * `defaultValue === undefined`, both measured on every run.
   *
   * ⛔ The field itself must still EXIST and still be a `select`: this card
   * deleted a DECLARATION, not an editor. A form that dropped the control would
   * satisfy "declares no default" while removing the author's only way to set a
   * key the spec REQUIRES.
   */
  const DELETED_BY_9109: ReadonlyArray<{
    region: string;
    key: string;
    was: string;
    state: 'required-no-default' | 'optional-no-default';
  }> = [
    { region: 'wait:waitEventConfig', key: 'eventType', was: 'timer', state: 'required-no-default' },
    { region: 'boundary_event:boundaryConfig', key: 'eventType', was: 'error', state: 'required-no-default' },
    { region: 'http:config', key: 'method', was: 'GET', state: 'optional-no-default' },
    // `screen:config.mode` was the fourth row. It left at `@objectstack/spec`
    // 17.5.0, exactly the way this block says a row leaves: the spec began
    // materialising `'create'` for an omitted key, so the form declares it
    // again — pinned from the spec side in the next case (objectui#11073).
  ];

  it.each(DELETED_BY_9109)(
    'objectui#9109: $region · $key declares no default, and the spec still measures as $state',
    ({ region, key, was, state }) => {
      const scope = SCOPES.find((s) => scopeId(s.type, s.prefix) === region)!;
      const field = fieldsInScope(scope).get(key);

      expect(field, `${region}.${key}: the editor must still exist — #9109 deleted a declaration, not a control`).toBeDefined();
      expect(field!.kind, `${region}.${key}: and it is still the select the author picks the value on`).toBe('select');
      expect(
        field!.defaultValue,
        `${region}.${key}: must declare NO default — it used to claim ${JSON.stringify(was)}, which the installed spec applies none of`,
      ).toBeUndefined();

      measureState(scope, key, state, `${region}.${key}`);
    },
  );

  it('objectui#11073: screen:config · mode — the spec materialises its default since 17.5.0, and the form declares the same value again', () => {
    const scope = SCOPES.find((s) => scopeId(s.type, s.prefix) === 'screen:config')!;
    const field = fieldsInScope(scope).get('mode');
    const materialised = specDefaults(scope).mode;
    // The spec side, measured: an omitted `mode` now parses to a value.
    expect(materialised, 'ScreenConfigSchema must materialise a mode for an omitted key').toBeTypeOf('string');
    // The form side: the same select, now DECLARING that value — the end
    // objectui#9109's pin named for the day the spec started applying one.
    expect(field, 'screen:config.mode: the editor still exists').toBeDefined();
    expect(field!.kind).toBe('select');
    expect(field!.defaultValue, 'screen:config.mode declares the default the spec applies').toBe(materialised);
    expect(
      (field!.options ?? []).map((o) => o.value),
      'and the declared default is one of the offered options',
    ).toContain(materialised);
  });

  // ⛔ THE REGISTER'S RE-MEASUREMENT, and it walks `SCOPES` rather than
  // `UNDECLARED_REGISTER` on purpose. Written as `it.each(UNDECLARED_REGISTER)`
  // it contributed one case per row — so a register that empties contributes NO
  // case, runs nothing, and still reports green, leaving a reader to see a
  // re-measured register where nothing whatever was measured. The scope table is
  // this file's fixed population (the vacuity guard above reddens if it stops
  // materialising defaults), so every region answers for itself, and a region
  // carrying no row answers with the positive statement: nothing here is left
  // undeclared. A row is still an ASSERTION, never a waiver — one whose key has
  // since been declared drops out of its region's walk and reddens here.
  // (A row naming a region outside `SCOPES` would be unreachable from this walk;
  // the table-wide equality above compares the register whole and fails on it.)
  it.each(SCOPES.map((s) => ({ scope: s, region: scopeId(s.type, s.prefix) })))(
    'region $region leaves no spec default undeclared beyond its register rows',
    ({ scope, region }) => {
      const fields = fieldsInScope(scope);
      const undeclared = Object.keys(specDefaults(scope))
        .filter((key) => {
          // A key the form offers no field for at all is a key-set hole,
          // asserted on its own above; this register is only ever about a key
          // the form OFFERS and then declares nothing for.
          const field = fields.get(key);
          return field !== undefined && field.defaultValue === undefined;
        })
        .sort();
      expect(
        undeclared,
        `${region}: declare it on the form field, or carry it as a register row with the reason`,
      ).toEqual(
        UNDECLARED_REGISTER.filter((r) => r.region === region)
          .map((r) => r.key)
          .sort(),
      );
    },
  );
});
