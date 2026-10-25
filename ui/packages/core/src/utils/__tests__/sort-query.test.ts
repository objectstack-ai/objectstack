/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `convertSortToQueryParams` — the shared sort→`$orderby` sink introduced with
 * objectstack#7137, when `object-timeline` and `record:line_items` gained sort
 * read sites and would otherwise have made a fifth and sixth private copy of the
 * conversion `ObjectGantt` / `ObjectMap` / `ObjectCalendar` each inline.
 *
 * Two of the cases below pin the two places this function is deliberately MORE
 * faithful to the declared contract than those copies: an entry with no `order`
 * is READ as ascending rather than dropped, and nothing usable yields
 * `undefined` rather than a truthy-but-empty `{}`.
 *
 * ⚠️ That first one is a RUNTIME tolerance, not an optional key. This header
 * used to call `SortConfig.order` "optional"; it is required on the interface,
 * on its zod counterpart and on `@objectstack/spec`'s `SortItemSchema`. Corrected
 * under objectui#9031, whose subject is the third copy of that same sentence —
 * the one the refusal diagnostic printed at authors.
 *
 * The rest pin objectui#8221 (director ruling, decision batch #77, option B):
 * the legacy string clause is RETIRED, and — this is the load-bearing half —
 * it is refused OUT LOUD. Types are erased, so the narrowed signature stops a
 * string only at compile time; authored JSON and stored metadata rows still
 * reach this function carrying `"name desc"`. A silent `undefined` there is an
 * authored row order that quietly stops applying, which is precisely the
 * failure this repository keeps measuring. Every refusal below is therefore
 * paired with a well-formed control that still lowers: a sink that refused
 * everything would satisfy the refusal assertions on its own.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// The INSTALLED published artifact, not a local mirror of it — this is the judge
// a publish actually uses, and objectui#9031 is about the diagnostic disagreeing
// with it. No `resolve.alias` entry covers `@objectstack/*`, so this specifier
// resolves to `node_modules`, which is the whole point of reading it here.
import { SortItemSchema } from '@objectstack/spec/shared';
import { convertSortToQueryParams, normalizeSortEntries, resetRetiredSortSpellingReports } from '../sort-query';

/** The retired spelling, reached the only way it still can be: at runtime. */
const asRuntimeValue = (value: unknown) => value as unknown as Parameters<typeof convertSortToQueryParams>[0];

describe('convertSortToQueryParams', () => {
  it('lowers a SortConfig[] preserving key order', () => {
    expect(
      convertSortToQueryParams([
        { field: 'stage', order: 'asc' },
        { field: 'amount', order: 'desc' },
      ]),
    ).toEqual({ stage: 'asc', amount: 'desc' });
    expect(
      Object.keys(
        convertSortToQueryParams([
          { field: 'stage', order: 'asc' },
          { field: 'amount', order: 'desc' },
        ])!,
      ),
    ).toEqual(['stage', 'amount']);
  });

  it('treats an entry with no `order` as ascending instead of dropping it', () => {
    // `$orderby`'s own declared shape is `Array<{ field: string; order?: … }>`,
    // so an omitted direction means ascending. The three private copies this
    // function replaces require both keys and drop such an entry, losing an
    // authored sort key.
    expect(convertSortToQueryParams([{ field: 'line_no' }])).toEqual({ line_no: 'asc' });
    expect(
      convertSortToQueryParams([{ field: 'line_no' }, { field: 'amount', order: 'desc' }]),
    ).toEqual({ line_no: 'asc', amount: 'desc' });
  });

  it('returns undefined — never an empty object — when nothing is orderable', () => {
    expect(convertSortToQueryParams(undefined)).toBeUndefined();
    expect(convertSortToQueryParams(null)).toBeUndefined();
    expect(convertSortToQueryParams([])).toBeUndefined();
    // Entries with no usable field name contribute nothing, and an all-unusable
    // array must not produce a truthy `{}` that a caller would send as $orderby.
    expect(convertSortToQueryParams([{ order: 'desc' }])).toBeUndefined();
    expect(convertSortToQueryParams([{ field: '' }])).toBeUndefined();
    // Shapes the schema types do not declare are refused, not guessed at.
    expect(convertSortToQueryParams(asRuntimeValue(42))).toBeUndefined();
    expect(convertSortToQueryParams(asRuntimeValue({ name: 'desc' }))).toBeUndefined();
  });
});

describe('convertSortToQueryParams — the retired string clause (objectui#8221)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The reporter dedupes per spelling in module state, so without this the
    // second test to assert a diagnostic would observe silence and pass for
    // entirely the wrong reason.
    resetRetiredSortSpellingReports();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('REFUSES every string spelling the retired arm used to lower', () => {
    // The four readings the retired arm implemented, one per line. Each now
    // yields no ordering at all rather than the map it used to build.
    for (const spelling of ['name desc', 'name asc', 'name', 'name DESC']) {
      resetRetiredSortSpellingReports();
      expect(convertSortToQueryParams(asRuntimeValue(spelling))).toBeUndefined();
    }

    // CONTROL — the array arm still lowers on the same function, so the
    // assertions above are a refusal of the string and not a dead sink.
    expect(convertSortToQueryParams([{ field: 'name', order: 'desc' }])).toEqual({ name: 'desc' });
  });

  it('names the array form in the diagnostic — the refusal is legible, not silent', () => {
    expect(convertSortToQueryParams(asRuntimeValue('name desc'))).toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0][0]);
    // The fix, not just the complaint: the message has to carry the spelling
    // the author must switch to, or it sends them looking for one.
    expect(message).toContain("[{ field: 'name', order: 'desc' }]");
    expect(message).toContain('retired');
    // It quotes what actually arrived, so the author can find it in their JSON.
    expect(message).toContain('"name desc"');
    // And it says the consequence out loud, because "refused" without "so your
    // rows are unordered" reads as a style note.
    expect(message).toContain('$orderby');
  });

  it('reports once per spelling — a render loop must not bury its own message', () => {
    convertSortToQueryParams(asRuntimeValue('name desc'));
    convertSortToQueryParams(asRuntimeValue('name desc'));
    convertSortToQueryParams(asRuntimeValue('name desc'));
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // CONTROL — a DIFFERENT retired spelling is a different authoring mistake
    // and still gets its own line, so the dedupe is per spelling and not a
    // one-message-ever latch.
    convertSortToQueryParams(asRuntimeValue('amount asc'));
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('stays silent for values that were never the retired spelling', () => {
    // An empty / absent `sort` is "the author asked for nothing", not "the
    // author used the retired clause" — reporting it would train readers to
    // ignore the message.
    expect(convertSortToQueryParams(asRuntimeValue(''))).toBeUndefined();
    expect(convertSortToQueryParams(undefined)).toBeUndefined();
    expect(convertSortToQueryParams(null)).toBeUndefined();
    // Nor for shapes that were never declared in either arm.
    expect(convertSortToQueryParams(asRuntimeValue(42))).toBeUndefined();
    expect(convertSortToQueryParams(asRuntimeValue({ name: 'desc' }))).toBeUndefined();
    // Nor for the arm that still works.
    expect(convertSortToQueryParams([{ field: 'name' }])).toEqual({ name: 'asc' });
    expect(errorSpy).not.toHaveBeenCalled();

    // CONTROL — the spy IS wired to this function: one retired spelling on the
    // same spy makes it fire, so the silence above is a reading and not a
    // disconnected mock.
    expect(convertSortToQueryParams(asRuntimeValue('   '))).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

/** Every `{ … }` entry the diagnostic quotes as the form the author must write. */
function entriesPrescribedBy(message: string): Array<Record<string, string>> {
  return (message.match(/\{[^{}]*\}/g) ?? []).map((literal) => {
    const entry: Record<string, string> = {};
    for (const [, key, value] of literal.matchAll(/(\w+)\s*:\s*'([^']*)'/g)) entry[key] = value;
    return entry;
  });
}

/**
 * objectui#9031 — what the refusal PRESCRIBES has to survive a publish.
 *
 * This text is read at the moment the author is ALREADY being corrected. It used
 * to end "`order` is optional and means `'asc'`" — a RUNTIME tolerance stated as
 * an AUTHORING permission — so an author who followed the correction verbatim was
 * refused a second time, at publish, by a different door, with no hint that the
 * advice itself was wrong.
 *
 * The judge here is `SortItemSchema` from the INSTALLED `@objectstack/spec`, and
 * it is fed the message's OWN prescription, parsed back out of the emitted
 * string. Re-typing the example into the test would only pin the test's copy of
 * it; the way this regresses is somebody shortening the example the diagnostic
 * quotes, and only reading the real message catches that.
 *
 * Every leg runs against a live refusal produced in the same run. That control
 * is not bookkeeping: without it, "the wrong sentence is gone" is satisfied just
 * as well by a diagnostic that stopped firing.
 */
describe('the refusal prescribes metadata `@objectstack/spec` ACCEPTS (objectui#9031)', () => {
  /** Drive one real refusal and hand back exactly what it printed. */
  const captureRefusal = (spelling = 'name desc'): string => {
    resetRetiredSortSpellingReports();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(convertSortToQueryParams(asRuntimeValue(spelling))).toBeUndefined();
      // LIVE CONTROL — the diagnostic FIRED, on this spy, in this run.
      expect(spy).toHaveBeenCalledTimes(1);
      return String(spy.mock.calls[0][0]);
    } finally {
      spy.mockRestore();
    }
  };

  it('every entry it tells the author to write is ACCEPTED by the installed spec', () => {
    const prescribed = entriesPrescribedBy(captureRefusal());
    // Anti-vacuity: a message quoting no entry at all would otherwise pass.
    expect(prescribed.length).toBeGreaterThan(0);
    for (const entry of prescribed) {
      const verdict = SortItemSchema.safeParse(entry);
      expect(verdict.success, `prescribed entry rejected by SortItemSchema: ${JSON.stringify(entry)}`).toBe(true);
    }
  });

  it('CONTROL — the judge can say no, and names the key it is judging', () => {
    // `{ field: 'name' }` is precisely what "`order` is optional" told authors to
    // write. The SAME schema refuses it, so the ACCEPT above is a reading and not
    // a schema that says yes to whatever it is handed.
    const noOrder = SortItemSchema.safeParse({ field: 'name' });
    expect(noOrder.success).toBe(false);
    expect(noOrder.error?.issues[0]?.path).toEqual(['order']);

    // …and it names `field` when `field` is the missing one, so it judges keys
    // rather than refusing every object.
    const noField = SortItemSchema.safeParse({ order: 'desc' });
    expect(noField.success).toBe(false);
    expect(noField.error?.issues[0]?.path).toEqual(['field']);
  });

  it('states the tolerance as a tolerance, never as an authoring permission', () => {
    const message = captureRefusal();
    // The defect, spelled out. ("is not optional" does not contain this.)
    expect(message).not.toContain('is optional');
    expect(message).toMatch(/`order` is required/);
    expect(message).toContain('SortItemSchema');

    // …and the other truth still stands. "Delete the sentence" was rejected by
    // name: a missing `order` really is read as ascending here, and a message
    // that denies it sends the author hunting a key nothing ever dropped.
    expect(message).toContain("`'asc'`");
    expect(message).toMatch(/runtime tolerance/);
  });

  it('BEHAVIOUR — the rewording moved nothing: same inputs refused, same channel', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const spelling of ['name desc', 'name asc', 'name', 'name DESC']) {
        resetRetiredSortSpellingReports();
        expect(convertSortToQueryParams(asRuntimeValue(spelling))).toBeUndefined();
      }
      // Same severity channel: `console.error`, never `console.warn`. A rewording
      // that also downgraded the channel would pass every text assertion above.
      expect(errorSpy).toHaveBeenCalledTimes(4);
      expect(warnSpy).not.toHaveBeenCalled();

      // CONTROL — the arm that still works lowers unchanged, and silently, so
      // the four refusals are a refusal of the string and not a dead sink.
      expect(convertSortToQueryParams([{ field: 'name', order: 'desc' }])).toEqual({ name: 'desc' });
      expect(convertSortToQueryParams([{ field: 'name' }])).toEqual({ name: 'asc' });
      expect(errorSpy).toHaveBeenCalledTimes(4);
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

/**
 * objectui#9955 — the retired string clause ONE CONTAINER DEEPER.
 *
 * The scalar `sort: 'name asc'` is refused out loud by the arm above. The same
 * clause written as `sort: ['name asc']` used to reach the array arm's skip,
 * leave through the same `undefined`, and print NOTHING — so two spellings of
 * one authoring mistake got opposite treatment, and the silent one lost an
 * authored row order with no trace in the console.
 *
 * ⛔ What this suite does NOT assert, deliberately, because objectui#8221's
 * ruling (decision batch #77, option B: one `sort` spelling, the array,
 * everywhere) forbids it: that `['name asc']` WORKS. It does not, and it must
 * not. Every case below pins `undefined` on the value side and a message on the
 * diagnostic side — loud is not accepted.
 *
 * ⭐ Control C is the load-bearing one. `[{ order: 'asc' }]` is ALSO an entry
 * that contributes nothing, and its silence is DECLARED in `normalizeSortEntries`'
 * docblock ("an entry with no usable `field` is SKIPPED"). If it started talking
 * too, the seam was cut at "entry has no field" instead of at
 * `typeof entry === 'string'`, and a designed silence would have been converted
 * into noise on every partially-authored view.
 */
describe('a retired string ENTRY of the `sort` array is REFUSED OUT LOUD (objectui#9955)', () => {
  /** The distinctive opening of the ENTRY message, per objectui#9955. */
  const ENTRY_REFUSAL = 'a `sort` ARRAY ENTRY is the retired string clause';
  /** The distinctive opening of the SCALAR message, unchanged by objectui#9955. */
  const SCALAR_REFUSAL = 'the legacy string `sort` clause is retired';

  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The dedupe is module state and this project runs `isolate: false`, so a
    // spelling another file already reported would make a "fired once"
    // assertion observe silence and pass for entirely the wrong reason.
    resetRetiredSortSpellingReports();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const messages = (): string[] => errorSpy.mock.calls.map((call: unknown[]) => String(call[0]));

  it('SUBJECT — an all-strings `sort` still orders nothing, and now says why', () => {
    expect(convertSortToQueryParams(asRuntimeValue(['name asc']))).toBeUndefined();
    expect(normalizeSortEntries(asRuntimeValue(['name asc']))).toBeUndefined();

    // ONE line, not one per call: the second call above is a second render of
    // the same bad view, which is the case the dedupe exists for.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = messages()[0];
    expect(message).toContain(ENTRY_REFUSAL);
    // It quotes what actually arrived, so the author can find it in their JSON…
    expect(message).toContain('"name asc"');
    // …names the ruling that retired it…
    expect(message).toContain('objectui#8221');
    // …and carries the fix rather than only the complaint.
    expect(message).toContain("[{ field: 'name', order: 'desc' }]");

    // Same severity channel as the scalar sibling. A refusal downgraded to
    // `console.warn` would satisfy every text assertion above.
    expect(warnSpy).not.toHaveBeenCalled();

    // CONTROL B — the declared spelling still lowers, on the same function, in
    // the same test body, and SILENTLY. Without it a sink that refused
    // everything would satisfy the subject on its own.
    expect(convertSortToQueryParams([{ field: 'name', order: 'desc' }])).toEqual({ name: 'desc' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('CONTROL C — the `field`-less OBJECT entry keeps its DESIGNED silence', () => {
    // Declared in `normalizeSortEntries`' docblock: an entry with no usable
    // `field` names nothing to order by, so it is skipped without comment. That
    // is not the defect objectui#9955 fixed and it must not become loud.
    expect(convertSortToQueryParams(asRuntimeValue([{ order: 'asc' }]))).toBeUndefined();
    expect(convertSortToQueryParams(asRuntimeValue([{ field: '' }]))).toBeUndefined();
    expect(convertSortToQueryParams(asRuntimeValue([null]))).toBeUndefined();
    expect(convertSortToQueryParams(asRuntimeValue([{ field: 42 }]))).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();

    // LIT CONTROL — the spy IS wired to this function in this run: a STRING
    // entry, which is the only seam objectui#9955 cut, makes it fire. The
    // silences above are therefore a reading and not a disconnected mock.
    expect(convertSortToQueryParams(asRuntimeValue(['name asc']))).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(messages()[0]).toContain(ENTRY_REFUSAL);
  });

  it('CONTROL A — the scalar arm is untouched, and the two messages differ', () => {
    // The pre-existing refusal, unchanged: same return, same channel, and the
    // sentence it could always say because refusing the WHOLE value refuses the
    // whole ordering.
    expect(convertSortToQueryParams(asRuntimeValue('name asc'))).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(messages()[0]).toContain(SCALAR_REFUSAL);
    expect(messages()[0]).not.toContain(ENTRY_REFUSAL);

    // …and the ENTRY arm says something ELSE, because one bad entry among good
    // ones does NOT mean the query carries no ordering. Sharing one raw dedupe
    // key between the arms would have silenced this second line entirely and
    // left the author reading a sentence about the wrong container.
    expect(convertSortToQueryParams(asRuntimeValue(['name asc']))).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(messages()[1]).toContain(ENTRY_REFUSAL);
    expect(messages()[1]).not.toContain(SCALAR_REFUSAL);
  });

  it('MIXED — the good entries still lower; only the string one is refused', () => {
    // ⭐ The reason the ENTRY message may not reuse the scalar text: this query
    // DOES carry an `$orderby`. Telling the author their rows are unordered
    // would send them hunting for a loss that did not happen.
    expect(
      convertSortToQueryParams(asRuntimeValue([{ field: 'a', order: 'asc' }, 'b desc'])),
    ).toEqual({ a: 'asc' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(messages()[0]).toContain('"b desc"');

    // CONTROL — the SAME array with the string entry removed answers the SAME
    // map and prints nothing new. That is what makes the line above a refusal
    // of `'b desc'` and not a side effect of the surviving entry.
    expect(convertSortToQueryParams([{ field: 'a', order: 'asc' }])).toEqual({ a: 'asc' });
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // Authored position survives too — the refused entry is skipped, not
    // shifted onto a neighbour.
    expect(
      normalizeSortEntries(
        asRuntimeValue(['x asc', { field: 'a', order: 'desc' }, 'y asc', { field: 'b' }]),
      ),
    ).toEqual([
      { field: 'a', order: 'desc' },
      { field: 'b', order: 'asc' },
    ]);
  });

  it('ACCEPTED INPUT SET UNCHANGED — the string entry contributes exactly nothing', () => {
    // objectui#8221 option B is a ruling, not a preference: `['name asc']` may
    // NOT start working. Every pair below is the same array with and without
    // its string entries, and the two sides must answer identically.
    const pairs: Array<[unknown, unknown]> = [
      [['name asc'], []],
      [[{ field: 'a', order: 'asc' }, 'b desc'], [{ field: 'a', order: 'asc' }]],
      [['a asc', { field: 'b' }, 'c desc'], [{ field: 'b' }]],
      [['name'], []],
      [[''], []],
    ];
    for (const [withStrings, withoutStrings] of pairs) {
      resetRetiredSortSpellingReports();
      expect(convertSortToQueryParams(asRuntimeValue(withStrings))).toEqual(
        convertSortToQueryParams(asRuntimeValue(withoutStrings)),
      );
      expect(normalizeSortEntries(asRuntimeValue(withStrings))).toEqual(
        normalizeSortEntries(asRuntimeValue(withoutStrings)),
      );
    }

    // CONTROL — the comparison can fail: an array whose string entry WERE
    // honoured would differ from its string-free twin, so the equalities above
    // are not vacuous.
    expect(convertSortToQueryParams(asRuntimeValue(['name asc']))).not.toEqual({ name: 'asc' });
    expect(convertSortToQueryParams([{ field: 'name', order: 'asc' }])).toEqual({ name: 'asc' });
  });

  it("the `''` entry keeps the scalar arm's silence — symmetry, not an exception", () => {
    // `sort: ''` never reaches the loud scalar arm either: the `!sort` guard
    // answers first, and its pin says so in words — an empty spelling is "the
    // author asked for nothing", and reporting it would train readers to ignore
    // the message. The entry arm mirrors that rather than inverting it.
    expect(convertSortToQueryParams(asRuntimeValue(['']))).toBeUndefined();
    expect(convertSortToQueryParams(asRuntimeValue(''))).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();

    // CONTROL — whitespace is NOT in that carve-out. `'   '` is truthy, is loud
    // on the scalar arm today, and is loud as an entry too; so the two silences
    // above are about EMPTINESS and not about the entry arm having gone quiet.
    expect(convertSortToQueryParams(asRuntimeValue(['   ']))).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(messages()[0]).toContain(ENTRY_REFUSAL);
    expect(convertSortToQueryParams(asRuntimeValue('   '))).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(messages()[1]).toContain(SCALAR_REFUSAL);
  });

  it('BOUNDED — N blocks inheriting one bad view print ONE line, per spelling', () => {
    // The sink runs inside the query memo of every object-bound block, so an
    // object with N related lists re-enters it N times per pass. The dedupe is
    // what keeps the prescription readable instead of burying itself.
    for (let block = 0; block < 25; block += 1) {
      expect(convertSortToQueryParams(asRuntimeValue(['name asc']))).toBeUndefined();
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // CONTROL — it is a dedupe per SPELLING, not a one-message-ever latch: a
    // different bad entry is a different authoring mistake and still gets its
    // own line.
    expect(convertSortToQueryParams(asRuntimeValue(['amount desc']))).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(2);

    // …and the reset seam really does clear it, so the bound above is the
    // dedupe and not an exhausted spy.
    resetRetiredSortSpellingReports();
    expect(convertSortToQueryParams(asRuntimeValue(['name asc']))).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  it('objectui#9031 — the ENTRY message prescribes metadata the installed spec ACCEPTS', () => {
    // Same judge, same reason as the scalar message's pin: this text is read at
    // the moment the author is ALREADY being corrected, so an example that
    // omitted `order` would get them refused a second time, at publish, by a
    // different door. The entries are parsed back out of the REAL emitted
    // string — re-typing the example here would only pin the test's copy.
    expect(convertSortToQueryParams(asRuntimeValue(['name asc']))).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = messages()[0];

    const prescribed = entriesPrescribedBy(message);
    // Anti-vacuity: a message quoting no entry at all would otherwise pass.
    expect(prescribed.length).toBeGreaterThan(0);
    for (const entry of prescribed) {
      const verdict = SortItemSchema.safeParse(entry);
      expect(verdict.success, `prescribed entry rejected by SortItemSchema: ${JSON.stringify(entry)}`).toBe(true);
    }

    // Both halves objectui#9031 ruled load-bearing survive in this arm too.
    expect(message).not.toContain('is optional');
    expect(message).toMatch(/`order` is required/);
    expect(message).toContain('SortItemSchema');
    expect(message).toContain("`'asc'`");
    expect(message).toMatch(/runtime tolerance/);

    // CONTROL — the judge can say no, so the ACCEPTs above are a reading.
    expect(SortItemSchema.safeParse({ field: 'name' }).success).toBe(false);
  });
});

/**
 * `normalizeSortEntries` — the decision `convertSortToQueryParams` was built
 * on, lifted out so a block that sends a DIFFERENT wire shape can share it
 * (objectui#8973).
 *
 * `object-grid` sends a `"field order"` join string, not this module's map, and
 * moving it onto the map is route B on objectui#8767 — declined by the
 * maintainer on 2026-09-10 pending its own card. It re-implemented the "which
 * entries survive, what does a missing `order` mean" decision privately and got
 * it wrong (`$orderby: 'name undefined'`). Exporting the decision without the
 * map is what lets the two agree without the shape moving.
 *
 * The second describe below is the load-bearing half: the map builder is now a
 * projection of this function, so every case must answer exactly what it
 * answered when it was a single loop. A refactor that quietly changed the map
 * would be a wire change in `object-calendar`, `object-gantt`, `object-map`,
 * `object-timeline` and `record:line_items` at once.
 */
describe('normalizeSortEntries (objectui#8973)', () => {
  it('fills a missing `order` with `asc` rather than dropping the key', () => {
    expect(normalizeSortEntries([{ field: 'name' }])).toEqual([{ field: 'name', order: 'asc' }]);
  });

  it('preserves authored order and keeps duplicates as separate entries', () => {
    // The map projection collapses these; the entry list deliberately does not,
    // because a join-string caller must be able to see what it was handed.
    expect(
      normalizeSortEntries([
        { field: 'stage', order: 'desc' },
        { field: 'stage', order: 'asc' },
      ]),
    ).toEqual([
      { field: 'stage', order: 'desc' },
      { field: 'stage', order: 'asc' },
    ]);
  });

  it('skips entries that name no usable field', () => {
    expect(normalizeSortEntries([{ order: 'desc' }, { field: '' }, { field: 'name' }])).toEqual([
      { field: 'name', order: 'asc' },
    ]);
  });

  it('normalizes a garbage direction to `asc` instead of forwarding it', () => {
    expect(normalizeSortEntries([{ field: 'name', order: 'DESCENDING' as never }])).toEqual([
      { field: 'name', order: 'asc' },
    ]);
  });

  it('answers `undefined`, never `[]`, so a caller can omit the query key', () => {
    expect(normalizeSortEntries([])).toBeUndefined();
    expect(normalizeSortEntries([{ order: 'desc' }])).toBeUndefined();
    expect(normalizeSortEntries(undefined)).toBeUndefined();
    expect(normalizeSortEntries(null)).toBeUndefined();
  });

  it('refuses a retired string clause with the SAME reporter, not a second one', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      resetRetiredSortSpellingReports();
      expect(normalizeSortEntries(asRuntimeValue('name desc'))).toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toContain('objectui#8221');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('convertSortToQueryParams — REGRESSION PIN: the refactor moved no behaviour', () => {
  // The `array of strings` case below drives a REAL refusal since objectui#9955,
  // so this pin would otherwise print a diagnostic into the run's output. The
  // spy only silences it: every expectation here is on the RETURN value, which
  // objectui#9955 left untouched — that is the whole point of the pin.
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetRetiredSortSpellingReports();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  /**
   * Expected values were captured from the PRE-REFACTOR implementation (the
   * single map-building loop) and are written out as LITERALS on purpose.
   * Deriving them from `normalizeSortEntries` would only prove the projection
   * is self-consistent — it would pass just as happily if both halves had moved
   * together, which is exactly the regression that matters: this map is the
   * `$orderby` of `object-calendar`, `object-gantt`, `object-map`,
   * `object-timeline` and `record:line_items`.
   */
  const CASES: Array<[string, unknown, Record<string, 'asc' | 'desc'> | undefined]> = [
    ['fully specified', [{ field: 'stage', order: 'asc' }, { field: 'amount', order: 'desc' }], { stage: 'asc', amount: 'desc' }],
    ['order omitted means asc', [{ field: 'name' }], { name: 'asc' }],
    ['field omitted is skipped', [{ order: 'desc' }], undefined],
    ['empty field is skipped', [{ field: '' }], undefined],
    ['duplicate field collapses last-wins', [{ field: 'stage', order: 'desc' }, { field: 'stage', order: 'asc' }], { stage: 'asc' }],
    ['empty array yields undefined', [], undefined],
    ['array of strings yields undefined', ['name desc'], undefined],
    ['null entry is skipped', [null], undefined],
    ['garbage direction normalizes to asc', [{ field: 'name', order: 'sideways' }], { name: 'asc' }],
    ['undefined', undefined, undefined],
    ['null', null, undefined],
    ['a number', 42, undefined],
    ['a bare unwrapped node', { field: 'name', order: 'desc' }, undefined],
  ];

  it.each(CASES)('%s', (_label, input, expected) => {
    const actual = convertSortToQueryParams(asRuntimeValue(input));
    expect(actual).toEqual(expected);
    // Key ORDER is part of this map's contract (the first test in this file
    // pins it), and `toEqual` does not compare it.
    expect(actual && Object.keys(actual)).toEqual(expected && Object.keys(expected));
  });

  it('CONTROL — the pin can fail: a deliberately wrong expectation is rejected', () => {
    expect(convertSortToQueryParams([{ field: 'name' }])).not.toEqual({ name: 'desc' });
  });
});
