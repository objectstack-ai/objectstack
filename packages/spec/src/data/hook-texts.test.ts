import { describe, it, expect } from 'vitest';
import { HookSchema, HookTextSchema } from './hook.zod';
import {
  HOOK_TEXT_KEY_PATTERN,
  HOOK_TEXT_MESSAGE_HOLE_REFUSED,
  hookTextKeysAskedIn,
  hookTextsWithoutRunnableCode,
  undeclaredHookTextAtRun,
  undeclaredHookTextKeyAtSave,
} from './hook-refusal-codes';
import { hookTextMessageKey } from '../system/i18n-resolver';
import { TranslationDataSchema } from '../system/translation.zod';

// #34374 (ruling 6913660232 option B, parameter 7): a hook declares the
// sentences it writes into records, `texts: { <key>: { message, params? } }`,
// and asks for one by key with `ctx.text(key, params)`; the runtime answers it
// in the organization's language.

const base = { name: 'lead_follow_up', object: 'crm_lead', events: ['afterUpdate' as const] };
const body = (source: string) => ({ language: 'js' as const, source });
const ASKS = "const s = await ctx.text('follow_up_subject', { lead: ctx.input.name });";

describe('Hook.texts — the declared texts', () => {
  it('accepts snake_case keys with a message and the params its holes name', () => {
    const parsed = HookSchema.parse({
      ...base,
      body: body(ASKS),
      texts: { follow_up_subject: { message: 'Follow up with qualified lead: {{ lead }}', params: ['lead'] } },
    });
    expect(parsed.texts?.follow_up_subject).toEqual({ message: 'Follow up with qualified lead: {{ lead }}', params: ['lead'] });
  });

  it('is optional — a hook that declares no texts is unchanged', () => {
    expect(HookSchema.parse({ ...base, body: body('return;') }).texts).toBeUndefined();
  });

  it('refuses a key that is not snake_case, at the key', () => {
    expect(HOOK_TEXT_KEY_PATTERN.test('follow_up_subject')).toBe(true);
    const r = HookSchema.safeParse({ ...base, body: body('return;'), texts: { FollowUp: { message: 'x' } } });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path[0] === 'texts')).toBe(true);
  });

  it('refuses a {{ }} hole in a message whose entry declares no params; CONTROL: declared params allow it', () => {
    const r = HookTextSchema.safeParse({ message: 'Follow up with {{ lead }}' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.find((i) => i.path.join('.') === 'message')!.message).toBe(HOOK_TEXT_MESSAGE_HOLE_REFUSED);
    expect(HookTextSchema.safeParse({ message: 'Follow up with {{ lead }}', params: ['lead'] }).success).toBe(true);
  });

  it('refuses a hole over a name the entry does not declare, and a param declared twice', () => {
    const hole = HookTextSchema.safeParse({ message: 'Follow up with {{ account }}', params: ['lead'] });
    expect(hole.success).toBe(false);
    expect(hole.error!.issues.some((i) => i.path.join('.') === 'message')).toBe(true);
    const twice = HookTextSchema.safeParse({ message: 'Follow up with {{ lead }}', params: ['lead', 'lead'] });
    expect(twice.success).toBe(false);
    expect(twice.error!.issues.some((i) => i.path.join('.') === 'params.1')).toBe(true);
  });

  it('renames a near-miss spelling of message onto the declared key, loudly', () => {
    const r = HookTextSchema.safeParse({ text: 'Follow up' });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error!.issues)).toMatch(/message/);
  });

  it('refuses texts on a hook whose code cannot ask for one (an expression body, or neither body nor handler)', () => {
    for (const rest of [{ body: { language: 'expression' as const, source: 'true' } }, {}]) {
      const r = HookSchema.safeParse({ ...base, ...rest, texts: { follow_up_subject: { message: 'x' } } });
      expect(r.success).toBe(false);
      const issue = r.error!.issues.find((i) => i.path.join('.') === 'texts')!;
      expect(issue.message).toBe(hookTextsWithoutRunnableCode('body' in rest ? 'expression' : undefined));
    }
  });

  it('accepts texts on a hook with an in-process handler (the build lowers it to a js body)', () => {
    expect(HookSchema.safeParse({ ...base, handler: 'leadFollowUp', texts: { follow_up_subject: { message: 'x' } } }).success).toBe(true);
  });
});

describe('Hook.texts — a key the source asks for literally is refused at save when undeclared', () => {
  const texts = { follow_up_subject: { message: 'Follow up', params: ['lead'] } };

  it('refuses a literal ctx.text key that texts does not declare, at body.source', () => {
    const r = HookSchema.safeParse({ ...base, body: body("await ctx.text('follow_up_title');"), texts });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'body.source')!;
    expect(issue.message).toBe(undeclaredHookTextKeyAtSave('follow_up_title', ['follow_up_subject'], 'body.source'));
  });

  it('reads an inline handler\'s own source, at handler', () => {
    const handler = async (ctx: any) => { await ctx.text('follow_up_title'); };
    const r = HookSchema.safeParse({ ...base, handler, texts });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path.join('.') === 'handler')).toBe(true);
  });

  it('CONTROL: a declared key, a key in a comment or a longer string, and a computed key all pass the save', () => {
    const source = [
      ASKS,
      "// await ctx.text('not_declared')",
      "const note = \"ctx.text('not_declared') is how\";",
      'const k = pick(); await ctx.text(k);',
    ].join('\n');
    expect(HookSchema.safeParse({ ...base, body: body(source), texts }).success).toBe(true);
    expect(hookTextKeysAskedIn(source)).toEqual(['follow_up_subject']);
  });

  it('a hook that declares no texts is not read for ctx.text calls (the run-time fault names it)', () => {
    expect(HookSchema.safeParse({ ...base, body: body("await ctx.text('anything');") }).success).toBe(true);
    expect(undeclaredHookTextAtRun('lead_follow_up', 'anything', [])).toMatch(/hook 'lead_follow_up' asked for text 'anything'.*declared: none/);
  });
});

describe('hooks.<hook>.texts.<key>.message — the translation face', () => {
  it('spells the key the runtime reads', () => {
    expect(hookTextMessageKey('lead_follow_up', 'follow_up_subject')).toBe('hooks.lead_follow_up.texts.follow_up_subject.message');
  });

  it('accepts a translated text under the hook, and refuses an undeclared key in the entry', () => {
    expect(TranslationDataSchema.safeParse({
      hooks: { lead_follow_up: { texts: { follow_up_subject: { message: '跟进已认定线索：{{ lead }}' } } } },
    }).success).toBe(true);
    expect(TranslationDataSchema.safeParse({
      hooks: { lead_follow_up: { texts: { follow_up_subject: { message: 'x', status: 400 } } } },
    }).success).toBe(false);
  });
});
