import { describe, it, expect } from 'vitest';
import { HookSchema, HookRefusalSchema, HookContextSchema } from './hook.zod';
import {
  HOOK_REFUSAL_CODE_PATTERN,
  HOOK_REFUSAL_MESSAGE_HOLE_REFUSED,
  hookRefusalCodesThrownIn,
  hookRefusalsWithoutSandboxedBody,
  HOOK_REFUSAL_REASON_PATTERN,
  hookRefusalReasonsThrownIn,
  isUndeclaredThrownReason,
  undeclaredHookRefusalAtRun,
  unreadableHookRefusalListAtRun,
  undeclaredHookRefusalCodeAtSave,
  undeclaredHookRefusalReasonAtRun,
  undeclaredHookRefusalReasonAtSave,
} from './hook-refusal-codes';
import { hookRefusalMessageKey } from '../system/i18n-resolver';
import { TranslationDataSchema } from '../system/translation.zod';
import { hookForm } from './hook.metadata-form';

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

  it('reads no reason under a code with no `reasons` — a handler throwing one saves, as before', () => {
    const handler = async () => {
      const e: any = new Error('x');
      e.code = 'CREDIT_LIMIT';
      e.reason = 'over_by_far';
      throw e;
    };
    expect(HookSchema.safeParse({ ...base, handler, refusals: { CREDIT_LIMIT: { message: 'Over.' } } }).success).toBe(true);
  });

  it('a main-shaped body hook throwing a `reason` under a code with no `reasons` saves unchanged', () => {
    const r = HookSchema.safeParse({
      ...base,
      body: body("throw Object.assign(new Error('x'), { code: 'CREDIT_LIMIT', reason: 'plan_locked' });"),
      refusals: { CREDIT_LIMIT: { message: 'Over the credit limit.' } },
    });
    expect(r.success).toBe(true);
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

// The form row says who may declare a catalogue, and that is what HookSchema
// answers: a sandboxed js body or an in-process handler (the form offers the
// legacy `handler` row too), never an expression body.
describe('hookForm refusals row — help names every hook kind that may declare one', () => {
  type Row = { field?: string; helpText?: string; fields?: Row[] };
  const rows: Row[] = (hookForm.sections ?? []).flatMap((s) => (s.fields ?? []) as Row[]);
  const help = (field: string): string => {
    const found = rows.flatMap((r) => [r, ...(r.fields ?? [])]).filter((r) => r.field === field);
    expect(found).toHaveLength(1);
    return found[0].helpText ?? '';
  };

  it('names the handler beside the js body and does not limit the catalogue to js bodies', () => {
    const text = help('refusals');
    expect(text).toMatch(/\bhandler\b/);
    expect(text).not.toMatch(/bodies only/i);
  });

  it('the handler it names is a row the same form offers', () => {
    expect(help('handler')).not.toBe('');
  });
});

// #36877 (ruling 7178348458 letter A): one throw names an ordered list of
// declared reasons, `{ code, reasons: [{ reason, params? }, …] }`.
describe('hookRefusalReasonsThrownIn — the reasons of a thrown list (#36877)', () => {
  it.each([
    [
      "throw { code: 'SUBMIT_REFUSED', reasons: [{ reason: 'on_report', params: { name } }, { reason: 'approved' }] };",
      [{ code: 'SUBMIT_REFUSED', reason: 'on_report', listed: true }, { code: 'SUBMIT_REFUSED', reason: 'approved', listed: true }],
    ],
    [
      "const e = new Error('x'); e.code = 'SUBMIT_REFUSED'; e.reasons = [{ reason: 'approved' }]; throw e;",
      [{ code: 'SUBMIT_REFUSED', reason: 'approved', listed: true }],
    ],
    [
      // a single reason beside a list: each read as what it is
      "throw { code: 'C', reason: 'r', reasons: [{ reason: 'l' }] };",
      [{ code: 'C', reason: 'r' }, { code: 'C', reason: 'l', listed: true }],
    ],
    [
      // the list as a direct member of the object Object.assign stamps
      "throw Object.assign(new Error('x'), { code: 'C', reasons: [{ reason: 'l' }] });",
      [{ code: 'C', reason: 'l', listed: true }],
    ],
    [
      // CONTROL: a `reasons` key nested under `params` is not the thrown list
      // (the run reads `e.reasons` only), so its reason is read as main reads
      // any `reason: 'x'` in the statement: a single, unlisted pair
      "throw { code: 'C', params: { reasons: [{ reason: 'late' }] } };",
      [{ code: 'C', reason: 'late' }],
    ],
  ])('reads %j', (source, pairs) => {
    expect(hookRefusalReasonsThrownIn(source)).toEqual(pairs);
  });

  it.each([
    // a list built in a variable is the run-time refusal's
    "const lines = [{ reason: 'r' }]; throw { code: 'C', reasons: lines };",
    // a list on a name nobody throws
    "const e = {}; e.code = 'C'; e.reasons = [{ reason: 'r' }]; return e;",
    // inside a string or a comment
    "// throw { code: 'C', reasons: [{ reason: 'r' }] }\nreturn;",
  ])('reads nothing in %j', (source) => {
    expect(hookRefusalReasonsThrownIn(source)).toEqual([]);
  });

  it('isUndeclaredThrownReason: a listed reason is judged under every code, a single one only under a code with reasons', () => {
    expect(isUndeclaredThrownReason({ code: 'C', reason: 'r', listed: true }, undefined)).toBe(true);
    expect(isUndeclaredThrownReason({ code: 'C', reason: 'r' }, undefined)).toBe(false);
    expect(isUndeclaredThrownReason({ code: 'C', reason: 'r', listed: true }, { r: {} })).toBe(false);
    expect(isUndeclaredThrownReason({ code: 'C', reason: 'x', listed: true }, { r: {} })).toBe(true);
  });

  it('the run-time list fault names the hook, the code and what is wrong', () => {
    expect(unreadableHookRefusalListAtRun('expense_gate', 'SUBMIT_REFUSED', 'both')).toContain(
      "hook 'expense_gate' threw code 'SUBMIT_REFUSED' with both a `reason` and a `reasons` list",
    );
    expect(unreadableHookRefusalListAtRun('expense_gate', 'SUBMIT_REFUSED', 'empty')).toContain('names no reason');
    expect(unreadableHookRefusalListAtRun('expense_gate', 'SUBMIT_REFUSED', 'malformed')).toContain('not a list of');
  });
});

describe('Hook.refusals — a listed reason is refused at save where the body names it literally (#36877)', () => {
  const refusals = {
    SUBMIT_REFUSED: {
      message: 'Nothing was submitted.',
      reasons: { on_report: { message: 'Already on a report.' }, approved: { message: 'Already approved.' } },
    },
    PLAIN: { message: 'Refused.' },
  };

  it('accepts a list of declared reasons', () => {
    const r = HookSchema.safeParse({
      ...base,
      body: body("throw { code: 'SUBMIT_REFUSED', reasons: [{ reason: 'on_report' }, { reason: 'approved' }] };"),
      refusals,
    });
    expect(r.success).toBe(true);
  });

  it('refuses an undeclared listed reason at body.source, one issue, naming the declared reasons', () => {
    const r = HookSchema.safeParse({
      ...base,
      body: body("throw { code: 'SUBMIT_REFUSED', reasons: [{ reason: 'approved' }, { reason: 'missing' }] };"),
      refusals,
    });
    expect(r.success).toBe(false);
    const issues = r.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['body', 'source']);
    expect(issues[0]!.message).toBe(undeclaredHookRefusalReasonAtSave('SUBMIT_REFUSED', 'missing', ['on_report', 'approved'], 'body.source'));
  });

  it('refuses a listed reason under a code that declares no reasons (declared: none)', () => {
    const r = HookSchema.safeParse({
      ...base,
      body: body("const e = new Error('x'); e.code = 'PLAIN'; e.reasons = [{ reason: 'approved' }]; throw e;"),
      refusals,
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toContain('(declared: none)');
  });

  it('CONTROL: a `reasons` list nested under `params` is not a thrown list, so it saves under a code with no reasons', () => {
    const r = HookSchema.safeParse({
      ...base,
      body: body("throw { code: 'PLAIN', params: { reasons: [{ reason: 'late' }] } };"),
      refusals,
    });
    expect(r.success).toBe(true);
  });

  it('CONTROL: a single reason under a code that declares no reasons still saves, as before', () => {
    const r = HookSchema.safeParse({ ...base, body: body("throw { code: 'PLAIN', reason: 'anything' };"), refusals });
    expect(r.success).toBe(true);
  });
});

// A code or reason is literal only when its quoted value closes the value: a
// property's quote is followed by `,` or `}`; an assignment's by `;`, `,`, `}`,
// `)`, the source's end, or a line end whose next line does not continue the
// expression. A value built from a literal (`'OVER' + suffix`, a member access,
// a template hole) is computed, and the run-time refusal decides it, as the
// `hookRefusalCodesThrownIn` docblock says.
describe('Hook.refusals — a literal code or reason closes its value; one built from a literal is computed', () => {
  const refusals = {
    OVER_LIMIT: { message: 'Over the limit.', reasons: { too_high: { message: 'The amount is too high.' } } },
  };
  const codeSuffix = "const suffix = '_LIMIT';\n";
  const reasonSuffix = "const suffix = '_high';\n";

  const LITERAL_CODE = [
    ['a property closed by `}`', "throw { code: 'OVER' };"],
    ['a property closed by `,`', "throw { code: 'OVER', reason: 'too_high' };"],
    ['a property with a line break before the close', "throw {\n  code: 'OVER'\n};"],
    ['a property with a comment before the close', "throw { code: 'OVER' /* the cap */ };"],
    ['a property in a backtick with no hole', 'throw { code: `OVER` };'],
    ['a property in Object.assign', "throw Object.assign(new Error('x'), { code: 'OVER' });"],
    ['an assignment closed by `;`', "const e = new Error('x'); e.code = 'OVER'; throw e;"],
    ['an assignment closed by a line end', "const e = new Error('x')\ne.code = 'OVER'\nthrow e"],
    ['an assignment closed by a comment and a line end', "const e = new Error('x');\ne.code = 'OVER' // the cap\nthrow e;"],
    ['an assignment closed by `,`', "const e = new Error('x'); e.code = 'OVER', e.reason = 'too_high'; throw e;"],
    ['an assignment closed by `}`', "const e = new Error('x'); if (ctx.input.x) { e.code = 'OVER' } throw e;"],
    ['an assignment closed by `)`', "const e = new Error('x'); (e.code = 'OVER'); throw e;"],
    ['an assignment at the source end', "const e = new Error('x'); if (ctx.input.x) throw e; e.code = 'OVER'"],
  ] as const;

  it.each(LITERAL_CODE)('lit: refuses an undeclared literal code written as %s, at body.source', (_shape, source) => {
    expect(hookRefusalCodesThrownIn(source)).toEqual(['OVER']);
    const r = HookSchema.safeParse({ ...base, refusals, body: body(source) });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'body.source')!;
    expect(issue.message).toBe(undeclaredHookRefusalCodeAtSave('OVER', ['OVER_LIMIT']));
  });

  const COMPUTED_CODE = [
    ['a property concatenation', "throw { code: 'OVER' + suffix };"],
    ['a property concatenation on the next line', "throw { code: 'OVER'\n  + suffix };"],
    ['a property backtick concatenation', 'throw { code: `OVER` + suffix };'],
    ['a property member access', "throw { code: 'OVER'.concat(suffix) };"],
    ['a property template hole', 'throw { code: `OVER${suffix}` };'],
    ['an assignment concatenation', "const e = new Error('x'); e.code = 'OVER' + suffix; throw e;"],
    ['an assignment concatenation on the next line', "const e = new Error('x');\ne.code = 'OVER'\n  + suffix\nthrow e;"],
    ['an assignment member access on the next line', "const e = new Error('x');\ne.code = 'OVER'\n  .concat(suffix)\nthrow e;"],
    ['an assignment backtick concatenation', "const e = new Error('x'); e.code = `OVER` + suffix; throw e;"],
  ] as const;

  it.each(COMPUTED_CODE)('dark: passes the save for a code built from a literal by %s (the run-time refusal decides it)', (_shape, source) => {
    expect(hookRefusalCodesThrownIn(source)).toEqual([]);
    expect(HookSchema.safeParse({ ...base, refusals, body: body(codeSuffix + source) }).success).toBe(true);
  });

  const LITERAL_REASON = [
    ['a property closed by `}`', "throw { code: 'OVER_LIMIT', reason: 'too' };"],
    ['a property closed by `,`', "throw { code: 'OVER_LIMIT', reason: 'too', params: {} };"],
    ['a property in a listed reason', "throw { code: 'OVER_LIMIT', reasons: [{ reason: 'too' }] };"],
    ['an assignment closed by `;`', "const e = new Error('x'); e.code = 'OVER_LIMIT'; e.reason = 'too'; throw e;"],
    ['an assignment closed by a line end', "const e = new Error('x')\ne.code = 'OVER_LIMIT'\ne.reason = 'too'\nthrow e"],
  ] as const;

  it.each(LITERAL_REASON)('lit: refuses an undeclared literal reason written as %s, at body.source', (_shape, source) => {
    expect(hookRefusalReasonsThrownIn(source).map((p) => p.reason)).toEqual(['too']);
    const r = HookSchema.safeParse({ ...base, refusals, body: body(source) });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'body.source')!;
    expect(issue.message).toBe(undeclaredHookRefusalReasonAtSave('OVER_LIMIT', 'too', ['too_high'], 'body.source'));
  });

  const COMPUTED_REASON = [
    ['a property concatenation', "throw { code: 'OVER_LIMIT', reason: 'too' + suffix };"],
    ['a property member access', "throw { code: 'OVER_LIMIT', reason: 'too'.concat(suffix) };"],
    ['a listed property concatenation', "throw { code: 'OVER_LIMIT', reasons: [{ reason: 'too' + suffix }] };"],
    ['an assignment concatenation', "const e = new Error('x'); e.code = 'OVER_LIMIT'; e.reason = 'too' + suffix; throw e;"],
    ['an assignment concatenation on the next line', "const e = new Error('x');\ne.code = 'OVER_LIMIT';\ne.reason = 'too'\n  + suffix\nthrow e;"],
  ] as const;

  it.each(COMPUTED_REASON)('dark: passes the save for a reason built from a literal by %s (the run-time refusal decides it)', (_shape, source) => {
    expect(hookRefusalReasonsThrownIn(source)).toEqual([]);
    expect(HookSchema.safeParse({ ...base, refusals, body: body(reasonSuffix + source) }).success).toBe(true);
  });

  it('dark: an inline handler building its code by concatenation passes the save, at handler', () => {
    const handler = async () => {
      const suffix = '_LIMIT';
      throw Object.assign(new Error('x'), { code: 'OVER' + suffix });
    };
    expect(HookSchema.safeParse({ ...base, handler, refusals }).success).toBe(true);
  });

  it('CONTROL: a literal code beside a computed one in the same body is still refused, once', () => {
    const source = `${codeSuffix}if (ctx.input.x) throw { code: 'OVER' + suffix };\nthrow { code: 'OVER' };`;
    expect(hookRefusalCodesThrownIn(source)).toEqual(['OVER']);
    const r = HookSchema.safeParse({ ...base, refusals, body: body(source) });
    expect(r.success).toBe(false);
    expect(r.error!.issues.filter((i) => i.path.join('.') === 'body.source')).toHaveLength(1);
  });
});
