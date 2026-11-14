import { describe, it, expect } from 'vitest';
import { HookSchema, HookRefusalSchema, HookContextSchema } from './hook.zod';
import {
  HOOK_REFUSAL_CODE_PATTERN,
  HOOK_REFUSAL_MESSAGE_HOLE_REFUSED,
  hookRefusalCodesThrownIn,
  hookRefusalsWithoutSandboxedBody,
  HOOK_REFUSAL_REASON_PATTERN,
  hookRefusalReasonsThrownIn,
  undeclaredHookRefusalAtRun,
  undeclaredHookRefusalCodeAtSave,
  undeclaredHookRefusalReasonAtRun,
  undeclaredHookRefusalReasonAtSave,
} from './hook-refusal-codes';
import { hookRefusalMessageKey } from '../system/i18n-resolver';
import { TranslationDataSchema } from '../system/translation.zod';

// #26170 (maintainer ruling 6431311681, letter A): a hook declares its refusal
// catalogue, `refusals: { <CODE>: { message, status? } }`, and its body refuses
// by code only.

const base = { name: 'credit_guard', object: 'order', events: ['beforeInsert' as const] };
const body = (source: string) => ({ language: 'js' as const, source });

describe('Hook.refusals — the declared catalogue', () => {
  it('accepts a catalogue of SCREAMING_SNAKE codes with a message and an optional 4xx status', () => {
    const parsed = HookSchema.parse({
      ...base,
      body: body("throw Object.assign(new Error('over limit'), { code: 'CREDIT_LIMIT' });"),
      refusals: {
        CREDIT_LIMIT: { message: 'This order exceeds the customer credit limit.' },
        ACCOUNT_ON_HOLD: { message: 'The account is on hold.', status: 409 },
      },
    });
    expect(parsed.refusals?.CREDIT_LIMIT).toEqual({ message: 'This order exceeds the customer credit limit.' });
    expect(parsed.refusals?.ACCOUNT_ON_HOLD.status).toBe(409);
  });

  it('is optional — a hook with no catalogue is unchanged', () => {
    const parsed = HookSchema.parse({ ...base, body: body("throw new Error('no');") });
    expect(parsed.refusals).toBeUndefined();
  });

  it('refuses a code that is not SCREAMING_SNAKE', () => {
    const r = HookSchema.safeParse({ ...base, body: body('return;'), refusals: { creditLimit: { message: 'x' } } });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path[0] === 'refusals')).toBe(true);
  });

  it('refuses an empty message', () => {
    expect(HookSchema.safeParse({ ...base, body: body('return;'), refusals: { NO: { message: '  ' } } }).success).toBe(false);
  });

  it.each([
    ['neither a body nor a handler', {}, 'no `body` and no `handler`'],
    ['an expression body', { body: { language: 'expression', source: 'record.amount > 0' } }, 'a `expression` body'],
    [
      'an expression body beside a handler (the body wins at bind)',
      { body: { language: 'expression', source: 'record.amount > 0' }, handler: 'creditGuard' },
      'a `expression` body',
    ],
  ])('refuses a catalogue on a hook with %s — nothing would answer it', (_label, rest, has) => {
    const r = HookSchema.safeParse({ ...base, ...rest, refusals: { CREDIT_LIMIT: { message: 'x' } } });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'refusals')!;
    expect(issue.message).toBe(hookRefusalsWithoutSandboxedBody(has.startsWith('no') ? undefined : 'expression'));
    expect(issue.message).toContain(has);
  });

  it.each(['Over the limit of {{limit}}.', 'Hi {{ user.name }}, no.', 'Line one.\nOver {{limit}}.'])(
    'refuses a `{{ }}` hole in %j when the entry declares no `params` — nothing fills it',
    (message) => {
      const r = HookSchema.safeParse({ ...base, body: body('return;'), refusals: { CREDIT_LIMIT: { message } } });
      expect(r.success).toBe(false);
      const issue = r.error!.issues.find((i) => i.path.join('.') === 'refusals.CREDIT_LIMIT.message')!;
      expect(issue.message).toBe(HOOK_REFUSAL_MESSAGE_HOLE_REFUSED);
    },
  );

  it('accepts single braces and an unclosed pair as plain text', () => {
    for (const message of ['Use {x} here.', 'An open {{ brace.']) {
      expect(HookRefusalSchema.safeParse({ message }).success, message).toBe(true);
    }
  });

  it.each([399, 500, 503, 404.5])('refuses status %s — a refusal is a 4xx', (status) => {
    expect(HookRefusalSchema.safeParse({ message: 'x', status }).success).toBe(false);
  });

  it('names `reason` as the rename onto `message` it is', () => {
    const r = HookRefusalSchema.safeParse({ reason: 'x' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.find((i) => i.code === 'unrecognized_keys')?.message).toContain('`reason` → `message`');
  });

  it('names `httpStatus` as the rename onto `status` it is', () => {
    const r = HookRefusalSchema.safeParse({ message: 'x', httpStatus: 409 });
    expect(r.success).toBe(false);
    expect(r.error!.issues.find((i) => i.code === 'unrecognized_keys')?.message).toContain('`httpStatus` → `status`');
  });
});

describe('Hook.refusals — an undeclared code is refused at save where the body names it literally', () => {
  const refusals = { CREDIT_LIMIT: { message: 'Over the credit limit.' } };

  it('refuses a literal `code:` the catalogue does not declare, at `body.source`', () => {
    const r = HookSchema.safeParse({
      ...base,
      refusals,
      body: body("throw Object.assign(new Error('x'), { code: 'CREDIT_LIMT' });"),
    });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'body.source')!;
    expect(issue.message).toBe(undeclaredHookRefusalCodeAtSave('CREDIT_LIMT', ['CREDIT_LIMIT']));
    expect(issue.message).toContain("throws code 'CREDIT_LIMT'");
    expect(issue.message).toContain("declared: 'CREDIT_LIMIT'");
  });

  it('refuses `e.code = …` on an error the body throws bare', () => {
    const r = HookSchema.safeParse({
      ...base,
      refusals,
      body: body("const e = new Error('x');\ne.code = 'ON_HOLD';\nthrow e;"),
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toContain("throws code 'ON_HOLD'");
  });

  it('accepts a body whose literal codes are all declared', () => {
    const r = HookSchema.safeParse({
      ...base,
      refusals,
      body: body("if (ctx.input.amount > 10) throw Object.assign(new Error('x'), { code: 'CREDIT_LIMIT' });"),
    });
    expect(r.success).toBe(true);
  });

  it('leaves a computed code to the run-time refusal', () => {
    const r = HookSchema.safeParse({
      ...base,
      refusals,
      body: body("const c = ctx.input.kind; throw Object.assign(new Error('x'), { code: c });"),
    });
    expect(r.success).toBe(true);
  });

  it('reads nothing when the hook declares no catalogue — a hook without `refusals` saves as before', () => {
    const r = HookSchema.safeParse({
      ...base,
      body: body("throw Object.assign(new Error('x'), { code: 'ANYTHING' });"),
    });
    expect(r.success).toBe(true);
  });
});

describe('hookRefusalCodesThrownIn — the save-time reading', () => {
  it.each([
    ["throw Object.assign(new Error('x'), { code: 'A_B' });", ['A_B']],
    ['throw { message: "x", code: "QUOTED" }', ['QUOTED']],
    ['throw Object.assign(new Error(`x`), { code: `TPL` })', ['TPL']],
    ["const e = new Error('x'); e.code = 'BOUND'; throw e;", ['BOUND']],
    ['throw Object.assign(new Error("a;b"), {\n  code: "MULTI_LINE",\n});', ['MULTI_LINE']],
  ])('reads %j', (source, codes) => {
    expect(hookRefusalCodesThrownIn(source)).toEqual(codes);
  });

  it.each([
    // a record field named `code`, outside any throw
    "ctx.input.code = 'NOT_THROWN'; return;",
    "await ctx.api.object('x').insert({ code: 'ROW_CODE' });",
    // an assignment on a name that is never thrown bare
    "const row = {}; row.code = 'ROW'; throw new Error('x');",
    // a lower-case value is never a refusal code
    // adr0112-ok: a fixture body's source text the save-time reader must NOT read as a code; nothing emits it
    "throw Object.assign(new Error('x'), { code: 'lower' });",
    // inside a comment or a string
    "// throw Object.assign(new Error(), { code: 'COMMENTED' });\nreturn;",
    "const s = \"throw { code: 'IN_STRING' }\";",
    "throw new Error(\"bad code: 'IN_MESSAGE'\");",
  ])('reads nothing in %j', (source) => {
    expect(hookRefusalCodesThrownIn(source)).toEqual([]);
  });

  it('stops a throw statement at its line end, so a later `code:` is not charged to it', () => {
    expect(hookRefusalCodesThrownIn("if (x) throw new Error('a')\nconst r = { code: 'LATER' };")).toEqual([]);
  });
});

describe('the code pattern and the sentences', () => {
  it.each(['A', 'CREDIT_LIMIT', 'E404', 'A_1_B'])('accepts %s', (c) => expect(HOOK_REFUSAL_CODE_PATTERN.test(c)).toBe(true));
  it.each(['a', 'Credit', '_A', 'A_', 'A__B', '1A', 'A-B'])('refuses %s', (c) => expect(HOOK_REFUSAL_CODE_PATTERN.test(c)).toBe(false));

  it('the run-time fault names the hook, the code and the declared codes', () => {
    expect(undeclaredHookRefusalAtRun('credit_guard', 'X', ['A', 'B'])).toContain("hook 'credit_guard' threw code 'X'");
    expect(undeclaredHookRefusalAtRun('credit_guard', 'X', ['A', 'B'])).toContain("declared: 'A', 'B'");
    expect(undeclaredHookRefusalAtRun('credit_guard', undefined, [])).toContain('threw no `code`');
    expect(undeclaredHookRefusalAtRun('credit_guard', undefined, [])).toContain('declared: none');
  });
});

describe('the translation address — `hooks.<hook>.refusals.<CODE>.message`', () => {
  it('is the key the runtime asks the i18n service for', () => {
    expect(hookRefusalMessageKey('credit_guard', 'CREDIT_LIMIT')).toBe('hooks.credit_guard.refusals.CREDIT_LIMIT.message');
  });

  it('is a path a translation bundle can write', () => {
    const r = TranslationDataSchema.safeParse({
      hooks: { credit_guard: { refusals: { CREDIT_LIMIT: { message: '订单超出客户信用额度。' } } } },
    }) as { success: true; data: any };
    expect(r.success).toBe(true);
    expect(r.data.hooks.credit_guard.refusals.CREDIT_LIMIT.message).toBe('订单超出客户信用额度。');
  });

  it('accepts the empty slot `os i18n extract` writes into a skeleton', () => {
    expect(TranslationDataSchema.safeParse({ hooks: { h: { refusals: { C: { message: '' } } } } }).success).toBe(true);
  });

  it('refuses a key a hook translation does not hold', () => {
    const r = TranslationDataSchema.safeParse({ hooks: { h: { label: 'x' } } });
    expect(r.success).toBe(false);
  });

  it('names `refusal` as the rename onto `refusals` it is', () => {
    const r = TranslationDataSchema.safeParse({ hooks: { h: { refusal: {} } } });
    expect(r.success).toBe(false);
    expect(r.error!.issues.find((i) => i.code === 'unrecognized_keys')?.message).toContain('`refusal` → `refusals`');
  });
});

describe('HookContext.session.locale — the locale a refusal is picked in', () => {
  it('is declared, optional', () => {
    const ctx = { object: 'order', event: 'beforeInsert', input: {}, ql: {} };
    expect(HookContextSchema.safeParse({ ...ctx, session: { userId: 'u1', locale: 'zh-CN' } }).success).toBe(true);
    expect(HookContextSchema.safeParse({ ...ctx, session: { userId: 'u1' } }).success).toBe(true);
  });
});

// #33214 (ruling 6879477573: 问一 A, 问二 S1, 问三 是) — the catalogue is answered
// on a handler-authored hook too, a code holds further sentences under declared
// reasons, and a sentence may name declared params.

describe('Hook.refusals on a handler-authored hook (#33214)', () => {
  const refusals = { CREDIT_LIMIT: { message: 'Over the credit limit.' } };

  it('accepts a catalogue on a hook whose `handler` is an inline function', () => {
    const handler = async (ctx: any) => {
      if (ctx.input.amount > 10) throw Object.assign(new Error('x'), { code: 'CREDIT_LIMIT' });
    };
    const r = HookSchema.safeParse({ ...base, handler, refusals });
    expect(r.success).toBe(true);
    expect(r.success && r.data.refusals?.CREDIT_LIMIT.message).toBe('Over the credit limit.');
  });

  it('accepts a catalogue on a hook whose `handler` is a string reference — its codes are judged when it runs', () => {
    expect(HookSchema.safeParse({ ...base, handler: 'creditGuard', refusals }).success).toBe(true);
  });

  it('refuses a literal code the catalogue does not declare, read off the inline handler, at `handler`', () => {
    const handler = async () => {
      throw Object.assign(new Error('x'), { code: 'CREDIT_LIMT' });
    };
    const r = HookSchema.safeParse({ ...base, handler, refusals });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'handler')!;
    expect(issue.message).toBe(undeclaredHookRefusalCodeAtSave('CREDIT_LIMT', ['CREDIT_LIMIT'], 'handler'));
    expect(issue.message.startsWith('`handler` throws code')).toBe(true);
  });

  it('reads the body, not the handler, when both are present — the body wins at bind', () => {
    const handler = async () => {
      throw Object.assign(new Error('x'), { code: 'NOT_RUN' });
    };
    const r = HookSchema.safeParse({
      ...base,
      handler,
      body: body("throw Object.assign(new Error('x'), { code: 'CREDIT_LIMIT' });"),
      refusals,
    });
    expect(r.success).toBe(true);
  });
});

describe('HookRefusal.reasons — further sentences under one code (#33214, S1)', () => {
  const refusals = {
    VALIDATION_FAILED: {
      message: 'This plan cannot be submitted.',
      reasons: { plan_locked: { message: 'The plan is locked.' }, second_primary: { message: 'A primary plant exists.' } },
    },
  };

  it('accepts declared snake_case reasons with a message each', () => {
    const r = HookSchema.safeParse({
      ...base,
      body: body("throw { code: 'VALIDATION_FAILED', reason: 'plan_locked', message: 'x' };"),
      refusals,
    });
    expect(r.success).toBe(true);
  });

  it.each(['PlanLocked', 'PLAN_LOCKED', 'plan-locked', '1st'])('refuses the reason key %j — a reason is snake_case', (key) => {
    const r = HookRefusalSchema.safeParse({ message: 'x', reasons: { [key]: { message: 'y' } } });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path[0] === 'reasons')).toBe(true);
  });

  it('refuses an empty reason message and a reason carrying its own status', () => {
    expect(HookRefusalSchema.safeParse({ message: 'x', reasons: { a: { message: ' ' } } }).success).toBe(false);
    const r = HookRefusalSchema.safeParse({ message: 'x', reasons: { a: { message: 'y', status: 409 } } });
    expect(r.success).toBe(false);
    expect(r.error!.issues.find((i) => i.code === 'unrecognized_keys')?.message).toContain('`status`');
  });

  it('refuses at `body.source` a literal reason the code does not declare', () => {
    const r = HookSchema.safeParse({
      ...base,
      body: body("throw { code: 'VALIDATION_FAILED', reason: 'plan_lockd', message: 'x' };"),
      refusals,
    });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'body.source')!;
    expect(issue.message).toBe(
      undeclaredHookRefusalReasonAtSave('VALIDATION_FAILED', 'plan_lockd', ['plan_locked', 'second_primary'], 'body.source'),
    );
  });

  it('refuses at `handler` a literal reason under a code with no `reasons`', () => {
    const handler = async () => {
      const e: any = new Error('x');
      e.code = 'CREDIT_LIMIT';
      e.reason = 'over_by_far';
      throw e;
    };
    const r = HookSchema.safeParse({ ...base, handler, refusals: { CREDIT_LIMIT: { message: 'Over.' } } });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'handler')!;
    expect(issue.message).toContain("reason 'over_by_far'");
    expect(issue.message).toContain('declared: none');
  });
});

describe('hookRefusalReasonsThrownIn — the save-time reading of reasons', () => {
  it.each([
    ["throw { code: 'A_B', reason: 'x_y' };", [{ code: 'A_B', reason: 'x_y' }]],
    ["throw Object.assign(new Error('m'), { reason: \"r\", code: \"C\" });", [{ code: 'C', reason: 'r' }]],
    ["const e = new Error('m'); e.code = 'C'; e.reason = 'r'; throw e;", [{ code: 'C', reason: 'r' }]],
  ])('reads %j', (source, pairs) => {
    expect(hookRefusalReasonsThrownIn(source)).toEqual(pairs);
  });

  it.each([
    // no literal code beside it
    "throw { code: c, reason: 'r' };",
    // a reason outside any throw
    "const row = { reason: 'r' }; throw { code: 'C' };",
    // inside a string or a comment
    "// throw { code: 'C', reason: 'r' }\nreturn;",
    "throw new Error(\"reason: 'r'\");",
  ])('reads nothing in %j', (source) => {
    expect(hookRefusalReasonsThrownIn(source)).toEqual([]);
  });

  it('does not read a kept reason literal spelling `throw` as a throw statement', () => {
    expect(hookRefusalCodesThrownIn("const k = 'throw'; const r = { code: 'NOPE' };")).toEqual([]);
  });

  it.each(['a', 'plan_locked', 'x1_y2'])('the reason pattern accepts %s', (r) => expect(HOOK_REFUSAL_REASON_PATTERN.test(r)).toBe(true));
  it.each(['A', 'Plan', '_a', 'a_', 'a__b', 'a-b'])('the reason pattern refuses %s', (r) => expect(HOOK_REFUSAL_REASON_PATTERN.test(r)).toBe(false));

  it('the run-time fault names the hook, the code, the reason and the declared reasons', () => {
    const text = undeclaredHookRefusalReasonAtRun('plan_gate', 'VALIDATION_FAILED', 'nope', ['plan_locked']);
    expect(text).toContain("hook 'plan_gate' threw code 'VALIDATION_FAILED' with reason 'nope'");
    expect(text).toContain("declared: 'plan_locked'");
  });
});

describe('HookRefusal.params — declared names a sentence may fill (#33214)', () => {
  it('accepts a hole over a declared param, in the message and in a reason', () => {
    const r = HookRefusalSchema.safeParse({
      message: 'The plan is {{ state }}.',
      params: ['state', 'owner'],
      reasons: { locked: { message: 'Locked by {{ owner }} while {{ state }}.' } },
    });
    expect(r.success).toBe(true);
  });

  it('accepts a hole with a formatter over a declared param', () => {
    expect(HookRefusalSchema.safeParse({ message: 'Over by {{ amount | number }}.', params: ['amount'] }).success).toBe(true);
  });

  it('refuses a hole over a name the entry does not declare, naming the declared roots', () => {
    const r = HookRefusalSchema.safeParse({ message: 'The plan is {{ stat }}.', params: ['state'] });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'message')!;
    expect(issue.message).toContain('`{{ stat }}`');
    expect(issue.message).toContain('`state`');
  });

  it('refuses an undeclared hole in a reason at `reasons.REASON.message`', () => {
    const r = HookRefusalSchema.safeParse({ message: 'x', params: ['a'], reasons: { r: { message: 'Hi {{ b }}.' } } });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path.join('.') === 'reasons.r.message')).toBe(true);
  });

  it('refuses every hole in a reason when the entry declares no params', () => {
    const r = HookRefusalSchema.safeParse({ message: 'x', reasons: { r: { message: 'Hi {{ b }}.' } } });
    expect(r.success).toBe(false);
    expect(r.error!.issues.find((i) => i.path.join('.') === 'reasons.r.message')!.message).toBe(HOOK_REFUSAL_MESSAGE_HOLE_REFUSED);
  });

  it('prescribes the hole for a single-brace token over a declared param', () => {
    const r = HookRefusalSchema.safeParse({ message: 'The plan is {state}.', params: ['state'] });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toContain('{{ state }}');
  });

  it.each([['1a'], ['a-b'], ['$x']])('refuses the param name %j', (name) => {
    expect(HookRefusalSchema.safeParse({ message: 'x', params: [name] }).success).toBe(false);
  });

  it('refuses a param declared twice', () => {
    const r = HookRefusalSchema.safeParse({ message: 'x', params: ['a', 'a'] });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path.join('.')).toBe('params.1');
  });
});

describe('the translation address of a reason — `hooks.<hook>.refusals.<CODE>.reasons.<REASON>.message`', () => {
  it('is the key the runtime asks the i18n service for', () => {
    expect(hookRefusalMessageKey('plan_gate', 'VALIDATION_FAILED', 'plan_locked')).toBe(
      'hooks.plan_gate.refusals.VALIDATION_FAILED.reasons.plan_locked.message',
    );
    expect(hookRefusalMessageKey('plan_gate', 'VALIDATION_FAILED')).toBe('hooks.plan_gate.refusals.VALIDATION_FAILED.message');
  });

  it('is a path a translation bundle can write, holes kept', () => {
    const r = TranslationDataSchema.safeParse({
      hooks: { plan_gate: { refusals: { VALIDATION_FAILED: { reasons: { plan_locked: { message: '计划已{{ state }}。' } } } } } },
    }) as { success: true; data: any };
    expect(r.success).toBe(true);
    expect(r.data.hooks.plan_gate.refusals.VALIDATION_FAILED.reasons.plan_locked.message).toBe('计划已{{ state }}。');
  });

  it('refuses a key a reason translation does not hold', () => {
    const r = TranslationDataSchema.safeParse({ hooks: { h: { refusals: { C: { reasons: { r: { title: 'x' } } } } } } });
    expect(r.success).toBe(false);
  });
});
