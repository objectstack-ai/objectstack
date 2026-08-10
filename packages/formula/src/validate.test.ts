import { describe, it, expect } from 'vitest';
import { validateExpression, introspectScope, expectedDialect, inferExpressionType } from './validate';
import { firstUndeclaredReference } from './cel-engine';

describe('validateExpression (ADR-0032)', () => {
  describe('predicates (CEL)', () => {
    it('accepts a valid bare-CEL predicate', () => {
      const r = validateExpression('predicate', 'record.rating >= 4');
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it('rejects the #1491 brace-in-CEL form with a corrective message', () => {
      const r = validateExpression('predicate', '{record.rating} >= 4');
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/map literal|bare reference|template brace/i);
      expect(r.errors[0].message).toContain('record.rating');
      expect(r.errors[0].source).toBe('{record.rating} >= 4');
    });

    it('rejects a CEL envelope placed in a template-only role', () => {
      const r = validateExpression('template', { dialect: 'cel', source: 'record.x' });
      expect(r.ok).toBe(false);
    });

    it('accepts an empty/absent expression (no-op)', () => {
      expect(validateExpression('predicate', '').ok).toBe(true);
      expect(validateExpression('predicate', null).ok).toBe(true);
    });

    // #1877 — a predicate calling an UNKNOWN function (e.g. `PRIOR()`, a typo'd
    // `isBlnk()`) must be rejected at build/registration, not silently accepted
    // and then no-op the flow at runtime. cel-js's type checker reports these as
    // `found no matching overload`; the engine surfaces them as an invalid CEL
    // predicate.
    it('rejects an unknown function call (#1877)', () => {
      const r = validateExpression('predicate', 'PRIOR(status) != "promoted"');
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/invalid CEL predicate/i);
      expect(r.errors[0].message).toMatch(/overload|PRIOR/);
    });

    it('rejects an unknown function even when guarded by a short-circuit (#1877)', () => {
      const r = validateExpression('predicate', 'status == "promoted" && PRIOR(status) != "promoted"');
      expect(r.ok).toBe(false);
    });

    it('still accepts a registered stdlib function (isBlank)', () => {
      expect(validateExpression('predicate', '!isBlank(record.target_channels)').ok).toBe(true);
    });
  });

  // #7073 — the trailer used to be undifferentiated: EVERY `celEngine.compile`
  // refusal, bounds included, ended with the dialect prescription
  // "`predicate`s are bare CEL (e.g. `record.rating >= 4`)". For a
  // syntactically perfect but over-budget expression that sentence is advice
  // that cannot succeed — the source IS bare CEL — and an author who follows
  // the last sentence they were handed (an LLM author above all) rewrites the
  // dialect and regresses.
  //
  // Both directions are pinned, deliberately. A test asserting only "the
  // bounds message changed" would stay green on a fix that ALSO stripped the
  // dialect trailer from genuine dialect faults, i.e. that shrank the refusal
  // surface while appearing to widen it.
  describe('bounds vs dialect: the prescription follows the fault class (#7073)', () => {
    /** 80-term conjunction — the escalation's `maxAstNodes` shape (#6833's fixture). */
    const OVER_AST_NODES = Array.from({ length: 80 }, (_, i) => `record.f${i} == ${i}`).join(' && ');
    /** 60-level parenthesis nest — `maxDepth`. Counts recursion that leaves no AST node. */
    const OVER_DEPTH = `${'('.repeat(60)}record.a${')'.repeat(60)} == 1`;
    /** 200-element list literal — `maxListElements`. */
    const OVER_LIST = `record.id in [${Array.from({ length: 200 }, (_, i) => `'u${i}'`).join(',')}]`;

    /** The byte-for-byte dialect trailer, per role. Must survive on dialect faults. */
    const dialectTrailer = (role: 'predicate' | 'value') =>
      ` — ${role}s are bare CEL (e.g. \`record.rating >= 4\`).`;

    describe.each([
      { name: 'maxAstNodes (80-term conjunction)', source: OVER_AST_NODES, limit: 'maxAstNodes' },
      { name: 'maxDepth (60-level nest)', source: OVER_DEPTH, limit: 'maxDepth' },
      { name: 'maxListElements (200-element list)', source: OVER_LIST, limit: 'maxListElements' },
    ])('an over-budget but valid CEL $name', ({ source, limit }) => {
      it('is refused, names the exceeded bound and its value, and never says "bare CEL"', () => {
        const r = validateExpression('predicate', source);
        expect(r.ok).toBe(false);
        expect(r.errors).toHaveLength(1);
        const { message } = r.errors[0];
        // The front half — cel-js's own reason — was always right; keep it.
        expect(message).toMatch(/^invalid CEL predicate:/);
        expect(message).toMatch(/Exceeded/);
        // The bound is NAMED with the platform's value for it.
        expect(message).toContain(`\`${limit}\` budget (limit `);
        // …and the prescription is a size prescription, not a dialect one.
        expect(message).toMatch(/SIZE fault, not a dialect mistake/);
        expect(message).toMatch(/Shrink it/);
        // ⛔ The defect itself: the dialect trailer must NOT reach this class.
        expect(message).not.toContain(dialectTrailer('predicate'));
        expect(message).not.toMatch(/bare CEL/);
      });

      it('applies to the `value` role too — one producer, all ~10 slots', () => {
        const r = validateExpression('value', source);
        expect(r.ok).toBe(false);
        expect(r.errors[0].message).toMatch(/^invalid CEL value:/);
        expect(r.errors[0].message).toMatch(/SIZE fault, not a dialect mistake/);
        expect(r.errors[0].message).not.toContain(dialectTrailer('value'));
      });
    });

    // The flipped pin. The refusal surface may never shrink: a genuine dialect
    // or syntax fault keeps the ADR-0032 §1d trailer, byte for byte.
    it.each([
      { name: 'an unterminated comparison', source: 'record.stage ==' },
      { name: 'a stray token', source: 'record.stage @@ "won"' },
      { name: 'a SQL-dialect predicate', source: "stage = 'won' AND rating >= 4" },
    ])('keeps the dialect trailer verbatim on $name', ({ source }) => {
      const r = validateExpression('predicate', source);
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toContain(dialectTrailer('predicate'));
      expect(r.errors[0].message).not.toMatch(/SIZE fault/);
    });

    it('keeps the #1491 braces hint on a brace fault (it outranks no bounds fault)', () => {
      const r = validateExpression('predicate', '{record.rating} >= 4');
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/template brace was used inside a CEL expression/);
      expect(r.errors[0].message).not.toMatch(/SIZE fault/);
    });

    it('offers no split remedy without a caveat — combination semantics differ per slot', () => {
      // PR #6831's RLS sentence ("splitting the top-level `&&` widens the
      // grant") is TRUE for a security predicate and wrong-to-meaningless for a
      // formula value. This shared producer therefore ships the caveat, not the
      // slot-specific claim.
      const message = validateExpression('predicate', OVER_AST_NODES).errors[0].message;
      expect(message).toMatch(/changes how they combine at this authoring site/);
      expect(message).not.toMatch(/widen|grant|permission/i);
    });
  });

  describe('templates', () => {
    it('accepts a valid {{ path }} template', () => {
      const r = validateExpression('template', 'Hot lead: {{ record.full_name }}');
      expect(r.ok).toBe(true);
    });

    it('flags single-brace {x} in a template and suggests {{ }}', () => {
      const r = validateExpression('template', 'Hi {record.name}');
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/\{\{ record\.name \}\}|double braces/);
    });
  });

  describe('schema-aware field existence (v1)', () => {
    it('flags an unknown record field with a did-you-mean', () => {
      const r = validateExpression('predicate', 'record.raitng >= 4', { objectName: 'crm_lead', fields: ['rating', 'status'] });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/unknown field `raitng`/);
      expect(r.errors[0].message).toMatch(/did you mean `rating`/);
    });

    it('passes when fields exist', () => {
      const r = validateExpression('predicate', 'record.rating >= 4 && record.status == "new"', { fields: ['rating', 'status'] });
      expect(r.ok).toBe(true);
    });

    it('skips field checks when no schema is provided', () => {
      expect(validateExpression('predicate', 'record.anything > 1').ok).toBe(true);
    });
  });

  // #1928 — a bare top-level identifier is a silent bug in a `record`-scoped
  // site (formula field / validation predicate) but correct in a `flattened`
  // flow/automation condition. The validator must distinguish by `scope`.
  describe('bare-reference detection by scope (#1928)', () => {
    it('flags a bare field reference in a record-scoped predicate', () => {
      const r = validateExpression('predicate', 'lead_score != null && lead_score > 100', { scope: 'record' });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/bare reference `lead_score`/);
      expect(r.errors[0].message).toMatch(/record\.lead_score/);
    });

    it('flags a bare reference in a record-scoped value (formula) expression', () => {
      const r = validateExpression('value', '(budget == null ? 0 : budget) - (spent == null ? 0 : spent)', { scope: 'record' });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/bare reference `(budget|spent)`/);
    });

    it('accepts the record-qualified form in a record-scoped site', () => {
      const r = validateExpression('value', '(record.budget == null ? 0 : record.budget) - (record.spent == null ? 0 : record.spent)', { scope: 'record' });
      expect(r.ok).toBe(true);
    });

    it('does NOT flag bare references in a flattened (flow) condition', () => {
      // The record's fields are flattened to top-level for flow conditions, and
      // flow variables share that namespace, so bare refs are correct here.
      expect(validateExpression('predicate', 'status == "done" && previous.status != "done"', { scope: 'flattened' }).ok).toBe(true);
      expect(validateExpression('predicate', 'budget > 100000', { scope: 'flattened' }).ok).toBe(true);
      expect(validateExpression('predicate', 'expiring_deals.length > 0', { scope: 'flattened' }).ok).toBe(true);
    });

    it('defaults to flattened scope (no bare-ref flag) when scope is unset', () => {
      expect(validateExpression('predicate', 'status == "done"').ok).toBe(true);
    });

    it('does not flag a null-guard on a record-qualified field (no type false-positive)', () => {
      expect(validateExpression('predicate', 'record.lead_score != null && record.lead_score > 100', { scope: 'record' }).ok).toBe(true);
    });
  });

  // #1928 tier 3 — flattened flow conditions reference fields bare, so a bare
  // ref is not an error. A bare NON-field that is a near-miss of a known field
  // is a likely typo → non-blocking warning (ok stays true).
  describe('flow-condition typo warnings (#1928 tier 3)', () => {
    const fields = ['stage', 'amount', 'status'] as const;

    it('warns (does not error) on a likely field typo in a flattened condition', () => {
      const r = validateExpression('predicate', 'stagee == "closed_won"', { objectName: 'crm_opportunity', fields, scope: 'flattened' });
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/`stagee` is not a field/);
      expect(r.warnings[0].message).toMatch(/did you mean `stage`/);
    });

    it('does not warn on a correct bare field reference', () => {
      const r = validateExpression('predicate', 'stage == "closed_won" && previous.stage != "closed_won"', { objectName: 'crm_opportunity', fields, scope: 'flattened' });
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(0);
    });

    it('does not warn on a flow variable that is far from any field name', () => {
      const r = validateExpression('predicate', 'expiring_deals.length > 0', { objectName: 'crm_opportunity', fields, scope: 'flattened' });
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(0);
    });

    it('emits no warnings without a field list (nothing to compare against)', () => {
      const r = validateExpression('predicate', 'stagee == "x"', { scope: 'flattened' });
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(0);
    });
  });

  // #1928 tier 4 — a text/boolean field used with an arithmetic or ordering
  // operator against a number faults at runtime (silent null). With per-field
  // types the validator surfaces this as a NON-blocking warning, and — the
  // design law — never flags a case the runtime tolerates (number/date fields,
  // equality, string concat, null-guards).
  describe('type-soundness warnings (#1928 tier 4)', () => {
    const schema = {
      objectName: 'crm_opportunity',
      fields: ['name', 'amount', 'is_active', 'due', 'priority', 'title'] as const,
      fieldTypes: {
        name: 'text', title: 'textarea', amount: 'currency',
        is_active: 'boolean', due: 'date', priority: 'select',
      },
      scope: 'record',
    } as const;

    it('warns (does not error) on a text field used in arithmetic against a number', () => {
      const r = validateExpression('value', 'record.name * 2', schema);
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/type mismatch/i);
      expect(r.warnings[0].message).toMatch(/record\.name/);
      expect(r.warnings[0].message).toMatch(/evaluates to null/);
    });

    it('warns on a text field ordered against a number', () => {
      const r = validateExpression('predicate', 'record.title >= 5', schema);
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/record\.title/);
    });

    it('warns on a boolean field used in arithmetic (always faults at runtime)', () => {
      const r = validateExpression('value', 'record.is_active + 1', schema);
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/boolean/i);
      expect(r.warnings[0].message).toMatch(/record\.is_active/);
    });

    it('does NOT warn on number/currency arithmetic with an int literal (#1930 runtime fix)', () => {
      // currency → dyn, so `amount / 100`, `amount * 2 - 50` never fault.
      expect(validateExpression('value', 'record.amount / 100', schema).warnings).toHaveLength(0);
      expect(validateExpression('value', 'record.amount * 2 - 50', schema).warnings).toHaveLength(0);
    });

    it('does NOT warn on a date field with an ORDERING comparison (they hydrate at runtime)', () => {
      // Ordering ops fault → the engine's string-hydration retry fires → they work.
      // (Equality `==`/`!=` does NOT — that is the #3183 silent-miss, covered in its
      // own block below; this tier-4 check leaves it to the #3183 guardrail.)
      expect(validateExpression('predicate', 'record.due <= daysFromNow(30)', schema).warnings).toHaveLength(0);
      expect(validateExpression('predicate', 'record.due >= today()', schema).warnings).toHaveLength(0);
    });

    it('does NOT warn on a select field ordered against a number (option values may be numeric codes)', () => {
      // select → dyn, so `priority >= 3` (a numeric-coded picklist) is not flagged.
      expect(validateExpression('predicate', 'record.priority >= 3', schema).warnings).toHaveLength(0);
    });

    it('does NOT warn on heterogeneous equality (runtime-safe, returns false)', () => {
      expect(validateExpression('predicate', 'record.name == 5', schema).warnings).toHaveLength(0);
      expect(validateExpression('predicate', 'record.name != 5', schema).warnings).toHaveLength(0);
    });

    it('does NOT warn on string concatenation or a null-guard', () => {
      expect(validateExpression('value', 'record.name + record.title', schema).warnings).toHaveLength(0);
      expect(validateExpression('predicate', 'record.amount != null && record.amount > 0', schema).warnings).toHaveLength(0);
    });

    it('does not run without field types', () => {
      // No fieldTypes → nothing to check.
      expect(validateExpression('value', 'record.name * 2', { objectName: 'crm_opportunity', fields: schema.fields, scope: 'record' }).warnings).toHaveLength(0);
    });
  });

  // #1928 tier 4 (flattened) — the same soundness check for bare-field flow /
  // automation conditions. Fields are bound bare (`status - 1`); flow variables
  // stay `dyn` and are never flagged.
  describe('type-soundness warnings — flattened flow conditions (#1928 tier 4)', () => {
    const schema = {
      objectName: 'crm_opportunity',
      fields: ['stage', 'amount', 'is_active', 'title'] as const,
      fieldTypes: { stage: 'select', amount: 'currency', is_active: 'boolean', title: 'text' },
      scope: 'flattened',
    } as const;

    it('warns on a bare text field used in arithmetic against a number', () => {
      const r = validateExpression('predicate', 'title - 1 > 0', schema);
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/type mismatch/i);
      // Bare form — not `record.title`.
      expect(r.warnings[0].message).toMatch(/`title`/);
      expect(r.warnings[0].message).not.toMatch(/record\.title/);
    });

    it('warns on a bare boolean field used in arithmetic', () => {
      const r = validateExpression('predicate', 'is_active + 1 > 0', schema);
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/boolean/i);
    });

    it('does NOT flag a flow variable (unlisted → dyn) or number/date fields', () => {
      // `expiring_count` is not a schema field → dyn → no fault.
      expect(validateExpression('predicate', 'expiring_count * 2 > 10', schema).warnings).toHaveLength(0);
      expect(validateExpression('predicate', 'amount / 100 > 5', schema).warnings).toHaveLength(0);
    });

    it('does NOT flag a correct bare condition, equality, or a select comparison', () => {
      expect(validateExpression('predicate', 'stage == "closed_won" && amount > 1000', schema).warnings).toHaveLength(0);
      expect(validateExpression('predicate', 'title == "VIP"', schema).warnings).toHaveLength(0);
    });
  });

  // #3306 — date arithmetic (`date − date + 1`, `date + n`) type-checks clean (the
  // operands are `dyn` at compile) but ALWAYS nulls at runtime and never recovers,
  // so — unlike the advisory text/bool warning — it is a HARD ERROR that blocks the
  // build. Only arithmetic is flagged; ordering / equality / concatenation of a
  // date field are runtime-tolerated and stay clean (the design law).
  describe('date-arithmetic errors (#3306)', () => {
    const schema = {
      objectName: 'hr_time_off_request',
      fields: ['start_date', 'end_date', 'hire_date', 'note'] as const,
      fieldTypes: { start_date: 'date', end_date: 'date', hire_date: 'datetime', note: 'text' },
      scope: 'record',
    } as const;

    it('errors on `date − date + n` — the shipped `time_off.days` bug', () => {
      const r = validateExpression('value', '(record.end_date - record.start_date) + 1', schema);
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].message).toMatch(/date arithmetic/i);
      expect(r.errors[0].message).toMatch(/daysBetween/);
    });

    it('errors even when the arithmetic is behind a `!= null` guard (the real template shape)', () => {
      // The `!= null` guard on a date field must not mask the inner arithmetic fault.
      const r = validateExpression(
        'value',
        'record.start_date != null && record.end_date != null ? (record.end_date - record.start_date) + 1 : null',
        schema,
      );
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(/date arithmetic/i);
    });

    it('errors on `date + n` (author meant `addDays`)', () => {
      expect(validateExpression('value', 'record.hire_date + 30', schema).ok).toBe(false);
    });

    it('does NOT flag runtime-tolerated date uses (ordering, string-literal, equality, concat)', () => {
      // Ordering vs a temporal fn → Timestamp<Timestamp overload; vs a string literal
      // → runtime string-lex (correct for ISO dates); equality → #3183; concat →
      // runtime string+string. None of these null at runtime, so none is flagged.
      for (const src of [
        'record.end_date < today()',
        'record.end_date <= daysFromNow(60)',
        'record.end_date < "2026-01-01"',
        'record.end_date == today()',
        '"Due: " + record.end_date',
        'record.end_date - record.start_date',          // → Duration, no further arith
      ]) {
        const r = validateExpression('value', src, schema);
        expect(r.errors, `should be clean: ${src}`).toHaveLength(0);
      }
    });

    it('accepts the catalog-correct rewrite that replaces the broken form', () => {
      const r = validateExpression(
        'value',
        'record.start_date != null && record.end_date != null ? daysBetween(record.start_date, record.end_date) + 1 : null',
        schema,
      );
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
    });
  });

  describe('introspection', () => {
    it('reports the dialect + scope for a field role', () => {
      expect(expectedDialect('predicate')).toBe('cel');
      expect(expectedDialect('template')).toBe('template');
      const scope = introspectScope('predicate', { fields: ['rating'] });
      expect(scope.dialect).toBe('cel');
      expect(scope.fields).toContain('rating');
      expect(scope.roots).toContain('record');
      expect(scope.functions).toContain('daysFromNow');
    });

    /**
     * [#6290] The package must give ONE answer about what a root is.
     *
     * `introspectScope` is the roots list this package HANDS an author (and the
     * agent authoring tool); `firstUndeclaredReference` is the strict env that
     * JUDGES what an author wrote, off `cel-engine.ts`'s `SCOPE_ROOTS`. Nothing
     * kept the two in step, and they had drifted on exactly the root ADR-0068
     * D1 calls canonical: `current_user` was advertised here and read as a bare
     * field reference there — so the one spelling the ADR blesses was the one
     * spelling the validator refused, while its two aliases (`user`, `ctx`)
     * passed.
     *
     * Pinned as behaviour rather than as list equality: `SCOPE_ROOTS` is a
     * generous baseline and stays free to declare MORE than it advertises (it
     * carries `trigger`, `step`, `parent`, … for sites this introspection does
     * not describe). What it may never do again is advertise a root it then
     * faults on. Delete `'current_user'` from `SCOPE_ROOTS` and this goes red.
     */
    it('every root `introspectScope` advertises really resolves in the strict env (#6290)', () => {
      const advertised = introspectScope('predicate').roots;
      expect(advertised).toContain('current_user');
      const faulting = advertised.filter((root) => firstUndeclaredReference(`${root}.x`) !== null);
      expect(faulting).toEqual([]);
    });

    /**
     * [#6290] The same drift, seen from `checkRoleCatalog`'s side: its four
     * position-membership regexes accept `current_user` / `user` / `ctx.user`
     * as the user subject, so a role-catalog verdict on a `current_user`
     * predicate was only ever reachable at sites that do not run the
     * `record`-scope bare-ref check. All three spellings now reach it.
     */
    it('a role-catalog verdict is reachable through every ADR-0068 user spelling (#6290)', () => {
      for (const subject of ['current_user', 'user', 'ctx.user']) {
        const r = validateExpression('predicate', `'org_admni' in ${subject}.positions`, {
          scope: 'record',
          roleCatalog: ['org_admin', 'org_member'],
        });
        expect(r.ok).toBe(false);
        // The role typo is the finding — not a bare reference to the subject.
        expect(r.errors.map((e) => e.message).join('\n')).toContain('unknown role `org_admni`');
        expect(r.errors.map((e) => e.message).join('\n')).not.toContain('bare reference');
      }
    });
  });
});

describe('inferExpressionType — coarse value-type of a formula', () => {
  // The host object's fields, so a bare `<field>` reference resolves the same as
  // `record.<field>` (a stored formula may be written either way).
  const fields = ['start_date', 'end_date', 'amount', 'rate', 'first', 'last', 'name', 'items'];

  it('infers number for a computed-number formula (the leave_days repro)', () => {
    // daysBetween(...): int, int + 1 → int → number. The exact case a "total
    // leave days" dashboard card needs a SUM measure derived for.
    expect(inferExpressionType('daysBetween(start_date, end_date) + 1', { fields })).toBe('number');
    expect(inferExpressionType('daysBetween(record.start_date, record.end_date) + 1')).toBe('number');
    expect(inferExpressionType('amount * 0.1', { fields })).toBe('number'); // dyn * double → double
    expect(inferExpressionType('round(amount)', { fields })).toBe('number');
    expect(inferExpressionType('len(items)', { fields })).toBe('number');
  });

  it('accepts the canonical Expression envelope as input', () => {
    expect(inferExpressionType({ dialect: 'cel', source: 'amount * 0.1' }, { fields })).toBe('number');
  });

  it('infers text / boolean / date for non-numeric formulas', () => {
    expect(inferExpressionType('upper(name)', { fields })).toBe('text');
    expect(inferExpressionType('rate >= 0.5', { fields })).toBe('boolean');
    expect(inferExpressionType('today()')).toBe('date');
  });

  it('is conservative — an ambiguous (dyn) result is unknown, never number', () => {
    // `first + last` could be string concatenation OR numeric addition; with two
    // untyped operands cel-js yields `dyn`, so we must NOT call it a number (else
    // a dataset would SUM a text formula). This is the safety property.
    expect(inferExpressionType('first + last', { fields })).toBe('unknown');
    expect(inferExpressionType('amount + rate', { fields })).toBe('unknown');
  });

  it('returns unknown for empty, absent, or un-type-checkable expressions', () => {
    expect(inferExpressionType('')).toBe('unknown');
    expect(inferExpressionType(null)).toBe('unknown');
    expect(inferExpressionType(undefined)).toBe('unknown');
    expect(inferExpressionType('no_such_fn(amount)', { fields })).toBe('unknown'); // no overload
    expect(inferExpressionType('undeclared_field + 1')).toBe('unknown'); // bare ref, no fields given
  });
});
