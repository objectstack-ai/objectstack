/**
 * #5555 — "start expanded" is a CROSS-VARIANT key, and the error map now says so.
 *
 * `expanded` is declared on the `group` nav variant alone. The four near-miss
 * spellings (`defaultOpen` / `open` / `collapsed` / `isOpen`) used to be listed
 * in `NAV_ITEM_ALIASES`, the table stamped into all nine variants, so on the
 * other eight an author was told to write a key that variant ALSO rejects:
 *
 *   1. `{ type: 'url', url: '/x', defaultOpen: true }`
 *   2. → "Did you mean `defaultOpen` → `expanded`?"
 *   3. author writes `expanded: true`
 *   4. → rejected again, and this time with no suggestion at all
 *
 * That is ledger finding 7's second rejection, produced by the #4001 campaign
 * built to abolish it. The fix moves the four into the per-variant assembly, so
 * `group` keeps the bare key name and the other eight answer with prose, exactly
 * as the six cross-variant payload keys already did.
 *
 * These are message-text assertions because the message IS the deliverable —
 * no shape changed. The reachability half is asserted too: the destination the
 * prose names has to actually parse, since naming an unreachable one is the very
 * defect being fixed.
 */

import { describe, it, expect } from 'vitest';

import {
  ObjectNavItemSchema,
  DashboardNavItemSchema,
  PageNavItemSchema,
  UrlNavItemSchema,
  ReportNavItemSchema,
  ActionNavItemSchema,
  ComponentNavItemSchema,
  GroupNavItemSchema,
  AppSchema,
} from './app.zod';

/** The prose target, spelled once — `alias-integrity.test.ts` allowlists it verbatim. */
const PROSE = "type: 'group' (with expanded)";

/** The four spellings, as an AUTHOR writes them (camelCase; the probe folds case). */
const EXPANDED_SPELLINGS = ['defaultOpen', 'open', 'collapsed', 'isOpen'] as const;

type Branch = { safeParse: (v: unknown) => { success: boolean; error?: unknown } };

/** Every variant that does NOT own `expanded`, with the payload its `type` requires. */
const NON_GROUP: Array<[string, Branch, Record<string, unknown>]> = [
  ['object', ObjectNavItemSchema, { type: 'object', objectName: 'crm_lead' }],
  ['dashboard', DashboardNavItemSchema, { type: 'dashboard', dashboardName: 'sales' }],
  ['page', PageNavItemSchema, { type: 'page', pageName: 'home' }],
  ['url', UrlNavItemSchema, { type: 'url', url: 'https://example.com' }],
  ['report', ReportNavItemSchema, { type: 'report', reportName: 'pipeline' }],
  ['action', ActionNavItemSchema, { type: 'action', actionDef: { actionName: 'run_it' } }],
  ['component', ComponentNavItemSchema, { type: 'component', componentRef: 'metadata:resource' }],
];

const BASE = { id: 'nav_probe', label: 'Probe' };

const messagesOf = (r: { error?: unknown }): string =>
  JSON.stringify((r.error as { issues?: unknown })?.issues ?? []);

describe('#5555 — the `expanded` aliases answer "right key, wrong variant"', () => {
  describe('the eight variants that do not own `expanded`', () => {
    it.each(NON_GROUP)('`%s` answers all four spellings with prose, not a dead key name', (_name, schema, payload) => {
      for (const written of EXPANDED_SPELLINGS) {
        const r = schema.safeParse({ ...BASE, ...payload, [written]: true });
        expect(r.success).toBe(false);
        const issues = messagesOf(r);
        expect(issues).toContain(written);
        expect(issues).toContain(PROSE);
        // The regression itself: the bare-key redirect must be gone. Asserted as
        // the rendered arrow rather than the word `expanded`, which legitimately
        // still occurs inside the prose target.
        expect(issues).not.toContain(`→ \`expanded\``);
      }
    });

    it('`separator` too — reached through the real door, since its branch is module-private', () => {
      // `AppSchema.navigation` is a discriminatedUnion on `type`, so the
      // rejection lands on the branch actually written. Without this the ninth
      // variant would go unasserted here.
      const r = AppSchema.safeParse({
        name: 'probe_app',
        label: 'Probe',
        navigation: [{ ...BASE, type: 'separator', defaultOpen: true }],
      });
      expect(r.success).toBe(false);
      const issues = messagesOf(r);
      expect(issues).toContain(PROSE);
      expect(issues).not.toContain(`→ \`expanded\``);
    });

    it('THE DEFECT — the key the old redirect named really is rejected here (a second time, silently)', () => {
      // This is why the old target was a lie, and it is still true: `expanded`
      // is not a `url` key. Before the fix an author reached this state by
      // FOLLOWING the suggestion; the assertion pins the fact that made the
      // redirect dead, so a future reader can see the fix was not cosmetic.
      const r = UrlNavItemSchema.safeParse({ ...BASE, type: 'url', url: '/x', expanded: true });
      expect(r.success).toBe(false);
      const issues = messagesOf(r);
      expect(issues).toContain('expanded');
      // …and the second rejection carries no suggestion, which is the part that
      // left the author stuck.
      expect(issues).not.toContain('Did you mean');
    });
  });

  describe('the `group` variant, which does own `expanded`', () => {
    it('still redirects all four spellings to the bare key name', () => {
      for (const written of EXPANDED_SPELLINGS) {
        const r = GroupNavItemSchema.safeParse({ ...BASE, type: 'group', [written]: true });
        expect(r.success).toBe(false);
        const issues = messagesOf(r);
        expect(issues).toContain(`→ \`expanded\``);
        // The prose belongs to the other eight; pointing a `group` author at
        // `type: 'group'` would be a tautology.
        expect(issues).not.toContain(PROSE);
      }
    });

    it('REACHABILITY — following that redirect actually parses', () => {
      // The half the old aliases got wrong. A suggestion is only worth making if
      // the suggested authoring passes, so this is a full-parse-green assertion:
      // the claim under test is a verdict on a VALUE, not merely that `expanded`
      // is a recognized key name.
      const r = GroupNavItemSchema.safeParse({ ...BASE, type: 'group', expanded: true });
      expect(r.success, messagesOf(r)).toBe(true);
    });

    it('REACHABILITY — and so does following the prose from another variant', () => {
      // The prose says "type: 'group' (with expanded)". An author who obeys it
      // rewrites the whole item, so assert that rewrite end-to-end through
      // `AppSchema` rather than trusting the sentence.
      const r = AppSchema.safeParse({
        name: 'probe_app',
        label: 'Probe',
        navigation: [{ ...BASE, type: 'group', expanded: true, children: [] }],
      });
      expect(r.success, messagesOf(r)).toBe(true);
    });
  });
});
