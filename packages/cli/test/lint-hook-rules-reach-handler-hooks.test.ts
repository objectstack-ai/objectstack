// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16095 — the `hook-body-*` / `hook-api-update-readonly-*` family reaches a
 * hook authored as an inline `handler` function through `os lint`.
 *
 * Every rule in that family opens on `body.language === 'js'`. A hook written
 * as `handler: async (ctx) => { … }` carries no `body`, so on the stack `os
 * lint` used to hand the registry the whole family returned before reading
 * anything — while the reference app authors 39 of 39 hooks that way. `os
 * build` never had the gap: it lowers every inline handler to a metadata body
 * (`lowerCallables`) BEFORE the parse, and hands the registry the lowered
 * stack, so the same rules fire there. `lintConfig` now hands the registry's
 * `parsed` tier that same lowered view, and these pins hold the reach.
 *
 * Every RED case has a control beside it — the identical statement authored as
 * an explicit `body`, which fired on both sides of the change — so a red here
 * is a reading about the door, never about the rule.
 */
import { describe, expect, it } from 'vitest';
import { normalizeStackInput } from '@objectstack/spec';
import { lintConfig } from '../src/commands/lint';
import { runScaffoldAuthoringRules } from '../src/utils/scaffold-validate';

const READONLY_RULE = 'hook-api-update-readonly-field';
const READONLY_WHEN_RULE = 'hook-api-update-readonly-when-field';
const UNKNOWN_FIELD_RULE = 'hook-body-write-unknown-field';

/** A `crm_case` whose `is_escalated` nobody may hand-write (the card's fixture). */
const OBJECTS = [
  {
    name: 'crm_case',
    label: 'Case',
    fields: {
      title: { type: 'text', label: 'Title' },
      is_escalated: { type: 'boolean', label: 'Escalated', readonly: true },
      credit_hold: { type: 'boolean', label: 'Credit hold', readonlyWhen: 'status == "closed"' },
    },
  },
];

type Hook = Record<string, unknown>;

const stackWith = (hook: Hook) =>
  normalizeStackInput({ objects: OBJECTS, hooks: [hook] } as Record<string, unknown>);

const rulesOf = (hook: Hook, rule: string) =>
  lintConfig(stackWith(hook)).filter((i) => i.rule === rule);

/** The statement under test, once as source text and once as a live function. */
const WRITE_READONLY_SOURCE =
  "await ctx.api.object('crm_case').update({ id: ctx.input.id, is_escalated: true });";

const handlerHook = (name: string, handler: unknown, extra: Hook = {}): Hook => ({
  name,
  object: 'crm_case',
  events: ['afterUpdate'],
  handler,
  ...extra,
});

const bodyHook = (name: string, source: string, extra: Hook = {}): Hook => ({
  name,
  object: 'crm_case',
  events: ['afterUpdate'],
  body: { language: 'js', source },
  ...extra,
});

describe('#16095 — INTAKE: a handler-authored hook reaches the readonly family through lintConfig', () => {
  it('RED — `hook-api-update-readonly-field` fires on an inline handler writing a readonly field', () => {
    const findings = rulesOf(
      handlerHook('escalate', async (ctx: any) => {
        await ctx.api.object('crm_case').update({ id: ctx.input.id, is_escalated: true });
      }),
      READONLY_RULE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('is_escalated');
    // [#16546] `body.source` is a key this author never wrote — the body was
    // MINTED here from their inline `handler`, so the finding points at the
    // key they actually wrote instead, with a suffix saying why. `os build`
    // reports the identical `path` and message suffix for the same hook (see
    // the e2e sibling's parity assertion), so the two commands still agree
    // word for word — just no longer on the wrong word.
    expect(findings[0].path).toBe('hooks[0].handler');
    expect(findings[0].message).toContain('judged on the metadata body lowered from the inline handler');
  });

  it('CONTROL — the identical statement as an explicit `body` fires the same finding, path UNCHANGED', () => {
    // [#16546] Non-regression control: this hook's `body` is author-written,
    // not lowered from a `handler` — `hooks[0].body.source` names a key that
    // is really there, and the fix must never move it.
    const findings = rulesOf(bodyHook('escalate', WRITE_READONLY_SOURCE), READONLY_RULE);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('hooks[0].body.source');
    expect(findings[0].message).not.toContain('judged on the metadata body lowered from the inline handler');
  });

  it('RED — `hook-api-update-readonly-when-field` (warning) fires on an inline handler too', () => {
    const findings = rulesOf(
      handlerHook('hold', async (ctx: any) => {
        await ctx.api.object('crm_case').update({ id: ctx.input.id, credit_hold: true });
      }),
      READONLY_WHEN_RULE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    // [#16546] Same fix, this rule's other finding id.
    expect(findings[0].path).toBe('hooks[0].handler');
  });

  it('RED — `hook-body-write-unknown-field` fires on an inline handler writing an undeclared field', () => {
    const findings = rulesOf(
      handlerHook('typo', async (ctx: any) => {
        await ctx.api.object('crm_case').update({ id: ctx.input.id, is_escalatd: true });
      }),
      UNKNOWN_FIELD_RULE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('is_escalatd');
    // [#16546] The sibling validator (`validate-hook-body-writes.ts`) gets the
    // same fix — same `ctx.loweredHookRefs`, same shared `hookBodyFindingLocation`.
    expect(findings[0].path).toBe('hooks[0].handler');
  });
});

describe('#16095 — NEGATIVE CONTROLS: the lowered view adds no verdict the rule would not give a body', () => {
  it('`runAs: "system"` exempts the inline handler exactly as it exempts a body (#14010)', () => {
    const viaHandler = rulesOf(
      handlerHook(
        'escalate_sys',
        async (ctx: any) => {
          await ctx.api.object('crm_case').update({ id: ctx.input.id, is_escalated: true });
        },
        { runAs: 'system' },
      ),
      READONLY_RULE,
    );
    const viaBody = rulesOf(bodyHook('escalate_sys', WRITE_READONLY_SOURCE, { runAs: 'system' }), READONLY_RULE);
    expect(viaHandler).toEqual([]);
    expect(viaBody).toEqual([]);
  });

  it('a handler the extractor REFUSES gets no write-set verdict — the lowering rule reports it instead', () => {
    // `fetch` is a forbidden token: `lowerCallables` records the refusal and
    // leaves the hook with no `body`, so the family stays silent on it — the
    // author is told by `hook-body/bundled-fallback`, not by a guess about a
    // body that was never produced.
    const issues = lintConfig(
      stackWith(
        handlerHook('remote', async (ctx: any) => {
          await fetch('https://example.com/x');
          await ctx.api.object('crm_case').update({ id: ctx.input.id, is_escalated: true });
        }),
      ),
    );
    expect(issues.filter((i) => i.rule === READONLY_RULE)).toEqual([]);
    expect(issues.filter((i) => i.rule === 'hook-body/bundled-fallback')).toHaveLength(1);
  });

  it('a hook that already carries an explicit `body` keeps it — the handler beside it is not re-extracted', () => {
    // `lowerCallables` only extracts `if (!hook.body)`; an authored body wins,
    // so the verdict is about what the author wrote, not about a shadow copy.
    const findings = rulesOf(
      handlerHook(
        'authored',
        async (ctx: any) => {
          await ctx.api.object('crm_case').update({ id: ctx.input.id, is_escalated: true });
        },
        { body: { language: 'js', source: 'return ctx.input;' } },
      ),
      READONLY_RULE,
    );
    expect(findings).toEqual([]);
  });

  it('a string `handler` (a bundle reference) is not lowered and stays outside the family', () => {
    expect(rulesOf(handlerHook('legacy', 'legacy_fn'), READONLY_RULE)).toEqual([]);
  });
});

describe('#16095 — the lowering is a VIEW for the registry, not a rewrite of the input', () => {
  it('lintConfig leaves the caller\'s stack untouched: the handler is still a function, no body appears', () => {
    const stack = stackWith(
      handlerHook('escalate', async (ctx: any) => {
        await ctx.api.object('crm_case').update({ id: ctx.input.id, is_escalated: true });
      }),
    );
    const before = JSON.stringify(stack);
    lintConfig(stack);
    const hook = (stack.hooks as Hook[])[0];
    expect(typeof hook.handler).toBe('function');
    expect(hook.body).toBeUndefined();
    expect(JSON.stringify(stack)).toBe(before);
  });

  it('the function-reading rule (`hook-body/not-lowerable`) still sees the live function on the same run', () => {
    // The `normalized` tier and `checkHookBodyLowering` read FUNCTION values;
    // handing them the lowered view would blind them. Both halves on one run.
    const SLA_HOURS = 4;
    const issues = lintConfig(
      stackWith(
        handlerHook('sla', async (ctx: any) => {
          await ctx.api.object('crm_case').update({ id: ctx.input.id, is_escalated: SLA_HOURS > 2 });
        }),
      ),
    );
    expect(issues.filter((i) => i.rule === 'hook-body/not-lowerable')).toHaveLength(1);
    // And because that handler could NOT be lowered, the family has no body to judge.
    expect(issues.filter((i) => i.rule === READONLY_RULE)).toEqual([]);
  });
});

/**
 * The FOURTH door, and the reason it is pinned here rather than left to the
 * three `os *` legs in the e2e sibling.
 *
 * `runScaffoldAuthoringRules` is a separate entry into the same registry —
 * `os init` / `dev` drive it over a freshly rendered template — and it is NOT
 * one of the three commands. It reaches the family, and always did, because it
 * lowers before it parses exactly as `compile.ts` does; nothing in this card
 * changed it. It is pinned because an unpinned reached door is the failure the
 * ledger in the two rule headers exists to prevent: a reachability claim
 * measured through one entry point is a claim about that entry point, not
 * about the rule. The control below is what makes the RED leg readable — if
 * the scaffold path ever stops lowering, the handler leg goes silent while the
 * body leg keeps firing, and that asymmetry is the signal.
 */
describe('#16095 — door: `runScaffoldAuthoringRules` (reached, and not one of the three commands)', () => {
  const scaffoldStack = (hook: Hook) => ({ objects: OBJECTS, hooks: [hook] });
  const familyOf = (hook: Hook) => {
    const report = runScaffoldAuthoringRules(scaffoldStack(hook));
    // A schema failure returns empty lists, which would read exactly like "no
    // finding" — assert the stack actually parsed before reading the verdict.
    expect(report.schemaError).toBeNull();
    return [...report.errors, ...report.advisories].filter((f) => f.rule === READONLY_RULE);
  };

  it('INTAKE — the handler-authored hook IS judged here (it lowers before it parses)', () => {
    const findings = familyOf(
      handlerHook('escalate', async (ctx: any) => {
        await ctx.api.object('crm_case').update({ id: ctx.input.id, is_escalated: true });
      }),
    );
    expect(findings).toHaveLength(1);
    // [#16546] This door also gets `ctx.loweredHookRefs` (`scaffold-validate.ts`
    // hands it through the same as `os build` / `os lint` do), so it must not
    // be the one door still pointing at the un-authored `body.source` key.
    expect(findings[0].path).toBe('hooks[0].handler');
  });

  it('CONTROL — the identical statement as an explicit `body` fires the same finding, path UNCHANGED', () => {
    const findings = familyOf(bodyHook('escalate_body', WRITE_READONLY_SOURCE));
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('hooks[0].body.source');
  });
});
