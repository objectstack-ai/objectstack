/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

// The `warn` spies below are typed `MockInstance<typeof console.warn>` rather
// than `ReturnType<typeof vi.spyOn>`: the latter is the un-instantiated
// `MockInstance<Procedure | Constructable>`, whose `mock.calls` carries no
// argument types, leaving every `(c) => String(c[0])` callback an implicit
// `any` (objectui#4040).
import {
  evalRowPredicate,
  resolveConditionalFormatting,
  isLegacyDialectSource,
} from '../listConditional';

describe('isLegacyDialectSource', () => {
  it('flags legacy-only syntax', () => {
    expect(isLegacyDialectSource('${data.x > 1}')).toBe(true);
    expect(isLegacyDialectSource("status === 'active'")).toBe(true);
    expect(isLegacyDialectSource('status !== 1')).toBe(true);
    expect(isLegacyDialectSource('record.name?.length')).toBe(true);
    expect(isLegacyDialectSource('a ?? b')).toBe(true);
    expect(isLegacyDialectSource("name.includes('x')")).toBe(true);
  });

  it('treats canonical CEL as non-legacy', () => {
    expect(isLegacyDialectSource("record.status == 'active'")).toBe(false);
    expect(isLegacyDialectSource("status in ['a', 'b']")).toBe(false);
    expect(isLegacyDialectSource("name.contains('x')")).toBe(false);
    expect(isLegacyDialectSource('a && b || c')).toBe(false);
  });
});

describe('evalRowPredicate', () => {
  it('evaluates a canonical CEL predicate over the row (`record.*`; the bare shorthand retired in objectui#5741)', () => {
    expect(evalRowPredicate("record.status == 'active'", { status: 'active' })).toBe(true);
    expect(evalRowPredicate("record.status == 'active'", { status: 'closed' })).toBe(false);
    // The bare shorthand is unbound: it faults into the fallback on EITHER row.
    expect(evalRowPredicate("status == 'active'", { status: 'active' })).toBe(false);
    expect(evalRowPredicate("status == 'active'", { status: 'closed' })).toBe(false);
  });

  it('supports the CEL `in` operator (which the legacy engine lacks)', () => {
    expect(evalRowPredicate("record.status in ['sent', 'paid']", { status: 'paid' })).toBe(true);
    expect(evalRowPredicate("record.status in ['sent', 'paid']", { status: 'draft' })).toBe(false);
  });

  it('always evaluates an { dialect: cel } envelope on the CEL engine (never legacy)', () => {
    expect(
      evalRowPredicate({ dialect: 'cel', source: "record.status == 'active'" }, { status: 'active' }),
    ).toBe(true);
  });

  it('binds an extra scope (features/user) alongside the row', () => {
    expect(
      evalRowPredicate('features.canEdit == true', { id: '1' }, {
        scope: { features: { canEdit: true } },
      }),
    ).toBe(true);
    expect(
      evalRowPredicate("record.id == user.id", { id: 'u1' }, { scope: { user: { id: 'u1' } } }),
    ).toBe(true);
  });

  it('returns the fallback for an absent or empty predicate', () => {
    expect(evalRowPredicate(undefined, { a: 1 }, { fallback: true })).toBe(true);
    expect(evalRowPredicate(null, { a: 1 }, { fallback: false })).toBe(false);
    expect(evalRowPredicate('   ', { a: 1 }, { fallback: true })).toBe(true);
  });

  it('fails to the fallback on a broken predicate — loudly, once (#5149)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(evalRowPredicate('record.status ==', { status: 'x' }, { fallback: false })).toBe(false);
      expect(evalRowPredicate('record.status ==', { status: 'x' }, { fallback: true })).toBe(true);
      // The single-eval fast path is no longer silent: the canonical helper
      // itself warned — once, despite two evaluations of the same text.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('failed to evaluate');
    } finally {
      warn.mockRestore();
    }
  });

  describe('legacy-dialect routing', () => {
    let warn: MockInstance<typeof console.warn>;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    it('routes a `${…}` template string to the legacy engine and warns once', () => {
      expect(evalRowPredicate('${record.status === "active"}', { status: 'active' })).toBe(true);
      expect(evalRowPredicate('${record.status === "active"}', { status: 'closed' })).toBe(false);
      // Same source warns only once.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('legacy expression dialect');
    });

    it('routes a bare `===` string to the legacy engine', () => {
      expect(evalRowPredicate("record.status === 'active'", { status: 'active' })).toBe(true);
    });

    it('a legacy `${data.x}` / `${x}` string on a row surface retired with the CEL spellings (objectui#5741)', () => {
      // One scope shape per surface, both dialects: `data` and the bare name
      // are unbound on the legacy path too, so these fault into the fallback
      // on either row — the same verdict on a matching and a non-matching one.
      for (const pred of ['${data.status === "active"}', '${status === "active"}', "status === 'active'"]) {
        expect(evalRowPredicate(pred, { status: 'active' }), pred).toBe(false);
        expect(evalRowPredicate(pred, { status: 'closed' }), pred).toBe(false);
        expect(evalRowPredicate(pred, { status: 'active' }, { fallback: true }), pred).toBe(true);
      }
    });
  });

  describe('warnOnError (fail-closed row actions)', () => {
    let warn: MockInstance<typeof console.warn>;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    it('warns and returns the fallback when a present predicate faults', () => {
      const r = evalRowPredicate('record.status ==', { status: 'x' }, {
        fallback: false,
        warnOnError: true,
        label: 'resume',
      });
      expect(r).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('failed to evaluate');
    });

    it('does NOT warn on a genuine false', () => {
      const r = evalRowPredicate("record.status == 'active'", { status: 'closed' }, {
        fallback: false,
        warnOnError: true,
      });
      expect(r).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    });

    // The warning is deduped per (label, source) pair. These two pin the two
    // halves of that contract across the objectstack#5450 key change: the key
    // used to be the pair joined on a raw U+0000 byte (which is what made this
    // file invisible to grep) and is now JSON.stringify of the pair.
    it('warns only once for the same (label, source) pair', () => {
      const faulty = 'record.dedupe_once ==';
      evalRowPredicate(faulty, { a: 1 }, { warnOnError: true, label: 'twice' });
      evalRowPredicate(faulty, { a: 2 }, { warnOnError: true, label: 'twice' });
      expect(warn).toHaveBeenCalledTimes(1);
    });

    // objectui#3792. The fail-closed route runs the canonical helper twice with
    // `warn: false` (to tell a fault from a genuine `false`), which used to
    // discard the engine's own description of the failure — so the surfaces
    // that hide a button outright were the ones that said least about why.
    it("carries the ENGINE's failure reason into the fail-closed warning", () => {
      const r = evalRowPredicate('record.absent.deep == 1', { status: 'x' }, {
        fallback: false,
        warnOnError: true,
        label: 'resume',
      });
      expect(r).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0][0]);
      expect(msg).toContain('(resume)');
      // The reason is the engine's verbatim text, not a rephrasing of it: kind
      // tag and message both, exactly as the single-eval fast path prints them.
      expect(msg).toContain('Reason: [runtime] No such key: absent');
    });

    it('carries an unbound-root reason too (the typo class this exists for)', () => {
      evalRowPredicate('nosuchroot.x == 1', { status: 'x' }, {
        fallback: false,
        warnOnError: true,
        label: 'unbound',
      });
      expect(String(warn.mock.calls[0][0])).toContain('Reason: [type] Unknown variable: nosuchroot');
    });

    it('reports the legacy path fault with the legacy engine reason', () => {
      // `===` routes to the legacy engine, which reports by throwing; the
      // fail-closed report carries that message for the same reason.
      evalRowPredicate('record.a === $$$', { a: 1 }, {
        fallback: false,
        warnOnError: true,
        label: 'legacy-fault',
      });
      const failure = warn.mock.calls
        .map((c) => String(c[0]))
        .find((m) => m.includes('failed to evaluate'));
      expect(failure).toBeDefined();
      expect(failure).toContain('(legacy-fault)');
      expect(failure).toContain('Reason: [legacy]');
    });

    // The other half of objectui#3792: this function stopped being list-only
    // long ago — kanban formatting, the bulk selection bar and (since #3521)
    // `page:header` all report through it. Naming every surface "list" sends a
    // page-header author to the list view to look for a button that was never
    // there.
    it('names the surface neutrally — never "list conditional predicate"', () => {
      evalRowPredicate('record.absent.wording == 1', { a: 1 }, {
        warnOnError: true,
        label: 'page:header/publish',
      });
      evalRowPredicate('${data.wording === "x"}', { a: 1 });
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.length).toBeGreaterThanOrEqual(2);
      for (const msg of messages) {
        expect(msg).not.toContain('list conditional predicate');
        expect(msg).toContain('[object-ui] A conditional predicate');
      }
    });

    it('keeps the label/source boundary unambiguous', () => {
      // The obvious repair for an "impossible character" separator is to pick a
      // printable one, which merely relocates the collision. These two pairs
      // share a label+source CONCATENATION and would collapse into one key under
      // a space separator, so the second warning would be swallowed. JSON needs
      // no impossible character and no such assumption.
      evalRowPredicate('beta record.boundary ==', { a: 1 }, { warnOnError: true, label: 'alpha' });
      evalRowPredicate('record.boundary ==', { a: 1 }, { warnOnError: true, label: 'alpha beta' });
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0][0])).toContain('(alpha)');
      expect(String(warn.mock.calls[1][0])).toContain('(alpha beta)');
    });
  });
});

/**
 * objectui#3796 — the row is this function's SUBJECT, on both dialect paths.
 *
 * `data` was already pinned after the host-scope spread; `record` was not, and
 * leaned on each engine's own binding instead — which disagreed. The legacy
 * evaluator re-pinned `record` (row won); the CEL engine takes its `extra` bag
 * over its `record` binding (host scope won). So one predicate text meant two
 * different things depending on whether it happened to contain `===`/`${…}`,
 * the marker that routes dialects — something no author selects deliberately.
 *
 * No host injects a `record` key today (`ExpressionProvider` binds
 * `current_user`/`user`/`ctx`/`os`/`data`/`features` — `app` was unbound by
 * objectui#8155), so this is a pin
 * against a plausible future addition — `ctx.record` already exists — not a
 * live bug repro. It is one test on purpose: the two paths' precedence is a
 * single contract, and pinning them apart is what let them drift.
 */
describe('evalRowPredicate — row wins over host scope (both dialect paths)', () => {
  const ROW = { tag: 'ROW' };
  // A host scope carrying a decoy `record` (and `data`, already protected).
  const DECOY = { record: { tag: 'SCOPE' }, data: { tag: 'SCOPE' }, features: { on: true } };

  it('binds `record` to the row on the CEL path AND the legacy path', () => {
    // CEL (canonical): no legacy marker in the source.
    expect(evalRowPredicate("record.tag == 'ROW'", ROW, { scope: DECOY })).toBe(true);
    expect(evalRowPredicate("record.tag == 'SCOPE'", ROW, { scope: DECOY })).toBe(false);

    // Legacy: `===` routes to the other engine — same subject, same verdicts.
    expect(evalRowPredicate("record.tag === 'ROW'", ROW, { scope: DECOY })).toBe(true);
    expect(evalRowPredicate("record.tag === 'SCOPE'", ROW, { scope: DECOY })).toBe(false);
  });

  it('no longer binds `data` or the bare name to the row — on either path (objectui#5741)', () => {
    // `data` is the HOST's own now: the decoy answers, on both dialect paths.
    expect(evalRowPredicate("data.tag == 'SCOPE'", ROW, { scope: DECOY })).toBe(true);
    expect(evalRowPredicate("data.tag === 'SCOPE'", ROW, { scope: DECOY })).toBe(true);
    expect(evalRowPredicate("data.tag == 'ROW'", ROW, { scope: DECOY })).toBe(false);
    expect(evalRowPredicate("data.tag === 'ROW'", ROW, { scope: DECOY })).toBe(false);
    // The bare name is bound nowhere: it faults into the fallback on both paths.
    expect(evalRowPredicate("tag == 'ROW'", ROW, { scope: DECOY })).toBe(false);
    expect(evalRowPredicate("tag === 'ROW'", ROW, { scope: DECOY })).toBe(false);
    expect(evalRowPredicate("tag == 'ROW'", ROW, { scope: DECOY, fallback: true })).toBe(true);
    expect(evalRowPredicate("tag === 'ROW'", ROW, { scope: DECOY, fallback: true })).toBe(true);
  });

  it('still resolves host-scope keys the row does not shadow', () => {
    // The row winning is not the scope being dropped: background stays bound.
    expect(evalRowPredicate('features.on == true', ROW, { scope: DECOY })).toBe(true);
    expect(evalRowPredicate('features.on === true', ROW, { scope: DECOY })).toBe(true);
  });

  it('holds on the fail-closed route as well as the fast route', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        evalRowPredicate("record.tag == 'ROW'", ROW, { scope: DECOY, warnOnError: true, fallback: false }),
      ).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('a row FIELD named `record` does not become the subject either', () => {
    // `record` is the row's one root, so a column literally called `record` is
    // addressable as `record.record`, never as the row root (objectui#5741: the
    // `data.record` spelling it used to have retired with `data.*`).
    const row = { record: { tag: 'FIELD' }, tag: 'ROW' };
    expect(evalRowPredicate("record.tag == 'ROW'", row, { scope: DECOY })).toBe(true);
    expect(evalRowPredicate("record.record.tag == 'FIELD'", row, { scope: DECOY })).toBe(true);
    expect(evalRowPredicate("data.record.tag == 'FIELD'", row, { scope: DECOY })).toBe(false);
  });

  it('applies through conditional formatting, which shares the entry point', () => {
    expect(
      resolveConditionalFormatting(ROW, [{ condition: "record.tag == 'ROW'", backgroundColor: 'row' }], DECOY),
    ).toEqual({ backgroundColor: 'row' });
    expect(
      resolveConditionalFormatting(ROW, [{ condition: "record.tag == 'SCOPE'", backgroundColor: 'scope' }], DECOY),
    ).toEqual({});
  });
});

describe('resolveConditionalFormatting', () => {
  it('returns {} for empty / missing rules', () => {
    expect(resolveConditionalFormatting({ a: 1 }, undefined)).toEqual({});
    expect(resolveConditionalFormatting({ a: 1 }, [])).toEqual({});
  });

  it('spec shape { condition, style } — CEL predicate', () => {
    expect(
      resolveConditionalFormatting({ status: 'overdue' }, [
        { condition: "record.status == 'overdue'", style: { backgroundColor: '#fee2e2', color: '#991b1b' } },
      ]),
    ).toEqual({ backgroundColor: '#fee2e2', color: '#991b1b' });
    expect(
      resolveConditionalFormatting({ status: 'ok' }, [
        { condition: "record.status == 'overdue'", style: { backgroundColor: '#fee2e2' } },
      ]),
    ).toEqual({});
  });

  it('native shape { field, operator, value } — translated to CEL', () => {
    const rules = [
      { field: 'status', operator: 'equals' as const, value: 'active', backgroundColor: '#e0ffe0' },
    ];
    expect(resolveConditionalFormatting({ status: 'active' }, rules)).toEqual({ backgroundColor: '#e0ffe0' });
    expect(resolveConditionalFormatting({ status: 'inactive' }, rules)).toEqual({});
  });

  it('native operators: not_equals / greater_than / less_than / contains / in', () => {
    expect(
      resolveConditionalFormatting({ n: 5 }, [{ field: 'n', operator: 'greater_than', value: 3, textColor: 'red' }]),
    ).toEqual({ color: 'red' });
    expect(
      resolveConditionalFormatting({ n: 5 }, [{ field: 'n', operator: 'less_than', value: 3, textColor: 'red' }]),
    ).toEqual({});
    expect(
      resolveConditionalFormatting({ s: 'hello world' }, [
        { field: 's', operator: 'contains', value: 'world', borderColor: '#000' },
      ]),
    ).toEqual({ borderColor: '#000' });
    expect(
      resolveConditionalFormatting({ tier: 'gold' }, [
        { field: 'tier', operator: 'in', value: ['gold', 'platinum'], backgroundColor: 'gold' },
      ]),
    ).toEqual({ backgroundColor: 'gold' });
    expect(
      resolveConditionalFormatting({ tier: 'bronze' }, [
        { field: 'tier', operator: 'not_equals', value: 'bronze', backgroundColor: 'x' },
      ]),
    ).toEqual({});
  });

  it('first matching rule wins', () => {
    const rules = [
      { condition: "record.n > 100", style: { backgroundColor: 'red' } },
      { condition: "record.n > 10", style: { backgroundColor: 'orange' } },
    ];
    expect(resolveConditionalFormatting({ n: 50 }, rules)).toEqual({ backgroundColor: 'orange' });
    expect(resolveConditionalFormatting({ n: 500 }, rules)).toEqual({ backgroundColor: 'red' });
  });

  it('color props override the base style map', () => {
    expect(
      resolveConditionalFormatting({ ok: true }, [
        {
          condition: 'record.ok == true',
          style: { backgroundColor: 'base', fontWeight: 'bold' },
          backgroundColor: 'override',
          textColor: 'blue',
        },
      ]),
    ).toEqual({ backgroundColor: 'override', fontWeight: 'bold', color: 'blue' });
  });

  it('a rule whose field is missing from the record fails soft (no style) — warning once with the rule locator (#5149)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        resolveConditionalFormatting({ other: 1 }, [
          { field: 'status', operator: 'equals', value: 'active', backgroundColor: 'x' },
        ]),
      ).toEqual({});
      // The formatting fast path threads its label into the canonical
      // helper's one-time warning, so the broken rule is locatable.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('(conditionalFormatting[0])');
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * The relation binding (objectui#3501): with the payload as delivered, whether
 * `record.<lookup>` is an id or a whole record is decided by whether THIS
 * surface happened to expand that column — a display decision no predicate
 * author participates in. Supplying the object's fields collapses the expanded
 * form back to the id, which is what the server's CEL engine sees.
 */
describe('evalRowPredicate — relation fields', () => {
  const FIELDS = {
    title: { type: 'text' },
    owner: { type: 'user' },
    account: { type: 'lookup', reference: 'accounts' },
    config: { type: 'json' },
  };
  const SCOPE = { os: { user: { id: 'U1' } } };

  it('an EXPANDED relation compares equal to the id it stands for', () => {
    const expanded = { owner: { id: 'U1', name: 'Ada' } };

    // Without the schema this is the reported bug: false for the very user the
    // record belongs to, with no error to notice.
    expect(evalRowPredicate('record.owner == os.user.id', expanded, { scope: SCOPE })).toBe(false);
    expect(
      evalRowPredicate('record.owner == os.user.id', expanded, { scope: SCOPE, fields: FIELDS }),
    ).toBe(true);
  });

  it('an UNEXPANDED relation reaches the same verdict — one predicate, one answer', () => {
    const plain = { owner: 'U1' };

    expect(evalRowPredicate('record.owner == os.user.id', plain, { scope: SCOPE, fields: FIELDS })).toBe(true);
    expect(evalRowPredicate('record.owner == os.user.id', plain, { scope: SCOPE })).toBe(true);
  });

  it('an EMPTY relation is a clean false, not a fault', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      evalRowPredicate('record.owner == os.user.id', { owner: null }, {
        scope: SCOPE, fields: FIELDS, warnOnError: true,
      }),
    ).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('binds the collapsed value under `record.` only — the bare and `data.` spellings retired (objectui#5741)', () => {
    const expanded = { account: { id: 'A1', name: 'Acme' } };

    expect(evalRowPredicate('record.account == "A1"', expanded, { fields: FIELDS })).toBe(true);
    expect(evalRowPredicate('account == "A1"', expanded, { fields: FIELDS })).toBe(false);
    expect(evalRowPredicate('data.account == "A1"', expanded, { fields: FIELDS })).toBe(false);
  });

  it('leaves a non-relational object field addressable as an object', () => {
    expect(
      evalRowPredicate('record.config.retries == 3', { config: { retries: 3 } }, { fields: FIELDS }),
    ).toBe(true);
  });

  it('applies to conditional formatting through the same option', () => {
    const rules = [{ condition: 'record.owner == os.user.id', backgroundColor: 'mine' }];

    expect(resolveConditionalFormatting({ owner: { id: 'U1' } }, rules, SCOPE)).toEqual({});
    expect(resolveConditionalFormatting({ owner: { id: 'U1' } }, rules, SCOPE, FIELDS)).toEqual({
      backgroundColor: 'mine',
    });
  });
});

/**
 * objectui#4640 — `rowless`: a surface with NO ROW keeps the host scope's own
 * `record` / `data`.
 *
 * The default above is the right rule for a row surface and exactly the wrong
 * one for a surface that has no row: pinning then writes an EMPTY `record` /
 * `data` over the host's real ones, and every `record.*` predicate faults with
 * "No such key". "This surface has no row of its own" and "this surface's row
 * is empty" are different facts, and only the second is entitled to shadow the
 * scope — the same distinction `usePredicateRecordContext` makes on the binding
 * side (objectui#4075). The first caller is `ActionParamDialog`'s param
 * `visible` gate, whose scope IS the host predicate scope, `data` and all.
 */
describe('evalRowPredicate — rowless (objectui#4640)', () => {
  const HOST = { record: { tag: 'HOST' }, data: { tag: 'HOST' }, features: { on: true } };

  it("leaves the host scope's own `record` / `data` standing", () => {
    expect(evalRowPredicate("record.tag == 'HOST'", null, { scope: HOST, rowless: true })).toBe(true);
    expect(evalRowPredicate("data.tag == 'HOST'", null, { scope: HOST, rowless: true })).toBe(true);
    // …on the legacy path too — one answer per value, not one per dialect.
    expect(evalRowPredicate("record.tag === 'HOST'", null, { scope: HOST, rowless: true })).toBe(true);
    expect(evalRowPredicate("data.tag === 'HOST'", null, { scope: HOST, rowless: true })).toBe(true);
  });

  it('is what stops those predicates from faulting into the fallback', () => {
    // The reverse of the case above, and the reason the option exists: without
    // it the empty row shadows the host's `record`, the predicate faults, and
    // the caller silently gets its fallback instead of a verdict.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        evalRowPredicate("record.tag == 'HOST'", null, {
          scope: HOST,
          fallback: true,
          warnOnError: true,
          label: 'shadowed',
        }),
      ).toBe(true); // ← the FALLBACK, not a verdict …
      expect(String(warn.mock.calls[0][0])).toContain('No such key');
      warn.mockClear();
      // … and with `rowless` the same call reaches the real verdict, quietly.
      expect(
        evalRowPredicate("record.tag == 'NOPE'", null, {
          scope: HOST,
          fallback: true,
          rowless: true,
          warnOnError: true,
          label: 'shadowed',
        }),
      ).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the rest of the host scope bound, and the blank/absent rules intact', () => {
    expect(evalRowPredicate('features.on == true', null, { scope: HOST, rowless: true })).toBe(true);
    expect(evalRowPredicate(null, null, { scope: HOST, rowless: true, fallback: true })).toBe(true);
    expect(evalRowPredicate('   ', null, { scope: HOST, rowless: true, fallback: true })).toBe(true);
  });

  it('does not disturb the row-surface default (no `rowless`, row still wins)', () => {
    expect(evalRowPredicate("record.tag == 'ROW'", { tag: 'ROW' }, { scope: HOST })).toBe(true);
    expect(evalRowPredicate("record.tag == 'HOST'", { tag: 'ROW' }, { scope: HOST })).toBe(false);
  });
});

/**
 * objectui#4640 — a faulting ENVELOPE reports its own source.
 *
 * `source` is `undefined` for an envelope by design (it drives dialect routing,
 * and an envelope is never routed to the legacy engine), and the fault report
 * used to reuse it — so every faulting envelope printed the literal
 * "(expression)" instead of the predicate, and, since the warn-once key is
 * (label, source), the FIRST faulting envelope under a label silenced every
 * other one. The envelope is what `@objectstack/spec`'s `ExpressionInputSchema`
 * normalizes every authored predicate into, so this was the likeliest shape in
 * served metadata and the least diagnosable one.
 */
describe("evalRowPredicate — the fault report quotes an envelope's source (objectui#4640)", () => {
  it('names each broken envelope, instead of collapsing them into "(expression)"', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const opts = { warnOnError: true, label: 'one label', fallback: false } as const;
      expect(evalRowPredicate({ dialect: 'cel', source: 'env_a_4640 ] (' }, {}, opts)).toBe(false);
      expect(evalRowPredicate({ dialect: 'cel', source: 'env_b_4640 ] (' }, {}, opts)).toBe(false);

      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('env_a_4640 ] (');
      expect(lines[1]).toContain('env_b_4640 ] (');
      expect(lines.some((l) => l.includes('(expression)'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('still warns once per (label, predicate)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pred = { dialect: 'cel', source: 'env_once_4640 ] (' } as const;
      evalRowPredicate(pred, {}, { warnOnError: true, label: 'L' });
      evalRowPredicate(pred, {}, { warnOnError: true, label: 'L' });
      expect(warn.mock.calls).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
