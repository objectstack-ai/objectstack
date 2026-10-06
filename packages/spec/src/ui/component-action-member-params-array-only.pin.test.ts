// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21855] An `action:group` / `action:menu` member's `params` takes the array
 * form only, unless the member's `type` is `api` — the rows' value ratchet for
 * this one member (the docblock on `actionContainerMemberShape` in
 * `component.zod.ts` carries the read points and the rulings).
 *
 * ## The defect this file closes
 *
 * The member declared `params` as `z.unknown()`. Both containers forward an
 * array as the input list, forward any other value only for a `type: 'api'`
 * member (its request payload), and drop it for every other `type`, with a
 * development-build warning only (objectui `static-params.ts:172-182` at the
 * `.objectui-sha` pin `0abd4f9f8`). So an object `params` on a `navigate_edit`
 * member passed the component-props gate and then reached no action.
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE REFUSAL: a non-array `params` on a non-`api` member is refused with
 *   the code AND the path, so a refusal for the wrong reason reds, and the
 *   message carries the member prescription.
 * - §2 WHAT STAYS ACCEPTED, byte for byte: the array form on any member, the
 *   `api` member's object `params` (its request-payload window), a member with
 *   no `params`, and an `action:button` / `action:icon` node's object
 *   `params`, which IS its static values. A refusal pin with no lit control
 *   passes just as well when the door refuses everything.
 * - §3 ONE COMPLAINT: the unknown-key refusal stays terminal, so a member
 *   already refused for a key is not judged a second time.
 * - §4 THE REGISTRATION: the ADR-0087 D3 entry step 18 carries, and the step's
 *   rationale names it.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { ComponentPropsMap } from './component.zod';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';

type Row = 'action:group' | 'action:menu' | 'action:button' | 'action:icon';
const parse = (row: Row, props: Record<string, unknown>) => ComponentPropsMap[row].safeParse(props);

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}
const firstMessage = (result: z.ZodSafeParseResult<unknown>): string =>
  (result.success ? '' : result.error.issues[0]!.message);

const CONTAINERS = ['action:group', 'action:menu'] as const;
/** The static values objectui's own drop probe writes on a member. */
const VALUES = { objectName: 'account', recordId: '${record.id}' };
/** An `ActionParam[]` input list. */
const INPUTS = [{ name: 'reason', label: 'Reason', type: 'text', required: true }];

// ───────────────────────────────────────────────────────────────────────────
// §1 the refusal
// ───────────────────────────────────────────────────────────────────────────

describe('§1 a non-array `params` on a member whose `type` is not `api` is refused at its path', () => {
  const REFUSED: ReadonlyArray<readonly [label: string, member: Record<string, unknown>]> = [
    ['an object on a `navigate_edit` member', { name: 'edit', label: 'Edit', type: 'navigate_edit', params: VALUES }],
    ['an object on a member with no `type`', { name: 'edit', label: 'Edit', params: VALUES }],
    // The url action's interpolation scope, a third meaning the runner gave an object.
    ['an object on a `url` member', { name: 'open', type: 'url', target: '/x/${param.id}', params: { id: 'r1', newTab: true } }],
    ['an empty object on a `script` member', { name: 'run', type: 'script', params: {} }],
    ['a string on a `flow` member', { name: 'run', type: 'flow', target: 'close_case', params: 'reason' }],
    ['a number on a `modal` member', { name: 'ask', type: 'modal', params: 1 }],
    ['null on a `form` member', { name: 'ask', type: 'form', params: null }],
  ];
  for (const container of CONTAINERS) {
    for (const [label, member] of REFUSED) {
      it(`${container}: refuses ${label}`, () => {
        const r = parse(container, { actions: [member] });
        expect(r.success).toBe(false);
        expect(issues(r)).toEqual([{ code: 'custom', path: 'actions.0.params' }]);
      });
    }

    it(`${container}: the issue lands on the member that wrote it, not on its neighbour`, () => {
      const r = parse(container, {
        actions: [
          { name: 'ask', type: 'script', params: INPUTS },
          { name: 'edit', type: 'navigate_edit', params: VALUES },
        ],
      });
      expect(issues(r)).toEqual([{ code: 'custom', path: 'actions.1.params' }]);
    });
  }

  it('the refusal names the container, the member\'s `type`, and the member prescription', () => {
    const message = firstMessage(parse('action:menu', { actions: [{ name: 'edit', type: 'navigate_edit', params: VALUES }] }));
    expect(message).toMatch(/^`params` on an `action:menu` member is the list of inputs/);
    expect(message).toMatch(/this member's `type` is `'navigate_edit'`, so the object written here is dropped/);
    expect(message).toMatch(/author it as its own `action:button` node, whose `params` object carries them\.$/);
    expect(message).toMatch(/write `bodyExtra`/);
  });

  it('a member with no `type` is told so, and a non-object is not called an object', () => {
    expect(firstMessage(parse('action:group', { actions: [{ name: 'edit', params: VALUES }] })))
      .toMatch(/^`params` on an `action:group` member .* this member names no `type`, so the object written here/);
    expect(firstMessage(parse('action:group', { actions: [{ name: 'run', type: 'flow', params: 'reason' }] })))
      .toMatch(/`'flow'`, so the value written here is dropped/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 what stays accepted
// ───────────────────────────────────────────────────────────────────────────

describe('§2 the array form, the `api` window and the action nodes still parse, byte-identical', () => {
  const ACCEPTED: ReadonlyArray<readonly [label: string, member: Record<string, unknown>]> = [
    ['an input list on a `navigate_edit` member', { name: 'edit', type: 'navigate_edit', params: INPUTS }],
    ['an input list on a member with no `type`', { name: 'ask', params: INPUTS }],
    ['an empty input list', { name: 'run', type: 'script', params: [] }],
    // The request-payload window: an `api` member's object `params` is forwarded as its payload.
    ['an object on an `api` member', { name: 'close', type: 'api', target: '/api/v1/order/close', params: { status: 'closed' } }],
    ['an input list on an `api` member', { name: 'close', type: 'api', target: '/api/v1/order/close', params: INPUTS }],
    ['a string on an `api` member', { name: 'ping', type: 'api', target: '/api/v1/ping', params: 'raw' }],
    ['no `params`', { name: 'run', type: 'script' }],
    ['an `api` member\'s request body in `bodyExtra`', { name: 'close', type: 'api', target: '/x', bodyExtra: { status: 'closed' } }],
  ];
  for (const container of CONTAINERS) {
    for (const [label, member] of ACCEPTED) {
      it(`${container}: ${label}`, () => {
        const r = parse(container, { actions: [member] });
        expect(issues(r)).toEqual([]);
        expect(r.success && (r.data as { actions: unknown[] }).actions).toStrictEqual([member]);
      });
    }
  }

  // CONTROL: on an action NODE the object `params` IS the static values — the
  // prescription's own target — and the row keeps it.
  for (const row of ['action:button', 'action:icon'] as const) {
    it(`${row}: an object \`params\` on a non-api node still parses — it carries the static values`, () => {
      const props = { name: 'edit', label: 'Edit', actionType: 'navigate_edit', params: VALUES };
      const r = parse(row, props);
      expect(issues(r)).toEqual([]);
      expect(r.success && (r.data as { params?: unknown }).params).toStrictEqual(VALUES);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// §3 one complaint
// ───────────────────────────────────────────────────────────────────────────

describe('§3 a member already refused for a key is not judged a second time', () => {
  it('an unknown key beside an object `params` draws the unknown-key refusal alone', () => {
    const r = parse('action:group', { actions: [{ name: 'edit', type: 'navigate_edit', params: VALUES, bogus: 1 }] });
    expect(issues(r)).toEqual([{ code: 'unrecognized_keys', path: 'actions.0' }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 the registration
// ───────────────────────────────────────────────────────────────────────────

describe('§4 the narrowing is registered as the ADR-0087 D3 entry step 18 carries', () => {
  const ID = 'ui-action-group-menu-member-params-array-only';
  it('step 18 carries the semantic entry, with no conversion', () => {
    const entry = MIGRATIONS_BY_MAJOR[18]!.semantic.find((s) => s.id === ID);
    expect(entry).toBeDefined();
    expect(entry!.conversionIds ?? []).toEqual([]);
  });
  it('the step\'s rationale names it', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.rationale).toContain(`\`${ID}\``);
  });
});
