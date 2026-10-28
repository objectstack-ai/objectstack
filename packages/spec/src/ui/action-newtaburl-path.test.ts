// `newTabUrl` is a path on the SAME backend, never a URL.
//
// The console's zero-roundtrip fast path (`consoleServerAction.ts`) drives the
// pre-opened tab to the backend origin + `newTabUrl`, so an absolute value such
// as `https://example.com/export/{recordId}` opened a tab at
// `https://backend.example/https://example.com/…`. The JSDoc already called the
// key a "path template"; the describe and the form help said "URL template",
// and nothing refused the absolute value at authoring. The key now refuses any
// value that does not start with `/`, and the refusal names the external-page
// remedy: a `type: 'url'` action with `openIn: 'new-tab'`.
import { describe, it, expect } from 'vitest';
import { ActionSchema } from './action.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

const base = {
  name: 'export_invoice',
  label: 'Export invoice',
  type: 'script' as const,
  target: 'exportInvoice',
  opensInNewTab: true,
};

function refusalOf(newTabUrl: string) {
  const r = ActionSchema.safeParse({ ...base, newTabUrl });
  expect(r.success).toBe(false);
  const issues = r.error!.issues.filter((i) => i.path.join('.') === 'newTabUrl');
  expect(issues).toHaveLength(1);
  return issues[0]!;
}

describe('ActionSchema — newTabUrl must be a backend path starting with /', () => {
  describe('refusal pins', () => {
    it('refuses an https:// URL, located on newTabUrl, with the prescription', () => {
      const issue = refusalOf('https://example.com/export/{recordId}');
      expect(issue.code).toBe('invalid_format');
      // The prescription is the contract here: the path form, and the action
      // type that opens an external page.
      expect(issue.message).toMatch(/^`newTabUrl` is a path on this backend and must start with `\/`/);
      expect(issue.message).toContain("type: 'url'");
      expect(issue.message).toContain("openIn: 'new-tab'");
    });

    it('refuses an http:// absolute URL the same way', () => {
      const issue = refusalOf('http://intranet.example/print/{recordId}');
      expect(issue.code).toBe('invalid_format');
      expect(issue.message).toContain("type: 'url'");
    });

    it('refuses a bare relative path (no leading /), which has no base in the pre-opened tab', () => {
      expect(refusalOf('sso-open/{recordId}').code).toBe('invalid_format');
    });

    it('is refused through the registered `action` metadata schema too (the parsing door)', () => {
      const schema = getMetadataTypeSchema('action');
      expect(schema).toBeDefined();
      const r = schema!.safeParse({ ...base, newTabUrl: 'https://example.com/export/{recordId}' });
      expect(r.success).toBe(false);
      expect(r.error!.issues.some((i) => i.path.join('.') === 'newTabUrl')).toBe(true);
    });
  });

  describe('acceptance pins — a path template parses byte-identically', () => {
    it('/path/{recordId}: accepted, output unchanged', () => {
      const out = ActionSchema.parse({ ...base, newTabUrl: '/api/v1/invoice/{recordId}/pdf' });
      expect(out).toEqual({
        name: 'export_invoice',
        label: 'Export invoice',
        type: 'script',
        target: 'exportInvoice',
        refreshAfter: false,
        opensInNewTab: true,
        newTabUrl: '/api/v1/invoice/{recordId}/pdf',
      });
    });

    it('a path with a query string and the placeholder in it: accepted', () => {
      const r = ActionSchema.safeParse({ ...base, newTabUrl: '/sso-open?recordId={recordId}' });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it('the external-page remedy the refusal names parses: a type:url action with openIn new-tab', () => {
      const r = ActionSchema.safeParse({
        name: 'open_portal',
        label: 'Open portal',
        type: 'url',
        target: 'https://example.com/export/${ctx.recordId}',
        openIn: 'new-tab',
      });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });
  });
});
