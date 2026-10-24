// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25609] An approval step's `excludeSubmitter` option, default off — the
 * protocol half of #25573 (ruling 6377731715 on #25496, letter B for #25446).
 * ADR-0019 made each approval STEP an approval NODE, so the step-level option
 * is a key on `ApprovalNodeConfigSchema`.
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE KEY PARSES on the node config, `true` and `false`, the whole config
 *   green beside a `field` and a `position` approver (the two types the ruling
 *   names; the key is one switch for the whole slate, never per type). Omitted,
 *   it stays ABSENT after the parse — no `false` materializes — so a node that
 *   does not author it parses to the output it parsed to before the key
 *   existed. A non-boolean is refused at the key's own path.
 * - §2 THE DOOR AUTHORS MEET: `FlowSchema` judges an approval node's `config`
 *   against this contract whole, so the key is accepted inside a flow too —
 *   the parse `os validate`, `compile` and the metadata save door run.
 * - §3 STEP-LEVEL ONLY: the same key written anywhere but the node config — on
 *   an approver row, on the flow node beside `config`, on the flow — is still
 *   refused, each at its own path. These are the controls that prove the
 *   widening opened one coordinate and nothing else.
 * - §4 THE DESIGNER'S SCHEMA: the published JSON schema carries the key as a
 *   plain optional boolean with no `default`, under the same
 *   `additionalProperties: false`.
 * - §5 THE STATUS: the describe opens with the `[PLANNED` marker (the runtime
 *   half has not landed, so the key is declared and not yet read) and names
 *   the subjects an author needs — `submitter_id` (who is removed),
 *   `onEmptyApprovers` (where an emptied slate goes) and `'auto_approve'` (the
 *   one policy refused beside it, §6). The prose itself is not pinned.
 * - §6 THE REFUSED PAIR (#25635, ruling 6386627950, letter A):
 *   `excludeSubmitter: true` beside `onEmptyApprovers: 'auto_approve'` is
 *   refused at the parse, ONE issue at `onEmptyApprovers` — the key the ruled
 *   prescription edits — naming both keys and the three policies it offers.
 *   Controls: every other policy beside `true`, and `auto_approve` beside a
 *   `false` or omitted key, parse green. The refusal reaches the flow door
 *   (the issue at the node config's own key, and the build judge's
 *   `node-config-refused-by-contract`), and it is independent of the
 *   `fallbackApprovers` pairing: a config that trips both carries both, and the
 *   one edit to `'fallback'` clears both.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  ApprovalNodeApproverSchema,
  ApprovalNodeConfigSchema,
  getApprovalNodeConfigJsonSchema,
} from './approval.zod';
import { flowNodeConfigRefusals } from './flow-node-config-refusals';
import { FlowSchema } from './flow.zod';

type Door = { safeParse: (v: unknown) => z.ZodSafeParseResult<unknown> };

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(door: Door, value: unknown): { code: string; path: string }[] {
  const result = door.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

/** A category manager on the record, then a procurement director — the card's two-level shape. */
const SLATE = [
  { type: 'field', value: 'category_manager_id' },
  { type: 'position', value: 'procurement_director' },
];
const BASE = { approvers: SLATE };

/** start → the approval node → approve / reject ends; `node` and `top` spread where a key is planted. */
function flowWith(node: Record<string, unknown>, top: Record<string, unknown> = {}) {
  return {
    name: 'supplier_admission',
    label: 'Supplier admission',
    type: 'autolaunched',
    ...top,
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'gate', type: 'approval', label: 'Category manager', ...node },
      { id: 'approved', type: 'end', label: 'Approved' },
      { id: 'rejected', type: 'end', label: 'Rejected' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'approved', label: 'approve' },
      { id: 'e3', source: 'gate', target: 'rejected', label: 'reject' },
    ],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// §1 the key parses on the node config
// ───────────────────────────────────────────────────────────────────────────

describe('§1 excludeSubmitter parses on the approval node config, absent when off', () => {
  it.each([true, false])('excludeSubmitter: %s parses, whole config green, and is carried through', (value) => {
    const result = ApprovalNodeConfigSchema.safeParse({ ...BASE, excludeSubmitter: value });
    expect(issues(ApprovalNodeConfigSchema, { ...BASE, excludeSubmitter: value })).toEqual([]);
    expect(result.success && result.data.excludeSubmitter).toBe(value);
  });

  it('parses beside the empty-slate fallback it hands an emptied slate to', () => {
    const config = {
      ...BASE,
      excludeSubmitter: true,
      onEmptyApprovers: 'fallback',
      fallbackApprovers: [{ type: 'org_membership_level', value: 'owner' }],
    };
    expect(issues(ApprovalNodeConfigSchema, config)).toEqual([]);
  });

  it('omitted, stays absent after the parse: no default materializes', () => {
    const parsed = ApprovalNodeConfigSchema.parse(BASE);
    expect(Object.prototype.hasOwnProperty.call(parsed, 'excludeSubmitter')).toBe(false);
  });

  it.each(['yes', 1, null])('refuses the non-boolean %j at the key\'s own path', (value) => {
    expect(issues(ApprovalNodeConfigSchema, { ...BASE, excludeSubmitter: value })).toEqual([
      { code: 'invalid_type', path: 'excludeSubmitter' },
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 the flow door
// ───────────────────────────────────────────────────────────────────────────

describe('§2 FlowSchema accepts it inside an approval node config', () => {
  it('a flow whose approval node sets excludeSubmitter: true parses whole', () => {
    expect(issues(FlowSchema, flowWith({ config: { ...BASE, excludeSubmitter: true } }))).toEqual([]);
  });

  it('control: the same flow without the key parses too', () => {
    expect(issues(FlowSchema, flowWith({ config: BASE }))).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 step-level only — every other coordinate still refuses it
// ───────────────────────────────────────────────────────────────────────────

describe('§3 the key is step-level only: written anywhere else it is refused', () => {
  it('on an approver row: the closed approver shape refuses it', () => {
    expect(issues(ApprovalNodeApproverSchema, { ...SLATE[0], excludeSubmitter: true })).toEqual([
      { code: 'unrecognized_keys', path: '' },
    ]);
  });

  it('on an approver row inside a flow: refused at that row\'s path', () => {
    const config = { approvers: [{ ...SLATE[0], excludeSubmitter: true }, SLATE[1]] };
    expect(issues(FlowSchema, flowWith({ config }))).toEqual([
      { code: 'custom', path: 'nodes.1.config.approvers.0.excludeSubmitter' },
    ]);
  });

  it('on the flow node beside config: refused at the node', () => {
    expect(issues(FlowSchema, flowWith({ config: BASE, excludeSubmitter: true }))).toEqual([
      { code: 'unrecognized_keys', path: 'nodes.1' },
    ]);
  });

  it('on the flow itself (no flow-level default was ruled): refused at the root', () => {
    expect(issues(FlowSchema, flowWith({ config: BASE }, { excludeSubmitter: true }))).toEqual([
      { code: 'unrecognized_keys', path: '' },
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 the JSON schema the designer and registerFlow() read
// ───────────────────────────────────────────────────────────────────────────

describe('§4 the published JSON schema carries it as an optional boolean with no default', () => {
  it('is a plain boolean property, not required, with no default, and the shape stays closed', () => {
    const js = getApprovalNodeConfigJsonSchema() as {
      properties: Record<string, Record<string, unknown>>;
      required?: string[];
      additionalProperties?: unknown;
    };
    expect(js.properties.excludeSubmitter?.type).toBe('boolean');
    expect(js.properties.excludeSubmitter).not.toHaveProperty('default');
    expect(js.required ?? []).not.toContain('excludeSubmitter');
    expect(js.additionalProperties).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §5 the status the describe declares
// ───────────────────────────────────────────────────────────────────────────

describe('§5 the describe declares the key planned and names its two subjects', () => {
  // Read inside each test, never at collection: a key that went missing then
  // reds these two tests instead of erroring the file and hiding §1–§4.
  const doc = (): string => {
    const member = (ApprovalNodeConfigSchema.shape as Record<string, { description?: string } | undefined>)
      .excludeSubmitter;
    return member?.description ?? '';
  };

  it('opens with the planned marker: declared, not yet read by the approval engine', () => {
    expect(doc().startsWith('[PLANNED')).toBe(true);
  });

  it('names who is removed (submitter_id) and where an emptied slate goes (onEmptyApprovers)', () => {
    expect(doc()).toContain('`submitter_id`');
    expect(doc()).toContain('`onEmptyApprovers`');
  });

  it("names the one policy refused beside it ('auto_approve'), so an author reading it is not surprised by §6", () => {
    expect(doc()).toContain("'auto_approve'");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §6 the refused pair: excludeSubmitter: true + onEmptyApprovers: 'auto_approve'
// ───────────────────────────────────────────────────────────────────────────

describe("§6 excludeSubmitter: true beside onEmptyApprovers: 'auto_approve' is refused at the parse", () => {
  const PAIR = { ...BASE, excludeSubmitter: true, onEmptyApprovers: 'auto_approve' };
  const FALLBACK = [{ type: 'org_membership_level', value: 'owner' }];

  /** The refusal's message, read off the contract itself — never re-spelled here. */
  const refusalMessage = (value: unknown): string => {
    const result = ApprovalNodeConfigSchema.safeParse(value);
    if (result.success) return '';
    return result.error.issues.find((i) => i.path.join('.') === 'onEmptyApprovers')?.message ?? '';
  };

  it('refuses the pair with ONE issue, at onEmptyApprovers (the key the prescribed edit changes)', () => {
    expect(issues(ApprovalNodeConfigSchema, PAIR)).toEqual([{ code: 'custom', path: 'onEmptyApprovers' }]);
  });

  it('names both keys and the three policies it offers instead', () => {
    const message = refusalMessage(PAIR);
    for (const subject of ['excludeSubmitter', "'auto_approve'", "'admin_rescue'", "'fail'", "'fallback'", 'fallbackApprovers']) {
      expect(message, subject).toContain(subject);
    }
  });

  it.each([
    ['admin_rescue, declared', { onEmptyApprovers: 'admin_rescue' }],
    ['admin_rescue, the default (key omitted)', {}],
    ['fail', { onEmptyApprovers: 'fail' }],
    ['fallback with fallbackApprovers', { onEmptyApprovers: 'fallback', fallbackApprovers: FALLBACK }],
  ])('control: excludeSubmitter: true beside %s parses green', (_label, policy) => {
    expect(issues(ApprovalNodeConfigSchema, { ...BASE, excludeSubmitter: true, ...policy })).toEqual([]);
  });

  it.each([
    ['excludeSubmitter: false', { excludeSubmitter: false }],
    ['excludeSubmitter omitted', {}],
  ])("control: onEmptyApprovers: 'auto_approve' beside %s parses green and keeps its meaning", (_label, exclusion) => {
    const config = { ...BASE, ...exclusion, onEmptyApprovers: 'auto_approve' };
    expect(issues(ApprovalNodeConfigSchema, config)).toEqual([]);
    expect(ApprovalNodeConfigSchema.parse(config).onEmptyApprovers).toBe('auto_approve');
  });

  it('reaches the flow door: FlowSchema refuses it at the node config key, in the contract\'s own words', () => {
    const result = FlowSchema.safeParse(flowWith({ config: PAIR }));
    expect(result.success).toBe(false);
    const found = result.success ? [] : result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
    expect(found.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'custom', path: 'nodes.1.config.onEmptyApprovers' },
    ]);
    expect(found[0]!.message).toContain(refusalMessage(PAIR));
  });

  it("reaches the build judge as node-config-refused-by-contract on onEmptyApprovers", () => {
    const refusals = flowNodeConfigRefusals('approval', PAIR);
    expect(refusals.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'node-config-refused-by-contract', path: 'onEmptyApprovers' },
    ]);
    expect(refusals[0]!.message).toContain(refusalMessage(PAIR));
  });

  it('is independent of the fallbackApprovers pairing: both arms report, and one edit to fallback clears both', () => {
    const both = { ...PAIR, fallbackApprovers: FALLBACK };
    expect(issues(ApprovalNodeConfigSchema, both)).toEqual([
      { code: 'custom', path: 'onEmptyApprovers' },
      { code: 'custom', path: 'onEmptyApprovers' },
    ]);
    expect(issues(ApprovalNodeConfigSchema, { ...both, onEmptyApprovers: 'fallback' })).toEqual([]);
  });
});
