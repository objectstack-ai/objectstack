// #11842 — the `newTabUrl` / `opensInNewTab` co-constraint, enforced.
//
// `newTabUrl`'s doc has always said "Only valid together with `opensInNewTab`",
// and every renderer read point agrees (objectui's pre-opened-tab wrapper reads
// the key only behind `action.opensInNewTab && newTabUrl`; nothing else reads
// it). Before the refine, an action declaring `newTabUrl` WITHOUT
// `opensInNewTab: true` parsed clean and the key was silently inert — the
// ADR-0078 declared-but-unenforced shape, arriving through a documented
// co-constraint rather than a missing key. The refine turns the lone key into
// an authoring-time refusal whose message names the pre-opened-tab contract
// and both remedies.
//
// Scope notes pinned below, because they are deliberate and OPPOSITE to the
// #11519 rule beside this one: there, `opensInNewTab: false` is NOT the marker
// (a declared-off channel means the pair carries one destination and stays
// accepted); here, `opensInNewTab: false` beside `newTabUrl` IS refused — the
// key has no meaning outside the pre-opened-tab flow, so a declared-off
// channel leaves it exactly as dead as an undeclared one. And the rule is
// type-independent: no action type reads a lone `newTabUrl`.
import { describe, it, expect } from 'vitest';
import { ActionSchema } from './action.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

const base = { name: 'open_sso_portal', label: 'Open SSO portal' };

describe('ActionSchema — newTabUrl requires opensInNewTab: true (#11842)', () => {
  describe('refusal pins — the lone key, on every shape that can carry it', () => {
    const lone = {
      ...base,
      type: 'script' as const,
      target: 'ssoOpen',
      newTabUrl: '/sso-open?recordId={recordId}',
    };

    it('refuses newTabUrl without opensInNewTab', () => {
      const r = ActionSchema.safeParse(lone);
      expect(r.success).toBe(false);
    });

    it('locates the issue on the newTabUrl path and names the contract and both remedies', () => {
      const r = ActionSchema.safeParse(lone);
      expect(r.success).toBe(false);
      const issues = r.error!.issues;
      // The refusal is located on the offending key, not on the object root.
      expect(issues.some((i) => i.path.join('.') === 'newTabUrl')).toBe(true);
      const msg = issues.map((i) => i.message).join('\n');
      // Both fields of the pair, by name, and the flag's required value.
      expect(msg).toContain('newTabUrl');
      expect(msg).toContain('opensInNewTab: true');
      // The pre-opened-tab contract the doc text carries (:1304 describe).
      expect(msg).toMatch(/pre-open/i);
      // Both remedies: add the flag, or drop the inert key.
      expect(msg).toMatch(/add\s+`opensInNewTab: true`/);
      expect(msg).toMatch(/drop\s+`newTabUrl`/);
      // The silently-inert class this file rejects at author time.
      expect(msg).toContain('ADR-0078');
    });

    it('refuses newTabUrl beside an explicit opensInNewTab: false — a declared-off channel leaves the key just as dead', () => {
      const r = ActionSchema.safeParse({
        ...base,
        type: 'script',
        target: 'ssoOpen',
        opensInNewTab: false,
        newTabUrl: '/sso-open?recordId={recordId}',
      });
      expect(r.success).toBe(false);
      expect(r.error!.issues.some((i) => i.path.join('.') === 'newTabUrl')).toBe(true);
    });

    it('is type-independent: a lone newTabUrl on type:url and type:api is refused too', () => {
      for (const shape of [
        { ...base, type: 'url' as const, target: 'https://example.com', newTabUrl: '/x/{recordId}' },
        { ...base, type: 'api' as const, target: '/api/v1/actions/x/y', newTabUrl: '/x/{recordId}' },
      ]) {
        const r = ActionSchema.safeParse(shape);
        expect(r.success, JSON.stringify(shape)).toBe(false);
        expect(r.error!.issues.some((i) => i.path.join('.') === 'newTabUrl')).toBe(true);
      }
    });

    it('is refused through the registered `action` metadata schema too (the parsing door)', () => {
      const schema = getMetadataTypeSchema('action');
      expect(schema).toBeDefined();
      const r = schema!.safeParse(lone);
      expect(r.success).toBe(false);
    });
  });

  describe('legal-pair pins — the documented pairing stays accepted byte-identically', () => {
    it('opensInNewTab: true + newTabUrl on a script action: accepted, output unchanged', () => {
      const out = ActionSchema.parse({
        ...base,
        type: 'script',
        target: 'ssoOpen',
        opensInNewTab: true,
        newTabUrl: '/sso-open?recordId={recordId}',
      }) as Record<string, unknown>;
      // The exact parse output this input produced BEFORE the refine landed —
      // materialized defaults included. A byte drift here means the narrowing
      // touched the accepted case.
      expect(out).toEqual({
        name: 'open_sso_portal',
        label: 'Open SSO portal',
        type: 'script',
        target: 'ssoOpen',
        refreshAfter: false,
        opensInNewTab: true,
        newTabUrl: '/sso-open?recordId={recordId}',
      });
    });

    it('opensInNewTab alone (handler-redirect channel, no direct URL): accepted, output unchanged', () => {
      const out = ActionSchema.parse({
        ...base,
        type: 'script',
        target: 'ssoOpen',
        opensInNewTab: true,
      }) as Record<string, unknown>;
      expect(out).toEqual({
        name: 'open_sso_portal',
        label: 'Open SSO portal',
        type: 'script',
        target: 'ssoOpen',
        refreshAfter: false,
        opensInNewTab: true,
      });
    });

    it('opensInNewTab: false alone (channel declared off, no newTabUrl): accepted', () => {
      const r = ActionSchema.safeParse({
        ...base,
        type: 'script',
        target: 'cloneVersion',
        opensInNewTab: false,
      });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });
  });
});
