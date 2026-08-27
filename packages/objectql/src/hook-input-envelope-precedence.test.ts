// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12601] The flat-input Proxy's `get` and `getOwnPropertyDescriptor` traps
 * agree about `id` / `options` / `ast` / `data` when a record payload happens
 * to declare a field sharing one of those names.
 *
 * ## The disagreement, measured on `origin/main` before this file's fix
 *
 * `installFlatInput` (`hook-wrappers.ts`) gives the four wrapper keys
 * precedence in the `get` trap — a direct read always resolves against the
 * WRAPPER (envelope), never the payload. The descriptor trap used to check
 * `data` FIRST, so for an update-shaped envelope whose payload also carried a
 * same-named field:
 *
 * ```
 * const raw = { data: { id: 'PAYLOAD-ID', subject: 'help' }, options: {}, id: 'WRAPPER-ID' };
 * input.id                                             -> 'WRAPPER-ID'  (get: envelope)
 * Object.getOwnPropertyDescriptor(input, 'id').value    -> 'PAYLOAD-ID'  (descriptor: payload) <- DISAGREED
 * Reflect.ownKeys(input).includes('id')                 -> true
 * { ...input }.id                                       -> 'WRAPPER-ID'  (spread: envelope, via `get`)
 * ```
 *
 * `ownKeys` and spread ALREADY agreed with `get` before this fix — `ownKeys`
 * lists the payload's own key set unconditionally (#12578, untouched here),
 * and spread reads a key's VALUE through `get`, which always resolved the
 * wrapper. Only a caller that reads a raw descriptor (rather than a value)
 * saw the payload's own value — silently, and only for the four reserved
 * names, and only when a payload happened to declare one of them.
 *
 * ## The maintainer ruling implemented here — Option A, "envelope wins
 * consistently"
 *
 * `id` / `options` / `ast` / `data` are RESERVED NAMES on the hook flat-input
 * face. A payload field carrying one of them stays a legal record field —
 * it round-trips through storage exactly as declared — but it is not
 * reachable through the flat face at all: `input.data.<name>` is the only
 * route to it. `getOwnPropertyDescriptor` now checks the reserved-name
 * branch FIRST, exactly where `get` already does, so a descriptor read can
 * never again report a different object's value than a plain read of the
 * same key. `enumerable` still depends on whether `data` also owns the name
 * (mirroring `ownKeys`, which is unchanged): that is what keeps `{...input}`
 * and `Object.entries` carrying the envelope's value under the reserved name
 * exactly as they did before this fix, rather than silently dropping the key.
 *
 * Declined: Option B (payload wins) — it would overturn the D4
 * `HookTargetRebindError` ruling and change `input.id`'s meaning on every
 * update hook whose payload happens to carry a field called `id`. Option C
 * (refuse the four names on the payload outright) is a recorded fallback,
 * not this card — its prerequisite (#12397's maintainer floor) is unmet.
 *
 * `wrapDeclarativeHook` is driven directly rather than through `ObjectQL`,
 * for the reason every sibling trap-set file in this directory gives: the
 * subject is the wrapper's Proxy, and a full engine dispatch would put a
 * driver's own copy semantics between the hook and the assertion.
 */

import { describe, it, expect } from 'vitest';
import { wrapDeclarativeHook } from './hook-wrappers.js';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * Run `handler` as a declarative BEFORE-UPDATE hook over `raw` (the engine's
 * own envelope, caller-owned so it can be inspected after the wrapper
 * restores `ctx.input`).
 */
async function runHook(raw: Record<string, unknown>, handler: (input: any) => void): Promise<void> {
  const meta: any = { name: 'envelope_precedence_probe', object: 'case', event: 'beforeUpdate' };
  const wrapped = wrapDeclarativeHook(meta, (async (ctx: any) => handler(ctx.input)) as any, {
    logger: silentLogger,
  });
  await wrapped({ object: 'case', event: 'beforeUpdate', input: raw } as any);
}

describe('[#12601] the flat-input envelope wins consistently across get / descriptor / ownKeys / spread', () => {
  it('REPRODUCTION — `id`: all four instruments answer the envelope, and `input.data.id` still answers the payload', async () => {
    const raw: any = { data: { id: 'PAYLOAD-ID', subject: 'help' }, options: {}, id: 'WRAPPER-ID' };
    const seen: Record<string, unknown> = {};
    await runHook(raw, (input) => {
      seen.get = input.id;
      seen.descriptorValue = Object.getOwnPropertyDescriptor(input, 'id')?.value;
      seen.descriptorEnumerable = Object.getOwnPropertyDescriptor(input, 'id')?.enumerable;
      seen.ownKeysIncludes = Reflect.ownKeys(input).includes('id');
      seen.spread = { ...input }.id;
      seen.entries = Object.fromEntries(Object.entries(input)).id;
      seen.dataId = input.data.id;
    });

    // The conjunction is the contract: every instrument that answers a VALUE
    // for the reserved name answers the SAME value, and it is the envelope's.
    expect(seen.get).toBe('WRAPPER-ID');
    expect(seen.descriptorValue).toBe('WRAPPER-ID');
    expect(seen.spread).toBe('WRAPPER-ID');
    expect(seen.entries).toBe('WRAPPER-ID');
    // The key stays listed (unchanged from #12578 — `ownKeys` reports the
    // payload's own key set, and the payload really does own `id` here) and
    // enumerable, which is what lets spread/`Object.entries` carry it at all.
    expect(seen.ownKeysIncludes).toBe(true);
    expect(seen.descriptorEnumerable).toBe(true);
    // The payload's OWN value never vanished — it is exactly where the
    // ruling says it stays reachable.
    expect(seen.dataId).toBe('PAYLOAD-ID');
    // …and the persisted row is untouched by any of the above reads.
    expect(raw.data).toEqual({ id: 'PAYLOAD-ID', subject: 'help' });
  });

  it('`options`: a payload field named `options` is shadowed the same way', async () => {
    const raw: any = {
      data: { options: 'PAYLOAD-OPTIONS', subject: 'help' },
      options: { multi: true },
    };
    const seen: Record<string, unknown> = {};
    await runHook(raw, (input) => {
      seen.get = input.options;
      seen.descriptorValue = Object.getOwnPropertyDescriptor(input, 'options')?.value;
      seen.spread = { ...input }.options;
      seen.dataOptions = input.data.options;
    });

    expect(seen.get).toEqual({ multi: true });
    expect(seen.descriptorValue).toEqual({ multi: true });
    expect(seen.spread).toEqual({ multi: true });
    expect(seen.dataOptions).toBe('PAYLOAD-OPTIONS');
  });

  it('`data`: a payload field literally named `data` is shadowed by the whole payload bag', async () => {
    // `data` collides trivially in one direction — `target.data` (the bag
    // itself) always exists whenever a payload is present — but a payload
    // whose OWN field is named `data` is the case this card is actually
    // about: does a read of `input.data` mean "the bag" or "the bag's own
    // `data` field"? The ruling says: always the bag.
    const raw: any = { data: { data: 'PAYLOAD-NESTED-DATA', subject: 'help' }, options: {} };
    const seen: Record<string, unknown> = {};
    await runHook(raw, (input) => {
      seen.get = input.data;
      seen.descriptorValue = Object.getOwnPropertyDescriptor(input, 'data')?.value;
      seen.spread = { ...input }.data;
    });

    expect(seen.get).toEqual({ data: 'PAYLOAD-NESTED-DATA', subject: 'help' });
    expect(seen.descriptorValue).toEqual({ data: 'PAYLOAD-NESTED-DATA', subject: 'help' });
    expect(seen.spread).toEqual({ data: 'PAYLOAD-NESTED-DATA', subject: 'help' });
  });

  it('`ast`: the fourth reserved name follows the identical rule', async () => {
    const wrapperAst = { object: 'case', where: { id: 'ROW-1' } };
    const raw: any = { data: { ast: 'PAYLOAD-AST', subject: 'help' }, options: {}, ast: wrapperAst };
    const seen: Record<string, unknown> = {};
    await runHook(raw, (input) => {
      seen.get = input.ast;
      seen.descriptorValue = Object.getOwnPropertyDescriptor(input, 'ast')?.value;
      seen.spread = { ...input }.ast;
      seen.dataAst = input.data.ast;
    });

    expect(seen.get).toBe(wrapperAst);
    expect(seen.descriptorValue).toBe(wrapperAst);
    expect(seen.spread).toBe(wrapperAst);
    expect(seen.dataAst).toBe('PAYLOAD-AST');
  });

  it('EDGE CASE — the envelope has no `id` (insert-shaped) but the payload does: the reserved name resolves to absent, not to the payload value', async () => {
    // `get` never fell through to `data` for a reserved name, with or
    // without this fix — `Reflect.get(target, 'id', receiver)` on a wrapper
    // that never set `id` answers `undefined`, full stop. The descriptor
    // trap now agrees: no wrapper-owned `id` means no descriptor for `id`,
    // even though `ownKeys` (driven by `data` alone, unchanged) still lists
    // it — a proxy is free to answer `undefined` for a key its `ownKeys`
    // trap listed when the target (extensible, as this one always is) does
    // not itself own that key; `Object.keys`/spread silently skip a listed
    // key whose descriptor resolves to `undefined` rather than throwing.
    const raw: any = { data: { id: 'PAYLOAD-ID', subject: 'help' }, options: {} };
    const seen: Record<string, unknown> = {};
    await runHook(raw, (input) => {
      seen.get = input.id;
      seen.descriptor = Object.getOwnPropertyDescriptor(input, 'id');
      seen.ownKeysIncludes = Reflect.ownKeys(input).includes('id');
      seen.spreadHasId = 'id' in { ...input };
      seen.dataId = input.data.id;
    });

    expect(seen.get).toBeUndefined();
    expect(seen.descriptor).toBeUndefined();
    expect(seen.ownKeysIncludes).toBe(true);
    expect(seen.spreadHasId).toBe(false);
    expect(seen.dataId).toBe('PAYLOAD-ID');
  });

  it('POSITIVE CONTROL — a non-reserved payload key is untouched by any of this', async () => {
    const raw: any = { data: { id: 'PAYLOAD-ID', subject: 'help' }, options: {}, id: 'WRAPPER-ID' };
    const seen: Record<string, unknown> = {};
    await runHook(raw, (input) => {
      seen.get = input.subject;
      seen.descriptorValue = Object.getOwnPropertyDescriptor(input, 'subject')?.value;
      seen.ownKeysIncludes = Reflect.ownKeys(input).includes('subject');
      seen.spread = { ...input }.subject;
    });

    expect(seen.get).toBe('help');
    expect(seen.descriptorValue).toBe('help');
    expect(seen.ownKeysIncludes).toBe(true);
    expect(seen.spread).toBe('help');
  });

  it('DECLARED — the non-collision case is unchanged: wrapper keys stay out of enumeration when the payload does not share the name', async () => {
    // Same case `hook-input-ownkeys-agreement.test.ts` pins as a declared
    // exception; repeated here as a guardrail on THIS file's fix, since it
    // is the shape this fix could plausibly have broken by over-applying the
    // reserved-name branch.
    const raw: any = { data: { subject: 'help' }, options: { multi: false }, id: 'WRAPPER-ID' };
    const seen: Record<string, unknown> = {};
    await runHook(raw, (input) => {
      seen.ownKeysIncludes = Reflect.ownKeys(input).includes('id');
      seen.objectKeys = Object.keys(input);
      seen.readId = input.id;
      seen.descriptorEnumerable = Object.getOwnPropertyDescriptor(input, 'id')?.enumerable;
    });

    expect(seen.ownKeysIncludes).toBe(false);
    expect(seen.objectKeys).toEqual(['subject']);
    expect(seen.readId).toBe('WRAPPER-ID');
    expect(seen.descriptorEnumerable).toBe(false);
  });
});
