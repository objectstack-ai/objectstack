import { describe, it, expect } from 'vitest';
import { ActionSchema, ActionTextSchema } from './action.zod';
import { HookTextSchema } from '../data/hook.zod';
import {
  ACTION_TEXT_MESSAGE_HOLE_REFUSED,
  HOOK_TEXT_MESSAGE_HOLE_REFUSED,
  actionTextsWithoutRunnableCode,
  hookTextsWithoutRunnableCode,
  undeclaredActionTextAtRun,
  undeclaredActionTextKeyAtSave,
  undeclaredHookTextAtRun,
  undeclaredHookTextKeyAtSave,
} from '../data/hook-refusal-codes';
import { actionTextMessageKey } from '../system/i18n-resolver';
import { TranslationDataSchema } from '../system/translation.zod';

// #34374 PR2 (ruling 6913660232 option B, parameter 7): an action declares the
// sentences its body writes into records, `texts: { <key>: { message, params? } }`
// — the hook texts' twin — and its sandboxed body asks for one by key with
// `ctx.text(key, params)`; the runtime answers it in the organization's language.

const base = { name: 'send_email', label: 'Send email', objectName: 'crm_contact', type: 'script' as const };
const body = (source: string) => ({ language: 'js' as const, source });
/** HotCRM's `send_email` action wrote `'Email: ' + subject`; the declared text is the same sentence, asked for by key. */
const ASKS = "const line = await ctx.text('email_subject', { subject: input.subject });";
const TEXTS = { email_subject: { message: 'Email: {{ subject }}', params: ['subject'] } };

const issuesOf = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
  r.success ? [] : r.error!.issues;

describe('Action.texts — the declared texts', () => {
  it('accepts snake_case keys with a message and the params its holes name (the HotCRM send_email sentence)', () => {
    const parsed = ActionSchema.parse({ ...base, body: body(ASKS), texts: TEXTS });
    expect(parsed.texts?.email_subject).toEqual({ message: 'Email: {{ subject }}', params: ['subject'] });
  });

  it('CONTROL: is optional — an action that declares no texts parses as before', () => {
    expect(ActionSchema.parse({ ...base, body: body('return;') }).texts).toBeUndefined();
  });

  it('refuses a key that is not snake_case, at `texts`', () => {
    const r = ActionSchema.safeParse({ ...base, body: body('return;'), texts: { EmailSubject: { message: 'x' } } });
    expect(r.success).toBe(false);
    expect(issuesOf(r).some((i) => i.path[0] === 'texts')).toBe(true);
  });

  it('is a closed entry — a key the text entry does not hold (a refusal\'s `status`) is refused', () => {
    expect(ActionTextSchema.safeParse({ message: 'x', status: 400 }).success).toBe(false);
    expect(ActionTextSchema.safeParse({ message: 'x', reasons: {} }).success).toBe(false);
  });

  it('refuses an empty message', () => {
    expect(ActionTextSchema.safeParse({ message: '   ' }).success).toBe(false);
  });

  it('refuses a param that is not an identifier, and a param declared twice', () => {
    const bad = ActionTextSchema.safeParse({ message: 'Email: {{ subject }}', params: ['the subject'] });
    expect(bad.success).toBe(false);
    expect(issuesOf(bad).some((i) => i.path.join('.') === 'params.0')).toBe(true);
    const twice = ActionTextSchema.safeParse({ message: 'Email: {{ subject }}', params: ['subject', 'subject'] });
    expect(twice.success).toBe(false);
    expect(issuesOf(twice).some((i) => i.path.join('.') === 'params.1')).toBe(true);
  });

  it('refuses a {{ }} hole in a message whose entry declares no params, in the action\'s words; CONTROL: declared params allow it', () => {
    const r = ActionTextSchema.safeParse({ message: 'Email: {{ subject }}' });
    expect(r.success).toBe(false);
    expect(issuesOf(r).find((i) => i.path.join('.') === 'message')!.message).toBe(ACTION_TEXT_MESSAGE_HOLE_REFUSED);
    expect(ACTION_TEXT_MESSAGE_HOLE_REFUSED).toMatch(/^An action text `message`/);
    expect(ActionTextSchema.safeParse(TEXTS.email_subject).success).toBe(true);
  });

  it('refuses a hole over a name the entry does not declare, naming the action text slot', () => {
    const r = ActionTextSchema.safeParse({ message: 'Email: {{ body }}', params: ['subject'] });
    expect(r.success).toBe(false);
    const issue = issuesOf(r).find((i) => i.path.join('.') === 'message')!;
    expect(issue.message).toContain('An action text `message`');
    expect(issue.message).toContain('body');
  });

  it('renames a near-miss spelling of message and params onto the declared keys, loudly', () => {
    for (const doc of [{ text: 'Email' }, { template: 'Email' }, { message: 'Email', parameters: ['subject'] }]) {
      const r = ActionTextSchema.safeParse(doc);
      expect(r.success).toBe(false);
      expect(JSON.stringify(issuesOf(r))).toMatch(/message|params/);
    }
  });

  it.each([
    ['no body', { type: 'script' }, 'no `body`'],
    ['an expression body', { type: 'script', body: { language: 'expression', source: 'record.amount > 0' } }, 'a `expression` body'],
    ['a url action', { type: 'url', target: 'https://example.com' }, "`type: 'url'`"],
    ['a flow action', { type: 'flow', target: 'send_email_flow' }, "`type: 'flow'`"],
    ['an api action', { type: 'api', target: '/api/v1/email' }, "`type: 'api'`"],
  ])('refuses texts on an action that runs no js body of its own — %s', (_label, shape, says) => {
    const r = ActionSchema.safeParse({ ...base, ...shape, texts: TEXTS });
    expect(r.success).toBe(false);
    const issue = issuesOf(r).find((i) => i.path.join('.') === 'texts');
    expect(issue?.message).toContain(says);
    expect(issue?.message).toContain('drop `texts`');
  });

  it('accepts texts on an action whose `type` is omitted (the schema default is `script`)', () => {
    const { type: _omit, ...untyped } = base;
    expect(ActionSchema.safeParse({ ...untyped, body: body(ASKS), texts: TEXTS }).success).toBe(true);
  });

  it('accepts texts on an object-less action', () => {
    const { objectName: _omit, ...objectLess } = base;
    expect(ActionSchema.safeParse({ ...objectLess, body: body(ASKS), texts: TEXTS }).success).toBe(true);
  });
});

describe('Action.texts — a key the body asks for literally is refused at save when undeclared', () => {
  it('refuses a literal ctx.text key that texts does not declare, at body.source, naming the declared keys', () => {
    const r = ActionSchema.safeParse({ ...base, body: body("await ctx.text('email_body');"), texts: TEXTS });
    expect(r.success).toBe(false);
    const issue = issuesOf(r).find((i) => i.path.join('.') === 'body.source')!;
    expect(issue.message).toBe(undeclaredActionTextKeyAtSave('email_body', ['email_subject']));
    expect(issue.message).toContain("this action's `texts`");
  });

  it('CONTROL: a declared key, a key in a comment or a longer string, and a computed key all pass the save', () => {
    const source = [
      ASKS,
      "// await ctx.text('not_declared')",
      "const note = \"ctx.text('not_declared') is how\";",
      'const k = pick(); await ctx.text(k);',
    ].join('\n');
    expect(ActionSchema.safeParse({ ...base, body: body(source), texts: TEXTS }).success).toBe(true);
  });

  it('CONTROL: an action that declares no texts is not read for ctx.text calls (the run-time fault names it)', () => {
    expect(ActionSchema.safeParse({ ...base, body: body("await ctx.text('anything');") }).success).toBe(true);
    expect(undeclaredActionTextAtRun('send_email', 'anything', [])).toMatch(/^action 'send_email' asked for text 'anything'.*declared: none/);
  });
});

describe('the shared declared-entry factory — one text entry, the words per subject', () => {
  it('the hook and action text entries accept and refuse the same documents', () => {
    const docs = [
      { message: 'Email: {{ subject }}', params: ['subject'] },
      { message: 'Plain sentence' },
      { message: 'Email: {{ subject }}' },
      { message: 'Email: {{ other }}', params: ['subject'] },
      { message: 'x', status: 400 },
      { message: '' },
    ];
    for (const doc of docs) {
      expect(ActionTextSchema.safeParse(doc).success, JSON.stringify(doc)).toBe(HookTextSchema.safeParse(doc).success);
    }
  });

  it('each subject keeps its own words — the hook sentences are unchanged', () => {
    expect(HOOK_TEXT_MESSAGE_HOLE_REFUSED).toMatch(/^A hook text `message`.*params: \['lead'\].*ctx\.text\('KEY', \{ lead \}\)/);
    expect(ACTION_TEXT_MESSAGE_HOLE_REFUSED).toMatch(/params: \['subject'\].*ctx\.text\('KEY', \{ subject \}\)/);
    expect(undeclaredHookTextKeyAtSave('a', ['b'])).toContain("this hook's `texts`");
    expect(undeclaredHookTextAtRun('h', 'a', [])).toMatch(/^hook 'h' asked for text 'a'/);
    expect(hookTextsWithoutRunnableCode(undefined)).toContain('no `body` and no `handler`');
    expect(actionTextsWithoutRunnableCode('url', undefined)).toContain("`type: 'url'`, which runs no code of the action's own");
  });

  it('the action text guidance names both translation addresses, with no tracker number', () => {
    const r = ActionTextSchema.safeParse({ message: 'x', locale: 'en' });
    expect(r.success).toBe(false);
    const said = issuesOf(r).map((i) => i.message).join(' ');
    expect(said).toContain('objects.OBJ._actions.ACT.texts.KEY.message');
    expect(said).toContain('globalActions.ACT.texts.KEY.message');
    expect(said).not.toMatch(/#\d/);
  });
});

describe('the translation address — beside the action\'s other copy', () => {
  it('a bound action: `objects.<object>._actions.<action>.texts.<key>.message`', () => {
    expect(actionTextMessageKey('crm_contact', 'send_email', 'email_subject'))
      .toBe('objects.crm_contact._actions.send_email.texts.email_subject.message');
  });

  it('an object-less action: `globalActions.<action>.texts.<key>.message`', () => {
    expect(actionTextMessageKey(undefined, 'send_email', 'email_subject')).toBe('globalActions.send_email.texts.email_subject.message');
    expect(actionTextMessageKey('', 'send_email', 'email_subject')).toBe('globalActions.send_email.texts.email_subject.message');
  });

  it('is a path a translation bundle can write, at both addresses', () => {
    expect(TranslationDataSchema.safeParse({
      objects: { crm_contact: { _actions: { send_email: { texts: { email_subject: { message: '邮件：{{ subject }}' } } } } } },
      globalActions: { send_email: { texts: { email_subject: { message: '邮件：{{ subject }}' } } } },
    }).success).toBe(true);
  });

  it('refuses a key an action text translation does not hold, and names `text` as the rename onto `texts` it is', () => {
    expect(TranslationDataSchema.safeParse({
      globalActions: { send_email: { texts: { email_subject: { message: 'x', status: 400 } } } },
    }).success).toBe(false);
    const renamed = TranslationDataSchema.safeParse({
      globalActions: { send_email: { text: { email_subject: { message: 'x' } } } },
    });
    expect(renamed.success).toBe(false);
    expect(JSON.stringify(renamed.error!.issues)).toMatch(/texts/);
  });
});
