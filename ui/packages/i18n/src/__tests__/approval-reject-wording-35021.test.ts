/**
 * objectstack#35021 — an approval rejection reads 驳回 in Chinese, on the
 * runtime surfaces as in the designer (ruling 6973602227, option A).
 *
 * The inbox, the record approval bar and the history timeline name the reject
 * decision with the word the flow designer gives the approval branch, in
 * zh-Hans and zh-Hant. 拒绝 keeps its own meanings: access denial, declining an
 * invitation, and the AI tool approvals (`aiApprovals`), a different concept.
 *
 * What is pinned is the vocabulary, not the sentences: no `approvalsInbox`
 * string in either Chinese pack says 拒绝, every key named for the reject
 * decision says 驳回, and the runtime's decision word and status agree with the
 * designer's branch and end-node labels. Each enumeration asserts it is
 * non-empty first, so a family that stopped resolving cannot pass with
 * nothing checked.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';
import STUDIO_ZH from '../namespaces/studio/zh.js';

type Pack = Record<string, unknown>;

const group = (locale: 'zh-Hans' | 'zh-Hant', name: string): Pack =>
  (builtInLocales[locale] as unknown as Record<string, Pack>)[name];

const strings = (pack: Pack): Array<[string, string]> =>
  Object.entries(pack).filter((entry): entry is [string, string] => typeof entry[1] === 'string');

const SCRIPTS = [
  { locale: 'zh-Hans', reject: '驳回', deny: '拒绝' },
  { locale: 'zh-Hant', reject: '駁回', deny: '拒絕' },
] as const;

describe('approval rejection reads 驳回 on the runtime surfaces (objectstack#35021)', () => {
  describe.each(SCRIPTS)('$locale', ({ locale, reject, deny }) => {
    const inbox = group(locale, 'approvalsInbox');

    it(`no approvalsInbox string says ${deny}`, () => {
      const entries = strings(inbox);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.filter(([, value]) => value.includes(deny))).toEqual([]);
    });

    it(`every approvalsInbox key named for the reject decision says ${reject}`, () => {
      const rejectKeys = strings(inbox).filter(([key]) => /reject/i.test(key));
      expect(rejectKeys.length).toBeGreaterThan(0);
      expect(rejectKeys.filter(([, value]) => !value.includes(reject))).toEqual([]);
    });

    it(`the decision verb reads ${reject} and the status reads 已${reject}`, () => {
      expect(inbox.actReject).toBe(reject);
      expect(inbox.reject).toBe(reject);
      expect(inbox.statusRejected).toBe(`已${reject}`);
      expect(inbox.rejectedToast).toBe(`已${reject}`);
    });

    it(`access denial, invitations and AI tool approvals keep ${deny}`, () => {
      const aiApprovals = group(locale, 'aiApprovals');
      expect(aiApprovals.reject).toBe(deny);
      expect(aiApprovals.statusRejected).toBe(`已${deny}`);
      const organization = group(locale, 'organization') as Record<string, Pack>;
      expect((organization.invitations.status as Pack).rejected).toBe(`已${deny}`);
      expect(organization.accept.decline).toBe(deny);
      expect(String(group(locale, 'errors').forbidden)).toContain(deny);
    });
  });

  it('the runtime decision word agrees with the designer branch and end node', () => {
    const inbox = group('zh-Hans', 'approvalsInbox');
    expect(inbox.actReject).toBe(STUDIO_ZH['engine.inspector.flowEdge.branchReject']);
    expect(inbox.statusRejected).toBe(STUDIO_ZH['engine.flowCanvas.rejectedEnd']);
  });
});
