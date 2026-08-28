// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateActionParams,
  ACTION_PARAM_BUILTIN_KEYS,
  ActionSessionSchema,
  type ActionSession,
  type ResolvedActionParam,
} from './action-params.zod';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';

const codes = (issues: ReturnType<typeof validateActionParams>) => issues.map((i) => i.code).sort();

describe('validateActionParams (ADR-0104 D2)', () => {
  it('accepts a conformant bag (no issues)', () => {
    const resolved: ResolvedActionParam[] = [
      { name: 'title', type: 'text', required: true },
      { name: 'amount', type: 'currency' },
      { name: 'assignee', type: 'lookup' },
      { name: 'labels', type: 'multiselect', options: [{ value: 'a' }, { value: 'b' }] },
    ];
    const bag = { title: 'Hi', amount: 12.5, assignee: 'usr_1', labels: ['a', 'b'] };
    expect(validateActionParams(resolved, bag)).toEqual([]);
  });

  it('flags a missing required param', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'title', type: 'text', required: true }];
    const issues = validateActionParams(resolved, {});
    expect(codes(issues)).toEqual(['required']);
    expect(issues[0].param).toBe('title');
  });

  it('does not flag a missing OPTIONAL param', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'note', type: 'text' }];
    expect(validateActionParams(resolved, {})).toEqual([]);
  });

  it('flags a bad option value and a wrong-typed value (invalid_shape)', () => {
    const resolved: ResolvedActionParam[] = [
      { name: 'priority', type: 'select', options: [{ value: 'high' }, { value: 'low' }] },
      { name: 'count', type: 'number' },
    ];
    const issues = validateActionParams(resolved, { priority: 'HIGH', count: 'not-a-number' });
    expect(codes(issues)).toEqual(['invalid_shape', 'invalid_shape']);
  });

  it('enforces reference id shape (expanded object rejected at the stored position)', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'account', type: 'lookup' }];
    const issues = validateActionParams(resolved, { account: { id: 'acc_1', name: 'Acme' } });
    expect(codes(issues)).toEqual(['invalid_shape']);
  });

  it('enforces multiple → array', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'watchers', type: 'user', multiple: true }];
    expect(validateActionParams(resolved, { watchers: ['u1', 'u2'] })).toEqual([]);
    expect(codes(validateActionParams(resolved, { watchers: 'u1' }))).toEqual(['invalid_shape']);
  });

  it('flags unknown params, but allows the dispatcher built-in keys', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'title', type: 'text' }];
    const issues = validateActionParams(resolved, { title: 'x', bogus: 1, recordId: 'r1', objectName: 'o' });
    // `unknown_param` folded into the catalog's `unknown_field` (ADR-0114 D2) —
    // the `param` key beside it already says what was addressed.
    expect(codes(issues)).toEqual(['unknown_field']);
    expect(issues[0].param).toBe('bogus');
    expect(ACTION_PARAM_BUILTIN_KEYS).toContain('recordId');
    expect(ACTION_PARAM_BUILTIN_KEYS).toContain('objectName');
  });

  it('allows the aggregate-dispatch key _selectedIds on a param-declaring action (objectui#3139)', () => {
    // The renderer's aggregate bulk dispatch injects `_selectedIds` next to
    // the user-collected params; strict mode must not 400 the whole call for
    // a key the author can never declare.
    const resolved: ResolvedActionParam[] = [{ name: 'format', type: 'text' }];
    const issues = validateActionParams(resolved, {
      format: 'png',
      _selectedIds: ['dev_1', 'dev_2'],
    });
    expect(issues).toEqual([]);
    expect(ACTION_PARAM_BUILTIN_KEYS).toContain('_selectedIds');
  });

  it('leaves the value shape OPEN when the resolved type is unknown (field-backed param whose field is gone)', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'freeform' /* no type */ }];
    expect(validateActionParams(resolved, { freeform: { anything: [1, 2, 3] } })).toEqual([]);
  });

  it('custom builtinKeys override the default allowlist', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'title', type: 'text' }];
    const issues = validateActionParams(resolved, { title: 'x', ctxToken: 'z' }, { builtinKeys: ['ctxToken'] });
    expect(issues).toEqual([]);
  });
});

/**
 * [#5622] A rejected key one leading underscore away from a built-in NAMES
 * that built-in. Message copy only — the verdict does not move.
 *
 * ## What the cost was, and why a message is the whole fix
 *
 * `Unknown action param "selectedIds" — not declared on this action` is a true
 * sentence whose only actionable reading is false: the reader's next step is
 * to declare `selectedIds` on the action, and `_selectedIds` is precisely the
 * key that CANNOT be declared — the aggregate bulk dispatch injects it
 * (objectui#3139). #5568's reporter walked that road to its end, concluded
 * from the dead end that REST carried no legal shape for a selection at all,
 * and opened a platform issue; `params._selectedIds` had been live the whole
 * time. The hint ends that at the first call.
 *
 * ## The pins below assert the MESSAGE, not the failure
 *
 * "Validation failed" is one bit and this defect has two — the key is rejected
 * both before and after this change, so a test asserting only rejection is
 * green on the unfixed validator. Every case therefore pins `code` AND the
 * message content, and the negative case pins the message BYTE FOR BYTE.
 *
 * ## Reverse verification — directions predicted BEFORE running
 *
 *  - Make `builtinNearMissHint` return `''` unconditionally (i.e. restore
 *    today's behaviour) → the three hint cases and the accuracy case go RED on
 *    their message assertions; every `codes(...)` assertion in this file stays
 *    green, which is the point: the verdict never moved.
 *  - ⚠️ HONEST NOTE — "an ordinary typo keeps today's message" is a COMPANION,
 *    not a pin of this change (the #5722 distinction). It asserts the message
 *    the UNFIXED validator already produced, so it is green on both sides of
 *    the revert by construction. It is kept because it is the assertion that
 *    goes red if the hint ever starts firing on distant keys — a fuzzy matcher
 *    creeping in later is exactly the regression it guards, and that one this
 *    file cannot otherwise see.
 *  - Widen the match to fuzzy/Levenshtein → the two "no hint" cases go RED.
 */
describe('#5622 — near-miss built-in hint on unknown_field', () => {
  const declaresFormat: ResolvedActionParam[] = [{ name: 'format', type: 'text' }];

  it('names `_selectedIds` when the caller sent `selectedIds` (the #5568 road)', () => {
    const issues = validateActionParams(declaresFormat, { format: 'png', selectedIds: ['dev_1', 'dev_2'] });

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('unknown_field');
    expect(issues[0].param).toBe('selectedIds');
    expect(issues[0].message).toContain('Unknown action param "selectedIds" — not declared on this action');
    expect(issues[0].message).toContain('Did you mean the built-in "_selectedIds"?');
    // The mechanism half — what makes the hint actionable rather than a
    // spelling suggestion: it says the key is never declared, and where the
    // value comes from instead.
    expect(issues[0].message).toContain('Built-in params are never declared on an action');
    expect(issues[0].message).toContain('aggregate bulk dispatch');
    expect(issues[0].message).toContain('ctx.params._selectedIds');
  });

  it('names `recordId` when the caller sent `_recordId` (the reverse direction)', () => {
    const issues = validateActionParams(declaresFormat, { format: 'png', _recordId: 'rec_1' });

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('unknown_field');
    expect(issues[0].param).toBe('_recordId');
    expect(issues[0].message).toContain('Did you mean the built-in "recordId"?');
    expect(issues[0].message).toContain('ctx.params.recordId');
  });

  it('gives each of the THREE built-ins its own true origin sentence', () => {
    // The issue proposed one sentence — "injected by an aggregate bulk
    // dispatch" — which is true of `_selectedIds` and false of the other two:
    // those are merged in SERVER-side by the dispatcher. Wrong-mechanism copy
    // is worse than none, so the sentence is per-key.
    const messageFor = (key: string) => {
      const issues = validateActionParams(declaresFormat, { format: 'png', [key]: 'v' });
      expect(issues).toHaveLength(1);
      return issues[0].message;
    };

    expect(messageFor('_recordId')).toContain('the dispatcher merges it in from the record-scoped route');
    expect(messageFor('_objectName')).toContain('the dispatcher merges in the name of the object the action dispatched on');
    expect(messageFor('selectedIds')).toContain('injects every selected record id under it');

    // ...and no message claims another key's mechanism.
    expect(messageFor('_recordId')).not.toContain('aggregate bulk dispatch');
    expect(messageFor('selectedIds')).not.toContain('record-scoped route');
  });

  it('leaves an ordinary unknown key\'s message EXACTLY as it is today', () => {
    const issues = validateActionParams(declaresFormat, { format: 'png', bogus: 1 });

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('unknown_field');
    // Byte for byte — a hint that leaks onto keys nowhere near a built-in is
    // noise, and noise is how a reader learns to skip the line that mattered.
    expect(issues[0].message).toBe('Unknown action param "bogus" — not declared on this action');
    expect(issues[0].message).not.toContain('Did you mean');
  });

  it('does NOT fire on keys that are merely NEARBY — the match is one leading underscore, not a similarity score', () => {
    for (const key of ['selected_ids', 'selectedIDs', 'selectedId', 'recordID', 'record_id', 'objectname']) {
      const issues = validateActionParams(declaresFormat, { format: 'png', [key]: 'v' });
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('unknown_field');
      expect(issues[0].message).toBe(`Unknown action param "${key}" — not declared on this action`);
    }
  });

  it('hints a custom `builtinKeys` entry with the GENERIC origin, never another key\'s mechanism', () => {
    // The override's members are built-ins by the option's own definition, so
    // the "never declared" half holds; their producer is unknown to this
    // module, so the sentence claims nothing more than that.
    const issues = validateActionParams(
      declaresFormat,
      { format: 'png', _ctxToken: 'z' },
      { builtinKeys: ['ctxToken'] },
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('unknown_field');
    expect(issues[0].message).toContain('Did you mean the built-in "ctxToken"?');
    expect(issues[0].message).toContain('the dispatcher supplies it.');
    expect(issues[0].message).not.toContain('ctx.params');
  });

  it('moves the ACCEPTED SET by nothing — the near-miss is still rejected, the built-in still accepted', () => {
    // The ruling that scopes this change: a hint, not a second channel. If
    // `selectedIds` ever starts being accepted, the platform grows a synonym
    // for a contract that has exactly one spelling.
    expect(validateActionParams(declaresFormat, { format: 'png', _selectedIds: ['a', 'b'] })).toEqual([]);
    expect(codes(validateActionParams(declaresFormat, { format: 'png', selectedIds: ['a', 'b'] })))
      .toEqual(['unknown_field']);

    // And the built-ins themselves are still allowed under their own names —
    // the hint reads the same `allow` set the verdict does, so a bug there
    // would show up as a built-in being flagged.
    expect(validateActionParams(declaresFormat, { format: 'png', recordId: 'r1', objectName: 'o' })).toEqual([]);
    expect(ACTION_PARAM_BUILTIN_KEYS).toEqual(['recordId', 'objectName', '_selectedIds']);
  });
});

/**
 * [#5779] `ActionSession` gains the canonical `positions` key and demotes
 * `roles` to a deprecated alias — the SPEC half of #5613 phase 2, under the
 * maintainer's "C skeleton + A semantics" ruling.
 *
 * Phase 1 (#5697) declared the shape the runtime already built and explicitly
 * withheld `positions` ("do NOT add a `positions` key here ahead of it"). That
 * prohibition is lifted by this change and rewritten, which is why the pins
 * below assert the NEW wording rather than merely the new key: a rename whose
 * deprecation notice does not survive the next edit is a rename that silently
 * becomes two permanent spellings.
 *
 * ## What the key-preservation assertions are actually guarding
 *
 * `ActionSessionSchema` is deliberately NOT strict (a runtime shape handed to
 * a body — see the schema's docblock). So `safeParse().success` is worthless
 * here: an UNDECLARED key parses "successfully" and is silently stripped. The
 * load-bearing fact is therefore that a parse PRESERVES the key. This is the
 * key-reachability question, not a value-verdict question — the schema judges
 * no `positions` VALUE beyond `string[]`, so demanding anything more than
 * preservation would pin something the contract does not claim.
 *
 * ## Reverse verification — directions predicted BEFORE running
 *
 *  - Delete the `positions` declaration from `action-params.zod.ts` → the two
 *    preservation tests go RED (a non-strict parse strips it), the describe
 *    pin goes RED (there is no `shape.positions` to read a description off),
 *    and `pnpm --filter @objectstack/spec typecheck` reports an excess-property
 *    error on the typed dual-emit literal. Measured: that is what happens.
 *  - Restore the phase-1 `roles` describe → the alias-wording pin goes RED on
 *    every clause (`deprecated alias`, the migration id, the #3290 path).
 *  - Delete the ADR-0087 entry → the registry pin goes RED.
 *
 * ## What does NOT move, and why that is the point
 *
 * `packages/runtime/src/action-session-shape-contract.test.ts` — which pins
 * `parse(built)` deep-equal `built` and the exact built key set — stays GREEN
 * across this change, predicted before it was run. Adding an OPTIONAL key can
 * neither reject a previously valid object nor materialise itself in the parse
 * output of an input that lacks it, and the producer (still emitting only
 * `roles` until #5613's runtime half) is untouched. That suite going red would
 * have meant the contract had led its producer into a break, which is exactly
 * what a deprecation window exists to prevent.
 */
describe('#5779 — ActionSession `positions` canonical + `roles` deprecated alias', () => {
  it('PRESERVES `positions` through a parse instead of stripping it', () => {
    const parsed = ActionSessionSchema.parse({
      userId: 'usr_1',
      organizationId: 'org_acme',
      positions: ['sales_rep', 'org_admin'],
    });

    expect(parsed).toHaveProperty('positions');
    expect(parsed.positions).toEqual(['sales_rep', 'org_admin']);
  });

  it('accepts the DUAL-EMIT shape #5613\'s runtime half will produce — both keys, one value', () => {
    // The window's defining property: same array under both spellings, so a
    // reader migrates by changing the key it reads and nothing else. Pinned
    // here on the contract side BEFORE the producer exists, because that
    // ordering (contract first, producer second) is the ruling.
    const positions = ['sales_rep', 'org_admin'];
    const built = { userId: 'usr_1', organizationId: 'org_acme', positions, roles: positions };

    const parsed = ActionSessionSchema.parse(built);
    expect(parsed).toEqual(built);
    expect(parsed.positions).toEqual(parsed.roles);
  });

  it('still parses a session carrying ONLY `roles` — the alias keeps working through the window', () => {
    // What `buildActionSession()` builds TODAY. A deprecation that broke this
    // would not be a deprecation; it would be the removal, shipped early.
    const built = { userId: 'usr_1', roles: ['sales_rep'] };

    const parsed = ActionSessionSchema.parse(built);
    expect(parsed).toEqual(built);
    expect(parsed).not.toHaveProperty('positions');
  });

  it('keeps BOTH keys optional', () => {
    // ⚠️ HONEST NOTE — a COMPANION, not a pin (the #5722 distinction). It
    // asserts absence, and absence is also what an undeclared/stripped key
    // produces, so it stayed green under the reverse verification while its
    // siblings went red. It is kept because "declaring `positions` did not
    // make it required" is a real regression it catches (drop `.optional()`
    // and it turns red) — but it is not evidence the declaration exists.
    const parsed = ActionSessionSchema.parse({ userId: 'usr_1' });
    expect(parsed.positions).toBeUndefined();
    expect(parsed.roles).toBeUndefined();
  });

  it('types the dual-emit window on the `ActionSession` face (the tsc channel)', () => {
    // `z.infer` must admit both keys at once, or #5613's runtime half cannot
    // annotate `buildActionSession()`'s return with this type while emitting
    // both — the type face is a precondition of the producer change, not a
    // consequence of it. Explicitly annotated so a narrowed or renamed
    // declaration fails here rather than being absorbed by inference.
    const dualEmitted: ActionSession = {
      userId: 'usr_1',
      organizationId: 'org_acme',
      positions: ['sales_rep'],
      roles: ['sales_rep'],
    };
    const canonicalRead: string[] | undefined = dualEmitted.positions;
    const aliasRead: string[] | undefined = dualEmitted.roles;

    expect(canonicalRead).toEqual(aliasRead);
  });

  it('pins `positions` as CANONICAL and carries the ADR-0095 privilege boundary', () => {
    // A `.describe()` reaches the generated reference page and every
    // schema-driven surface, so the vocabulary claim and the security caution
    // are load-bearing text, not decoration. The caution belongs to the VALUE,
    // which is why it had to survive the rename verbatim.
    const doc = ActionSessionSchema.shape.positions.description ?? '';

    expect(doc).toMatch(/CANONICAL/);
    expect(doc).toMatch(/ADR-0090 D3/);
    expect(doc).toMatch(/ExecutionContext\.positions/);
    expect(doc).toMatch(/security service/i);
    expect(doc).toMatch(/ADR-0095/);
  });

  it('pins `roles` as a DEPRECATED ALIAS naming its replacement, migration and removal path', () => {
    // The four things a reader needs and cannot infer from the key name: that
    // it is deprecated, what replaces it, where the prescription lives, and
    // that removal is scheduled rather than hypothetical.
    const doc = ActionSessionSchema.shape.roles.description ?? '';

    expect(doc).toMatch(/DEPRECATED alias of `positions`/);
    expect(doc).toMatch(/action-session-roles-to-positions/);
    expect(doc).toMatch(/deprecate → remove/);
    expect(doc).toMatch(/security service/i);

    // ...and that phase 1's now-obsolete prohibition is GONE. Leaving it would
    // tell the next reader that `positions` must not exist, on the very schema
    // where it now does.
    expect(doc).not.toMatch(/deliberately NO `positions` key/);
  });

  it('registers the rename as an ADR-0087 semantic migration (the reader-facing channel)', () => {
    // `spec-changes.json`, the generated upgrade guide and the `spec_changes`
    // MCP tool are all projections of this registry. Without the entry the
    // rename reaches a consumer only when their read starts returning
    // `undefined` — which is the failure mode a deprecation window exists to
    // replace with an announcement.
    const entry = MIGRATIONS_BY_MAJOR[17]?.semantic
      .find((s) => s.id === 'action-session-roles-to-positions');

    expect(entry).toBeDefined();
    expect(entry!.surface).toBe('ui.actionSession.roles');
    expect(entry!.replacement).toMatch(/positions/);
    // It is a RENAME under a window, not the retirement its hook-side
    // neighbour (`hook-context-session-roles-retired`, #5050) was — the reason
    // must not read as a removal notice.
    expect(entry!.reason).toMatch(/deprecation window/);
    expect(entry!.reason).toMatch(/tracked separately/);
    expect(entry!.acceptanceCriteria).toMatch(/ctx\.session\.positions/);
  });
});
