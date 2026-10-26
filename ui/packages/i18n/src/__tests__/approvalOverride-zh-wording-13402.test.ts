/**
 * objectui#13402 — the zh admin-override copy does not call the override 越权.
 *
 * 越权 means "exceeding one's authority": it is the word for a violation. The
 * feature is the opposite — an administrator override that is explicitly
 * granted and written to the audit trail — so a finance approver who read
 * 越权通过 in a colleague's history read it as a breach. The zh pack names it
 * 管理员代为〈action〉 on the lever, 管理员代办 on the history chip, and
 * 以管理员身份代为处理 / 记录为管理员代办 in the notices.
 *
 * The no-越权 pin enumerates every string in `approvalsInbox`, so an override
 * string added to that family later is held too; it asserts the enumeration is
 * non-empty first, so a family that stopped resolving cannot pass with nothing
 * checked.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

const OVERRIDE_KEYS = [
  'overrideActionLabel',
  'overrideNotice',
  'overrideNoticeWho',
  'overrideReassignNotice',
  'overrideReassignNoticeWho',
  'overrideRecallNotice',
  'overrideRecallNoticeWho',
  'viaOverrideChip',
  'viaOverrideHint',
] as const;

const VIOLATION_WORD = /越权/u;

type Pack = Record<string, unknown>;
const zh = (builtInLocales.zh as unknown as { approvalsInbox: Pack }).approvalsInbox;
const en = (builtInLocales.en as unknown as { approvalsInbox: Pack }).approvalsInbox;

const placeholders = (value: string) => [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/gu)].map((m) => m[1]).sort();

describe('zh admin-override copy names an authorized override, not a violation (objectui#13402)', () => {
  it('no zh approvalsInbox string carries 越权', () => {
    const entries = Object.entries(zh).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter(([, value]) => VIOLATION_WORD.test(value))).toEqual([]);
  });

  it('the override lever and the history chip read 管理员代为〈action〉 and 管理员代办', () => {
    expect(zh.overrideActionLabel).toBe('管理员代为{{action}}');
    expect(zh.viaOverrideChip).toBe('管理员代办');
    // `{{action}}` is the lever's declared, localized label.
    const label = zh.overrideActionLabel as string;
    expect(['通过', '拒绝', '转签', '撤回'].map((verb) => label.replace('{{action}}', verb)))
      .toEqual(['管理员代为通过', '管理员代为拒绝', '管理员代为转签', '管理员代为撤回']);
  });

  it.each(OVERRIDE_KEYS)('zh %s keeps the placeholders of its en source', (key) => {
    expect(typeof zh[key]).toBe('string');
    expect(placeholders(zh[key] as string)).toEqual(placeholders(en[key] as string));
  });

  it('the matcher catches the retired wording', () => {
    expect(VIOLATION_WORD.test('越权通过')).toBe(true);
    expect(VIOLATION_WORD.test('此决定将记录为管理员越权。')).toBe(true);
    expect(VIOLATION_WORD.test('管理员代为通过')).toBe(false);
  });
});
