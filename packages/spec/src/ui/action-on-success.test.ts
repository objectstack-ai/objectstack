// #9566 / #9474 — `onSuccess` post-success navigation (maintainer ruling
// 2026-08-18, recorded on #9566): one CLOSED key covering both server-executing
// action types, `navigate` (route/URL template whose scope gains `${result.*}`,
// the server response) + `openIn: 'self' | 'newTab'` defaulting `'self'`.
// These pins hold the ruled shape: the accept set, the materialized default,
// the closed enum, the strict inner object, and the api/script type scope.
import { describe, it, expect } from 'vitest';
import { ActionSchema, InlineActionSchema } from './action.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

const base = { name: 'copy_as_new_version', label: 'Copy as new version' };

describe('ActionSchema.onSuccess (#9566/#9474)', () => {
  describe('accept pins', () => {
    it('accepts the full shape on a type:api action', () => {
      const r = ActionSchema.safeParse({
        ...base,
        type: 'api',
        target: '/api/v1/actions/task_version/clone',
        onSuccess: { navigate: '/apps/mfg/task_version/${result.id}', openIn: 'newTab' },
      });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
      expect((r.data as { onSuccess: unknown }).onSuccess)
        .toEqual({ navigate: '/apps/mfg/task_version/${result.id}', openIn: 'newTab' });
    });

    it('accepts the minimal shape on a type:script action', () => {
      const r = ActionSchema.safeParse({
        ...base,
        type: 'script',
        target: 'cloneVersion',
        onSuccess: { navigate: '/apps/mfg/task_version/${result.id}' },
      });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it('reaches the same shape through the registered `action` metadata schema (the parsing door)', () => {
      const schema = getMetadataTypeSchema('action');
      expect(schema).toBeDefined();
      const r = schema!.safeParse({
        ...base,
        type: 'api',
        target: '/api/v1/actions/task_version/clone',
        onSuccess: { navigate: '/apps/mfg/task_version/${result.id}' },
      });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });
  });

  describe('default pin — openIn materializes to self', () => {
    it('parse output carries openIn "self" when the author omits it', () => {
      // The ruled default is MATERIALIZED (`.default('self')`), so a consumer
      // reads the resolved member off the parse output and never needs its own
      // fallback — declared = enforced. This is the observable being pinned.
      const out = ActionSchema.parse({
        ...base,
        type: 'api',
        target: '/api/v1/actions/task_version/clone',
        onSuccess: { navigate: '/x/${result.id}' },
      }) as { onSuccess?: { navigate: string; openIn: string } };
      expect(out.onSuccess?.openIn).toBe('self');
    });

    it('an explicit openIn survives untouched', () => {
      const out = ActionSchema.parse({
        ...base,
        type: 'script',
        target: 'cloneVersion',
        onSuccess: { navigate: '/x', openIn: 'newTab' },
      }) as { onSuccess?: { openIn: string } };
      expect(out.onSuccess?.openIn).toBe('newTab');
    });
  });

  describe('refusal pins — the closed enum', () => {
    it('rejects an out-of-vocabulary openIn', () => {
      const r = ActionSchema.safeParse({
        ...base,
        type: 'api',
        target: '/t',
        onSuccess: { navigate: '/x', openIn: 'modal' },
      });
      expect(r.success).toBe(false);
    });

    it("names the camelCase member when the author writes the sibling key's kebab spelling", () => {
      // The top-level `openIn` (type:'url') spells its member 'new-tab'; the
      // handler-return convention and this key spell it 'newTab'. The enum's
      // error map catches exactly the crossover spelling (the
      // ActionLocationSchema issue.input precedent) — every other wrong value
      // keeps zod's own enum error.
      const r = ActionSchema.safeParse({
        ...base,
        type: 'api',
        target: '/t',
        onSuccess: { navigate: '/x', openIn: 'new-tab' },
      });
      expect(r.success).toBe(false);
      const msg = r.error!.issues.map((i) => i.message).join('\n');
      expect(msg).toContain("'newTab'");
      expect(msg).toContain('new-tab');
    });
  });

  describe('refusal pins — the strict inner object', () => {
    const innerIssue = (onSuccess: Record<string, unknown>) => {
      const r = ActionSchema.safeParse({ ...base, type: 'api', target: '/t', onSuccess });
      expect(r.success).toBe(false);
      return r.error!.issues.find((i) => i.code === 'unrecognized_keys');
    };

    it('rejects an undeclared key instead of silently dropping it', () => {
      const issue = innerIssue({ navigate: '/x', notAKey: 1 });
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('`notAKey`');
    });

    it("points the handler-return spelling `redirectUrl` at `navigate`", () => {
      expect(innerIssue({ redirectUrl: '/x' })!.message)
        .toContain('`redirectUrl` → `navigate`');
    });

    it('points the generic destination spellings at `navigate`', () => {
      for (const key of ['url', 'to', 'route', 'path', 'target']) {
        expect(innerIssue({ [key]: '/x' })!.message)
          .toContain(`\`${key}\` → \`navigate\``);
      }
    });

    it('tells an author reaching for `opensInNewTab` that the tab choice here is openIn', () => {
      expect(innerIssue({ navigate: '/x', opensInNewTab: true })!.message)
        .toContain("openIn: 'newTab'");
    });

    it('requires `navigate` — an empty onSuccess block is not a declaration', () => {
      const r = ActionSchema.safeParse({ ...base, type: 'api', target: '/t', onSuccess: {} });
      expect(r.success).toBe(false);
    });
  });

  describe('type scope — api and script only (the #4352 enforcement shape)', () => {
    it.each(['url', 'modal', 'flow', 'form'] as const)('refuses onSuccess on a type:%s action', (type) => {
      const r = ActionSchema.safeParse({
        ...base,
        type,
        target: type === 'form' ? 'edit_form' : '/t',
        onSuccess: { navigate: '/x' },
      });
      expect(r.success).toBe(false);
      const msg = r.error!.issues.map((i) => i.message).join('\n');
      expect(msg).toContain('onSuccess');
      expect(msg).toContain("'api'");
      expect(msg).toContain("'script'");
    });
  });

  describe('the pre-existing probes now land on prescriptions, not bare rejections (#9474)', () => {
    it('a top-level `redirect` names the onSuccess shape', () => {
      const r = ActionSchema.safeParse({ ...base, type: 'api', target: '/t', redirect: '/x' });
      expect(r.success).toBe(false);
      const issue = r.error!.issues.find((i) => i.code === 'unrecognized_keys');
      expect(issue!.message).toContain('onSuccess');
      expect(issue!.message).toContain('navigate');
    });

    it('a top-level `redirectUrl` says it is the handler-return convention, not an authorable key', () => {
      const r = ActionSchema.safeParse({ ...base, type: 'api', target: '/t', redirectUrl: '/x' });
      expect(r.success).toBe(false);
      const issue = r.error!.issues.find((i) => i.code === 'unrecognized_keys');
      expect(issue!.message).toContain('HANDLER-RETURN');
      expect(issue!.message).toContain('onSuccess');
    });
  });

  describe('strictness posture unchanged elsewhere', () => {
    it('InlineActionSchema does not pick onSuccess — unknown key inline', () => {
      // The inline surface widens when a renderer widens (the file's own rule);
      // element:button's forward list has no onSuccess hop, so the key is
      // registered-actions-only until the objectui half lands.
      const r = InlineActionSchema.safeParse({
        type: 'api',
        target: '/t',
        onSuccess: { navigate: '/x' },
      });
      expect(r.success).toBe(false);
    });

    it('an action WITHOUT onSuccess still parses exactly as before', () => {
      const out = ActionSchema.parse({ ...base, type: 'api', target: '/t' }) as Record<string, unknown>;
      expect('onSuccess' in out && out.onSuccess !== undefined).toBe(false);
    });
  });
});
