// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12277] A sandboxed hook body's `delete ctx.input.x` reaches the host row.
 *
 * ## Why this is the worse half of the card, and what it takes to pin it
 *
 * The engine-side half of #12277 was a missing `deleteProperty` trap on the
 * flat-input Proxy: a no-op whose lie was confined to `delete`'s own return
 * value, since `k in input` and `Object.keys(input)` went on honestly
 * reporting the key.
 *
 * This half has no such tell. Inside QuickJS the delete is REAL — the body
 * holds a JSON snapshot, and every read-back it can reach agrees. What was
 * lost is the trip home: `applyMutationsToInput` wrote mutations back with
 * `Object.assign(target, result.mutatedInput)`, and `Object.assign` copies own
 * enumerable properties. **It has no way to represent a deletion.** A key the
 * VM removed is simply not in `mutatedInput`, and the host's key stays.
 *
 * Measured on the pre-fix code, one hook call:
 *
 * ```
 * delete ctx.input.internal_notes  ->  true
 * 'internal_notes' in ctx.input    ->  false          ← the VM agrees
 * Object.keys(ctx.input)           ->  ['subject']    ← …and so does this
 * host ctx.input after write-back  ->  { subject: 'HELP',
 *                                        internal_notes: 'STAFF-ONLY' }
 * ```
 *
 * That is why the first case asserts BOTH ENDS of the same call — what the
 * body observed and what the host was left holding. Asserting only the host
 * row would leave the pin passing on a runner that had stopped executing the
 * body at all; asserting only the body's view is precisely the reading that
 * shipped the defect, because it was true the whole time.
 *
 * ## The direction the write-back must NOT overreach in
 *
 * Absence from the exit dump is the only evidence a deletion leaves, and it is
 * ambiguous on its own: a key whose host value is `undefined` (or a function,
 * or a symbol) never survived `JSON.stringify` into the VM either, so it is
 * missing from the dump without anyone having deleted it. The last case pins
 * that such a key is LEFT ALONE. Losing a delete is recoverable; destroying a
 * field on evidence that was never there is not, so the diff is filtered
 * through the same JSON lens the boundary uses rather than trusting absence.
 */

import { describe, it, expect } from 'vitest';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

const runner = new QuickJSScriptRunner();

/** Build a sandboxed `beforeInsert` hook around one JS body. */
function jsHook(source: string) {
  return hookBodyRunnerFactory(runner, { ql: {}, appId: 'crm' })({
    name: 'guest_intake',
    object: 'case',
    events: ['beforeInsert'],
    body: { language: 'js', source, capabilities: [] },
  } as any)!;
}

describe('[#12277] a sandboxed body can delete an input field', () => {
  it('the body’s read-backs and the host row agree the field is gone', async () => {
    const fn = jsHook(
      [
        'var seen = {};',
        'seen.deleteReturned = delete ctx.input.internal_notes;',
        "seen.inOperator = 'internal_notes' in ctx.input;",
        'seen.propertyRead = ctx.input.internal_notes;',
        'seen.objectKeys = Object.keys(ctx.input);',
        // An assignment in the same call: the POSITIVE CONTROL. Without it the
        // host assertions below would also pass against a runner whose
        // write-back had stopped doing anything at all.
        'ctx.input.subject = String(ctx.input.subject).toUpperCase();',
        'return { __probe: JSON.stringify(seen) };',
      ].join('\n'),
    );
    const engineCtx: any = { input: { subject: 'help', internal_notes: 'STAFF-ONLY' } };
    await fn(engineCtx);

    const seen = JSON.parse(String(engineCtx.input.__probe));
    expect(seen.deleteReturned).toBe(true);
    expect(seen.inOperator).toBe(false);
    expect(seen.propertyRead).toBeUndefined();
    expect(seen.objectKeys).toEqual(['subject']);

    expect('internal_notes' in engineCtx.input).toBe(false);
    expect(engineCtx.input.subject).toBe('HELP');
  });

  it('an explicit return patch outranks a delete of the same key', async () => {
    // Deletions apply before both merges, so the later, more deliberate
    // statement wins rather than the two racing on write-back order.
    const fn = jsHook('delete ctx.input.status; return { status: "reopened" };');
    const engineCtx: any = { input: { subject: 'help', status: 'closed' } };
    await fn(engineCtx);
    expect(engineCtx.input.status).toBe('reopened');
  });

  it('the whole guest-intake shape: several deletes in one body, all of them landing', async () => {
    // The consumer measurement behind the card — an anonymous web-to-case
    // submission that must not be able to write staff-only fields. Fifteen
    // `delete` statements were inert; a submission carrying `internal_notes`
    // and `resolution` stored them verbatim.
    const fn = jsHook(
      [
        'delete ctx.input.internal_notes;',
        'delete ctx.input.resolution;',
        'delete ctx.input.escalated;',
        'delete ctx.input.owner_id;',
      ].join('\n'),
    );
    const engineCtx: any = {
      input: {
        subject: 'printer on fire',
        internal_notes: 'STAFF-ONLY',
        resolution: 'FORGED',
        escalated: true,
        owner_id: 'usr_admin',
        description: 'it is on fire',
      },
    };
    await fn(engineCtx);
    expect(Object.keys(engineCtx.input).sort()).toEqual(['description', 'subject']);
  });

  it('a key the VM never saw is LEFT ALONE, not deleted', async () => {
    // `undefined` has no JSON spelling, so `absent_from_the_dump` proves
    // nothing about `undef_key` — the body could not have deleted what it
    // could not see. The conservative direction is mandatory here: the
    // alternative destroys a field on absent evidence.
    const fn = jsHook('ctx.input.subject = "HELP";');
    const engineCtx: any = { input: { subject: 'help', undef_key: undefined } };
    await fn(engineCtx);
    expect('undef_key' in engineCtx.input).toBe(true);
    expect(engineCtx.input.subject).toBe('HELP');
  });

  it('a body that deletes nothing changes nothing', async () => {
    const fn = jsHook('return { subject: ctx.input.subject.trim() };');
    const engineCtx: any = { input: { subject: '  help  ', internal_notes: 'KEEP ME' } };
    await fn(engineCtx);
    expect(engineCtx.input).toEqual({ subject: 'help', internal_notes: 'KEEP ME' });
  });
});
