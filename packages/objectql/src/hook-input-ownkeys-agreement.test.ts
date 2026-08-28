// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12578] The flat-input Proxy's own-key ENUMERATION agrees with its other two
 * own-ness instruments, and with the row the engine persists.
 *
 * `installFlatInput` (`hook-wrappers.ts`) answered `ownKeys` from
 * `Object.keys(data)` — own **enumerable string** keys. The `enumerable`
 * filtering was incidental to what the trap is for (hiding the wrapper keys),
 * and it cost a key: an own NON-ENUMERABLE key on the payload was absent from
 * `Object.getOwnPropertyNames` / `Reflect.ownKeys` while `hasOwnProperty` and
 * the descriptor trap both reported it. Measured on the merged ref before the
 * repair, for `Object.defineProperty(ctx.input, 'k', { value: 1,
 * enumerable: false, configurable: true })` over a payload `{ subject }` the
 * engine then persisted holding BOTH keys:
 *
 * ```
 * Object.getOwnPropertyDescriptor(input, 'k')       -> own, enumerable:false
 * Object.prototype.hasOwnProperty.call(input, 'k')  -> true
 * Object.getOwnPropertyNames(input)                 -> ['subject']   <- not own?
 * Object.getOwnPropertyNames(raw.data)              -> ['subject','k']
 * ```
 *
 * Newly reachable, not newly written: #12277 routed `defineProperty` into
 * `data`, so a hook can put a non-default-attribute key on the payload for the
 * first time, and #12397 made the descriptor trap mirror `data` rather than
 * synthesise defaults — which is what gave the third instrument an opinion.
 *
 * ## What is pinned here, and why it is the AGREEMENT rather than one trap
 *
 * The contract these cases assert is not "`ownKeys` returns X". It is that the
 * three instruments an author can reach — the enumeration surfaces,
 * `hasOwnProperty`, and the descriptor trap — give the SAME answer about
 * own-ness for a given key, and that the answer is the one the persisted row
 * gives. A pin asserting a single trap's output in isolation is what let the
 * two halves diverge in the first place: #12397 pinned the descriptor trap and
 * this file's subject drifted out from under it, on the same trap set, in the
 * same file, within the same week.
 *
 * The settled spelling, stated once so the tree stops holding two answers:
 * **`ownKeys` reports the record payload's own key set, not its enumerable
 * subset.** Enumerability is applied by the CONSUMERS, one layer up and through
 * the descriptor trap, which is why the enumerable face below is unchanged.
 *
 * ## The two deliberate exceptions, pinned as exceptions
 *
 *  - WRAPPER KEYS (`id`/`options`/`ast`/`data`) stay out of the enumeration
 *    face while `hasOwnProperty` and the descriptor trap still report them.
 *    That disagreement is the trap's whole purpose (the payload-diff idiom must
 *    see record fields only) and is pinned as DECLARED so it cannot be mistaken
 *    for a residue of the defect above.
 *  - SYMBOL KEYS used to carry the identical disagreement, pinned open below:
 *    the write succeeded silently, persisted into `data`, and only the
 *    enumeration face omitted it. [#12603] The maintainer ruling (2026-08-27,
 *    Option C refusal arm) answered the payload-contract question this file
 *    left open: a record payload is a declarable, string-keyed field set, and
 *    no metadata schema can declare a symbol field. `set` and `defineProperty`
 *    now REFUSE a symbol-keyed write, loudly, before it ever reaches `data` —
 *    Option B (publish via `Reflect.ownKeys`) was declined, because it would
 *    have made the undeclarable key kind a published contract instead of
 *    closing it. The case below is INVERTED accordingly, in place: it used to
 *    pin the disagreement open, and now pins the refusal.
 *
 * `wrapDeclarativeHook` is driven directly rather than through `ObjectQL`, for
 * the reason the sibling trap-set files give: the subject is the wrapper's
 * Proxy, and a full engine dispatch would put a driver's own copy semantics
 * between the hook and the assertion.
 */

import { describe, it, expect } from 'vitest';
import { wrapDeclarativeHook } from './hook-wrappers.js';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * Run `handler` as a declarative hook over `raw` (the engine's own envelope);
 * the caller keeps `raw` and reads `raw.data` — the row the engine is left
 * holding — after the wrapper has restored `ctx.input`.
 */
async function runHook(raw: Record<string, unknown>, handler: (input: any) => void): Promise<void> {
  const meta: any = { name: 'ownkeys_probe', object: 'case', event: 'beforeInsert' };
  const wrapped = wrapDeclarativeHook(meta, (async (ctx: any) => handler(ctx.input)) as any, {
    logger: silentLogger,
  });
  await wrapped({ object: 'case', event: 'beforeInsert', input: raw } as any);
}

/**
 * The three instruments, read on ONE key through ONE object. The assertions
 * below compare this triple against itself — that is the contract — rather than
 * asserting any member on its own.
 */
function ownness(obj: any, key: string | symbol) {
  return {
    enumeration: Reflect.ownKeys(obj).includes(key),
    hasOwnProperty: Object.prototype.hasOwnProperty.call(obj, key),
    descriptor: Object.getOwnPropertyDescriptor(obj, key) !== undefined,
  };
}

/** All three instruments say "own". */
const OWN = { enumeration: true, hasOwnProperty: true, descriptor: true };
/** All three instruments say "not own". */
const NOT_OWN = { enumeration: false, hasOwnProperty: false, descriptor: false };

describe('[#12578] the flat-input `ownKeys` reports the payload own-key set, and the instruments agree', () => {
  it('REPRODUCTION — a key defined non-enumerable is own to all three instruments, and to the persisted row', async () => {
    // The card's repro, verbatim. Pre-fix the `enumeration` member of this
    // triple was `false` while the other two were `true`.
    const raw: any = { data: { subject: 'help' }, options: {} };
    let seen: ReturnType<typeof ownness> | undefined;
    let names: string[] | undefined;
    await runHook(raw, (input) => {
      Object.defineProperty(input, 'k', { value: 1, enumerable: false, configurable: true });
      seen = ownness(input, 'k');
      names = Object.getOwnPropertyNames(input);
    });

    expect(seen).toEqual(OWN);
    // The conjunction that makes it a contract and not three coincidences: the
    // proxy's own-key set IS the persisted payload's own-key set. Asserting
    // either side alone passes on a proxy whose halves disagree.
    expect(names).toEqual(Object.getOwnPropertyNames(raw.data));
    expect(names).toEqual(['subject', 'k']);
    // …and the payload really does carry it — the key is not an artefact of the
    // proxy face, it is on the row the driver receives.
    expect(ownness(raw.data, 'k')).toEqual(OWN);
  });

  it('the ENUMERABLE face is unchanged — Object.keys, spread, entries and JSON still omit it', async () => {
    // The other half of the repair, and the reason reporting the full own-key
    // set costs nothing downstream: every consumer that wants enumerability
    // filters for it ITSELF, through the descriptor trap, which mirrors `data`.
    // `unwrapProxyToPlain` (`packages/runtime/src/sandbox/body-runner.ts`) is
    // the consumer this protects — it snapshots the hook body's `ctx.input` as
    // `Object.entries` over this proxy, so the marshalled set is exactly what
    // it was before this card.
    const raw: any = { data: { subject: 'help' }, options: {} };
    const seen: Record<string, unknown> = {};
    await runHook(raw, (input) => {
      Object.defineProperty(input, 'hidden', { value: 1, enumerable: false, configurable: true });
      seen.objectKeys = Object.keys(input);
      seen.spread = Object.keys({ ...input });
      seen.entries = Object.entries(input).map(([k]) => k);
      seen.json = JSON.parse(JSON.stringify(input));
      // The full set, alongside, in the same breath: this is the ONE surface
      // pair whose answers legitimately differ, and they differ by exactly the
      // non-enumerable key.
      seen.ownNames = Object.getOwnPropertyNames(input);
    });

    expect(seen.objectKeys).toEqual(['subject']);
    expect(seen.spread).toEqual(['subject']);
    expect(seen.entries).toEqual(['subject']);
    expect(seen.json).toEqual({ subject: 'help' });
    expect(seen.ownNames).toEqual(['subject', 'hidden']);
  });

  it('agrees the other way: a key the payload does not hold is own to none of them', async () => {
    const raw: any = { data: { subject: 'help' }, options: {} };
    let seen: ReturnType<typeof ownness> | undefined;
    await runHook(raw, (input) => {
      seen = ownness(input, 'absent');
    });
    expect(seen).toEqual(NOT_OWN);
  });

  it('agrees on an ordinarily assigned key — the positive control', async () => {
    const raw: any = { data: {}, options: {} };
    let seen: ReturnType<typeof ownness> | undefined;
    await runHook(raw, (input) => {
      input.subject = 'help';
      seen = ownness(input, 'subject');
    });
    expect(seen).toEqual(OWN);
    expect(Object.getOwnPropertyNames(raw.data)).toEqual(['subject']);
  });

  it('DECLARED EXCEPTION — wrapper keys stay out of enumeration while the other two report them', async () => {
    // Not a residue of the defect: hiding `id`/`options`/`ast`/`data` from
    // `Object.keys`/`for-in` is what this trap exists for. Pinned so the
    // exception stays deliberate and visible.
    const raw: any = { data: { subject: 'help' }, options: { multi: false }, id: 'WRAPPER-ID' };
    const seen: Record<string, unknown> = {};
    await runHook(raw, (input) => {
      seen.options = ownness(input, 'options');
      seen.id = ownness(input, 'id');
      seen.ownNames = Object.getOwnPropertyNames(input);
      // Still reachable by the spellings the contract names — hidden from
      // enumeration is not hidden from the author.
      seen.readId = input.id;
      seen.readMulti = (input.options as any).multi;
    });

    expect(seen.options).toEqual({ enumeration: false, hasOwnProperty: true, descriptor: true });
    expect(seen.id).toEqual({ enumeration: false, hasOwnProperty: true, descriptor: true });
    expect(seen.ownNames).toEqual(['subject']);
    expect(seen.readId).toBe('WRAPPER-ID');
    expect(seen.readMulti).toBe(false);
  });

  it('[#12603] REFUSAL, not agreement — a symbol key is rejected before it can ever reach data', async () => {
    // INVERTS the OPEN QUESTION pin this case used to carry (verbatim, before
    // this card): `input[sym] = value` succeeded silently, persisted into
    // `data`, and only `Reflect.ownKeys`/`getOwnPropertySymbols` omitted it —
    // two instruments said own, enumeration said no, and the payload the
    // engine persisted held it regardless.
    //
    // Maintainer ruling, 2026-08-27, Option C refusal arm: a record payload is
    // a declarable, string-keyed field set — no metadata schema can declare a
    // symbol field, so the write is refused at the boundary instead of hidden
    // after it lands. There is no longer a persisted symbol key for the three
    // instruments to disagree about, so this is a refusal pin, not an
    // agreement pin — asserted for both traps the ruling names.
    const raw: any = { data: { subject: 'help' }, options: {} };
    const sym = Symbol.for('objectstack.test.12603');

    let setThrew: unknown;
    await runHook(raw, (input) => {
      try {
        input[sym] = 'symvalue';
      } catch (e) {
        setThrew = e;
      }
    });
    expect(setThrew).toBeInstanceOf(TypeError);
    const setMessage = (setThrew as TypeError).message;
    expect(setMessage).toMatch(/symbol/i); // names the key kind
    expect(setMessage).toMatch(/hook input/i); // names the surface
    // Refused BEFORE `data` is touched — nothing persisted, sibling field intact.
    expect(Object.getOwnPropertySymbols(raw.data)).toEqual([]);
    expect(raw.data.subject).toBe('help');

    let definePropertyThrew: unknown;
    await runHook(raw, (input) => {
      try {
        Object.defineProperty(input, sym, { value: 'dp-value', enumerable: true, configurable: true });
      } catch (e) {
        definePropertyThrew = e;
      }
    });
    expect(definePropertyThrew).toBeInstanceOf(TypeError);
    expect((definePropertyThrew as TypeError).message).toMatch(/symbol/i);
    expect(Object.getOwnPropertySymbols(raw.data)).toEqual([]);

    // The three instruments now agree there is no such key at all — the
    // refusal closes the disagreement this file otherwise exists to police.
    expect(ownness(raw.data, sym)).toEqual(NOT_OWN);
  });
});
