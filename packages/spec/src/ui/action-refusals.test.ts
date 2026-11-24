import { describe, it, expect } from 'vitest';
import { ActionSchema, ActionRefusalSchema } from './action.zod';
import { HookRefusalSchema, HookTextSchema } from '../data/hook.zod';
import {
  ACTION_REFUSAL_MESSAGE_HOLE_REFUSED,
  HOOK_REFUSAL_MESSAGE_HOLE_REFUSED,
  HOOK_TEXT_MESSAGE_HOLE_REFUSED,
  actionRefusalsWithoutSandboxedBody,
  undeclaredActionRefusalAtRun,
  undeclaredActionRefusalCodeAtSave,
  undeclaredActionRefusalReasonAtRun,
  undeclaredActionRefusalReasonAtSave,
  undeclaredHookRefusalAtRun,
  undeclaredHookRefusalCodeAtSave,
} from '../data/hook-refusal-codes';
import { actionRefusalMessageKey } from '../system/i18n-resolver';
import { TranslationDataSchema } from '../system/translation.zod';

// #34273: an action declares its refusal catalogue the way a hook does
// (`HookSchema.refusals`, #26170 ruling 6431311681 letter A; #33214 ruling
// 6879477573) — `refusals: { <CODE>: { message, status?, reasons?, params? } }`
// — and its sandboxed body refuses by code only.

const base = { name: 'submit_signoff', label: 'Submit', objectName: 'crm_invoice', type: 'script' as const };
const body = (source: string) => ({ language: 'js' as const, source });

const issuesOf = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
  r.success ? [] : r.error!.issues;

describe('Action.refusals — the declared catalogue', () => {
  it('accepts a catalogue of SCREAMING_SNAKE codes with a message and an optional 4xx status', () => {
    const parsed = ActionSchema.parse({
      ...base,
      body: body("throw Object.assign(new Error('x'), { code: 'NOT_DRAFT' });"),
      refusals: {
        NOT_DRAFT: { message: 'Only a draft invoice can be signed off.', status: 409 },
        SIGN_IN_REQUIRED: { message: 'Sign in first.', status: 401 },
      },
    });
    expect(parsed.refusals?.NOT_DRAFT).toEqual({ message: 'Only a draft invoice can be signed off.', status: 409 });
    expect(parsed.refusals?.SIGN_IN_REQUIRED.status).toBe(401);
  });

  it('CONTROL: is optional — an action with no catalogue parses as before', () => {
    const parsed = ActionSchema.parse({ ...base, body: body("throw new Error('no');") });
    expect(parsed.refusals).toBeUndefined();
  });

  it('refuses a code that is not SCREAMING_SNAKE, at `refusals`', () => {
    const r = ActionSchema.safeParse({ ...base, body: body('return;'), refusals: { notDraft: { message: 'x' } } });
    expect(r.success).toBe(false);
    expect(issuesOf(r).some((i) => i.path[0] === 'refusals')).toBe(true);
  });

  it('refuses an empty message and a 5xx status', () => {
    expect(ActionSchema.safeParse({ ...base, body: body('return;'), refusals: { NO: { message: '  ' } } }).success).toBe(false);
    expect(
      ActionSchema.safeParse({ ...base, body: body('return;'), refusals: { NO: { message: 'x', status: 500 } } }).success,
    ).toBe(false);
  });

  it.each([
    ['no body', { type: 'script' }, "no `body` (an inline `target` function `os build` could not lower leaves none)"],
    ['an expression body', { type: 'script', body: { language: 'expression', source: 'record.amount > 0' } }, 'a `expression` body'],
    ['a url action', { type: 'url', target: 'https://example.com' }, "`type: 'url'`"],
    ['a flow action', { type: 'flow', target: 'approve_invoice' }, "`type: 'flow'`"],
  ])('refuses a catalogue on an action that runs no js body of its own — %s', (_label, shape, says) => {
    const r = ActionSchema.safeParse({ ...base, ...shape, refusals: { NOT_DRAFT: { message: 'x' } } });
    expect(r.success).toBe(false);
    const issue = issuesOf(r).find((i) => i.path.join('.') === 'refusals');
    expect(issue?.message).toContain(says);
    expect(issue?.message).toContain('drop `refusals`');
  });

  it('accepts a catalogue on an action whose `type` is omitted (the schema default is `script`)', () => {
    const { type: _omit, ...untyped } = base;
    expect(ActionSchema.safeParse({ ...untyped, body: body('return;'), refusals: { NOT_DRAFT: { message: 'x' } } }).success)
      .toBe(true);
  });

  it('names `httpStatus` as the rename onto `status` it is', () => {
    const r = ActionSchema.safeParse({ ...base, body: body('return;'), refusals: { NO: { message: 'x', httpStatus: 409 } } });
    expect(r.success).toBe(false);
    expect(issuesOf(r).find((i) => i.path.join('.').startsWith('refusals.NO'))?.message).toContain('`httpStatus` → `status`');
  });
});

describe('Action.refusals — an undeclared code or reason is refused at save where the body names it literally', () => {
  const refusals = {
    NOT_DRAFT: { message: 'Only a draft invoice can be signed off.' },
    STAGE_LOCKED: { message: 'Locked.', reasons: { closed: { message: 'Closed.' } } },
  };

  it('refuses a literal `code:` the catalogue does not declare, at `body.source`, naming the declared codes', () => {
    const r = ActionSchema.safeParse({
      ...base,
      body: body("throw Object.assign(new Error('x'), { code: 'NOT_DRAFTT' });"),
      refusals,
    });
    expect(r.success).toBe(false);
    const issue = issuesOf(r).find((i) => i.path.join('.') === 'body.source');
    expect(issue?.message).toBe(undeclaredActionRefusalCodeAtSave('NOT_DRAFTT', ['NOT_DRAFT', 'STAGE_LOCKED']));
    expect(issue?.message).toContain("this action's `refusals` declares no such code");
  });

  it('refuses a literal reason a code with `reasons` does not declare, at `body.source`', () => {
    const r = ActionSchema.safeParse({
      ...base,
      body: body("throw { code: 'STAGE_LOCKED', reason: 'clsoed' };"),
      refusals,
    });
    expect(r.success).toBe(false);
    const issue = issuesOf(r).find((i) => i.path.join('.') === 'body.source');
    expect(issue?.message).toBe(undeclaredActionRefusalReasonAtSave('STAGE_LOCKED', 'clsoed', ['closed']));
  });

  it('CONTROL: accepts a body whose literal codes and reasons are all declared', () => {
    expect(ActionSchema.safeParse({
      ...base,
      body: body("if (ctx.input.a) throw { code: 'STAGE_LOCKED', reason: 'closed' }; throw { code: 'NOT_DRAFT' };"),
      refusals,
    }).success).toBe(true);
  });

  it('CONTROL: leaves a computed code to the run-time refusal', () => {
    expect(ActionSchema.safeParse({
      ...base,
      body: body("const c = 'NOT_' + 'X'; throw Object.assign(new Error('x'), { code: c });"),
      refusals,
    }).success).toBe(true);
  });

  it('CONTROL: reads nothing when the action declares no catalogue — its throws save as before', () => {
    expect(ActionSchema.safeParse({
      ...base,
      body: body("throw Object.assign(new Error('x'), { code: 'ANY_CODE' });"),
    }).success).toBe(true);
  });
});

describe('ActionRefusal.reasons and .params — the hook entry\'s rules', () => {
  it('accepts a hole over a declared param in the message and in a reason', () => {
    expect(ActionRefusalSchema.safeParse({
      message: 'Stage {{ stage }} is locked.',
      params: ['stage'],
      reasons: { closed: { message: 'A {{ stage | upper }} deal is closed.' } },
    }).success).toBe(true);
  });

  it('refuses a hole over a name the entry does not declare, naming the action slot', () => {
    const r = ActionRefusalSchema.safeParse({ message: 'Stage {{ phase }} is locked.', params: ['stage'] });
    expect(r.success).toBe(false);
    const issue = issuesOf(r).find((i) => i.path.join('.') === 'message');
    expect(issue?.message).toContain('An action refusal `message`');
  });

  it('refuses every hole when the entry declares no params, with the action sentence', () => {
    const r = ActionRefusalSchema.safeParse({ message: 'Stage {{ stage }} is locked.' });
    expect(issuesOf(r).find((i) => i.path.join('.') === 'message')?.message).toBe(ACTION_REFUSAL_MESSAGE_HOLE_REFUSED);
    const reason = ActionRefusalSchema.safeParse({ message: 'x', reasons: { closed: { message: '{{ stage }}' } } });
    expect(issuesOf(reason).find((i) => i.path.join('.') === 'reasons.closed.message')?.message)
      .toBe(ACTION_REFUSAL_MESSAGE_HOLE_REFUSED);
  });

  it('refuses a reason that is not snake_case, and a param declared twice', () => {
    expect(ActionRefusalSchema.safeParse({ message: 'x', reasons: { Closed: { message: 'y' } } }).success).toBe(false);
    const r = ActionRefusalSchema.safeParse({ message: '{{ stage }}', params: ['stage', 'stage'] });
    expect(issuesOf(r).find((i) => i.path.join('.') === 'params.1')?.message).toContain("names 'stage' twice");
  });
});

describe('the shared declared-entry factory — one shape, the words per subject', () => {
  it('the hook and action refusal entries accept and refuse the same documents', () => {
    const docs: unknown[] = [
      { message: 'x' },
      { message: 'x', status: 409 },
      { message: '{{ a }}', params: ['a'] },
      { message: 'x', reasons: { r: { message: 'y' } } },
      { message: '' },
      { message: 'x', status: 500 },
      { message: '{{ b }}', params: ['a'] },
      { message: 'x', code: 'X' },
      { message: 'x', extra: 1 },
    ];
    for (const doc of docs) {
      expect(ActionRefusalSchema.safeParse(doc).success, JSON.stringify(doc))
        .toBe(HookRefusalSchema.safeParse(doc).success);
    }
  });

  it('each subject keeps its own words — the hook sentences are unchanged', () => {
    expect(issuesOf(HookRefusalSchema.safeParse({ message: '{{ a }}' }))[0]?.message).toBe(HOOK_REFUSAL_MESSAGE_HOLE_REFUSED);
    expect(issuesOf(HookTextSchema.safeParse({ message: '{{ a }}' }))[0]?.message).toBe(HOOK_TEXT_MESSAGE_HOLE_REFUSED);
    expect(issuesOf(ActionRefusalSchema.safeParse({ message: '{{ a }}' }))[0]?.message).toBe(ACTION_REFUSAL_MESSAGE_HOLE_REFUSED);
  });

  it('a text entry is the core with no `status` or `reasons`', () => {
    expect(HookTextSchema.safeParse({ message: 'Follow up {{ lead }}', params: ['lead'] }).success).toBe(true);
    expect(HookTextSchema.safeParse({ message: 'x', status: 400 }).success).toBe(false);
    expect(HookTextSchema.safeParse({ message: 'x', reasons: {} }).success).toBe(false);
  });
});

describe('the run-time sentences name the action', () => {
  it('an undeclared code is a fault naming the action, the code and the declared codes', () => {
    const m = undeclaredActionRefusalAtRun('submit_signoff', 'NOT_DRAFTT', ['NOT_DRAFT']);
    expect(m).toContain("action 'submit_signoff' threw code 'NOT_DRAFTT'");
    expect(m).toContain('NOT_DRAFT');
    // The hook twin is unchanged by the shared core.
    expect(undeclaredHookRefusalAtRun('credit_guard', 'X', ['Y'])).toContain("hook 'credit_guard' threw code 'X'");
    expect(undeclaredHookRefusalCodeAtSave('X', ['Y'])).toContain("this hook's `refusals` declares no such code");
  });

  it('an undeclared reason names the action, the code and the reason', () => {
    expect(undeclaredActionRefusalReasonAtRun('submit_signoff', 'STAGE_LOCKED', 'clsoed', ['closed']))
      .toContain("action 'submit_signoff' threw code 'STAGE_LOCKED' with reason 'clsoed'");
  });

  it('the catalogue-without-body refusal names the type', () => {
    expect(actionRefusalsWithoutSandboxedBody('url', undefined)).toContain("`type: 'url'`");
  });
});

describe('the translation address — beside the action\'s other copy', () => {
  it('a bound action: `objects.<object>._actions.<action>.refusals.<CODE>.message`', () => {
    expect(actionRefusalMessageKey('crm_invoice', 'submit_signoff', 'NOT_DRAFT'))
      .toBe('objects.crm_invoice._actions.submit_signoff.refusals.NOT_DRAFT.message');
    expect(actionRefusalMessageKey('crm_invoice', 'submit_signoff', 'STAGE_LOCKED', 'closed'))
      .toBe('objects.crm_invoice._actions.submit_signoff.refusals.STAGE_LOCKED.reasons.closed.message');
  });

  it('an object-less action: `globalActions.<action>.refusals.<CODE>.message`', () => {
    expect(actionRefusalMessageKey(undefined, 'export_all', 'NOT_ALLOWED'))
      .toBe('globalActions.export_all.refusals.NOT_ALLOWED.message');
    expect(actionRefusalMessageKey('', 'export_all', 'NOT_ALLOWED', 'quota'))
      .toBe('globalActions.export_all.refusals.NOT_ALLOWED.reasons.quota.message');
  });

  it('is a path a translation bundle can write, at both addresses, reasons included', () => {
    const r = TranslationDataSchema.safeParse({
      objects: {
        crm_invoice: {
          _actions: {
            submit_signoff: {
              refusals: {
                NOT_DRAFT: { message: '只有草稿发票可以签核。' },
                STAGE_LOCKED: { message: '已锁定。', reasons: { closed: { message: '{{ stage }} 已关闭。' } } },
              },
            },
          },
        },
      },
      globalActions: { export_all: { refusals: { NOT_ALLOWED: { message: '' } } } },
    }) as { success: true; data: any };
    expect(r.success).toBe(true);
    expect(r.data.objects.crm_invoice._actions.submit_signoff.refusals.NOT_DRAFT.message).toBe('只有草稿发票可以签核。');
    expect(r.data.globalActions.export_all.refusals.NOT_ALLOWED.message).toBe('');
  });

  it('refuses a key an action refusal translation does not hold, and names `refusal` as the rename it is', () => {
    expect(TranslationDataSchema.safeParse({
      globalActions: { export_all: { refusals: { NOT_ALLOWED: { label: 'x' } } } },
    }).success).toBe(false);
    const r = TranslationDataSchema.safeParse({ globalActions: { export_all: { refusal: {} } } });
    expect(r.success).toBe(false);
    expect(issuesOf(r).find((i) => /unrecognized|rename|→/.test(i.message))?.message).toContain('`refusal` → `refusals`');
  });
});
