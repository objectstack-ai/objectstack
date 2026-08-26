// #11519 — the doubled post-success-navigation channel (maintainer ruling
// 2026-08-24, recorded on the card: refuse the doubled channel; ⛔ no
// `precedence` contract field).
//
// Two independent channels can name a post-success destination for ONE
// `type: 'script'` action: the DECLARED `onSuccess` block, and the
// HANDLER-RETURNED `{ redirectUrl }`. The handler's return value is
// runtime-only in general (a `target` names an opaque registry entry;
// `HookBodySchema` declares no return contract) — but the action-level
// `opensInNewTab` flag IS a schema-visible declaration of the handler-redirect
// channel: its contract is "pre-open a tab, then drive it to the handler's
// returned `redirectUrl`". So the statically-knowable doubled case is
// `onSuccess` + `opensInNewTab: true` on one script action, and THAT pair is
// refused at authoring time. The runtime-only remainder (a handler that
// returns `redirectUrl` with no marker declared) is covered by the loud
// dispatch-seam diagnostic in `@objectstack/runtime` (`action-execution.ts`),
// not by this schema.
import { describe, it, expect } from 'vitest';
import { ActionSchema } from './action.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

const base = { name: 'open_sso_portal', label: 'Open SSO portal' };

describe('ActionSchema — doubled post-success navigation (#11519)', () => {
  describe('refusal pin — the statically-knowable doubled declaration', () => {
    const doubled = {
      ...base,
      type: 'script' as const,
      target: 'ssoOpen',
      opensInNewTab: true,
      onSuccess: { navigate: '/apps/account/sys_account' },
    };

    it('refuses onSuccess beside opensInNewTab on a type:script action', () => {
      const r = ActionSchema.safeParse(doubled);
      expect(r.success).toBe(false);
    });

    it('names BOTH channels and the remedy, and records the interim winner', () => {
      const r = ActionSchema.safeParse(doubled);
      expect(r.success).toBe(false);
      const msg = r.error!.issues.map((i) => i.message).join('\n');
      // Both channels, by name.
      expect(msg).toContain('onSuccess');
      expect(msg).toContain('opensInNewTab');
      expect(msg).toContain('redirectUrl');
      // The remedy: one destination, declared in one place.
      expect(msg).toMatch(/drop|remove|keep/i);
      // The interim renderer precedence this refusal supersedes at authoring
      // time is recorded so an author hitting the error understands what
      // happens to metadata published before it. Pinned as the SUBSTANCE —
      // which channel wins and which is dropped — rather than as the tracker id
      // that used to stand in for it: the id resolved to nothing for the author
      // this message is printed at, while the sentence tells them the outcome.
      expect(msg).toContain('interim precedence');
      expect(msg).toContain('silently ignored');
      expect(msg).not.toMatch(/(?<![#&])#[0-9]{3,5}(?![0-9A-Za-z])/);
    });

    it('is refused through the registered `action` metadata schema too (the parsing door)', () => {
      const schema = getMetadataTypeSchema('action');
      expect(schema).toBeDefined();
      const r = schema!.safeParse(doubled);
      expect(r.success).toBe(false);
    });
  });

  describe('single-channel pins — each channel alone stays accepted byte-identically', () => {
    it('only onSuccess on a script action: accepted, output unchanged', () => {
      const out = ActionSchema.parse({
        ...base,
        type: 'script',
        target: 'cloneVersion',
        onSuccess: { navigate: '/apps/mfg/task_version/${result.id}' },
      }) as Record<string, unknown>;
      // The exact parse output this input produced BEFORE the refusal landed —
      // materialized defaults included. A byte drift here means the narrowing
      // touched an accepted case.
      expect(out).toEqual({
        name: 'open_sso_portal',
        label: 'Open SSO portal',
        type: 'script',
        target: 'cloneVersion',
        refreshAfter: false,
        onSuccess: { navigate: '/apps/mfg/task_version/${result.id}', openIn: 'self' },
      });
    });

    it('only opensInNewTab (handler-redirect channel) on a script action: accepted, output unchanged', () => {
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

    it('opensInNewTab + newTabUrl (zero-roundtrip variant) without onSuccess: accepted', () => {
      const r = ActionSchema.safeParse({
        ...base,
        type: 'script',
        target: 'ssoOpen',
        opensInNewTab: true,
        newTabUrl: '/sso-open?recordId={recordId}',
      });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });
  });

  describe('scope pins — exactly the ruled pair, nothing wider', () => {
    it('an explicit opensInNewTab: false beside onSuccess is NOT the marker — accepted', () => {
      // `false` declares the handler-redirect channel is NOT in use; only
      // `true` marks it. The pair with `false` carries one destination.
      const r = ActionSchema.safeParse({
        ...base,
        type: 'script',
        target: 'cloneVersion',
        opensInNewTab: false,
        onSuccess: { navigate: '/x' },
      });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it('the pair on a type:api action stays accepted — the ruling scopes the refusal to type:script', () => {
      // #11519's ruled sentence is about a `type: 'script'` action whose
      // HANDLER can return `redirectUrl`; an api action has no script handler.
      // Recorded as a deliberate scope boundary, not an oversight — widening
      // it is a new decision, not a drive-by.
      const r = ActionSchema.safeParse({
        ...base,
        type: 'api',
        target: '/api/v1/actions/x/y',
        opensInNewTab: true,
        onSuccess: { navigate: '/x' },
      });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });
  });
});
