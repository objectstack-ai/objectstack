// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The draft review list: the `data-draft-review` part an ask turn that saved
 * drafts ends with. The five new objects are closed and the findings in
 * `refusals` / `advisories` keep the door's own `RuntimeAuthoringIssueSchema`
 * shape; the verdict nullable but present, the list capped, and both review
 * routes Console paths that stay on the site.
 *
 * The refusal legs assert the issue zod answers and its path, not a bare
 * failure: a shape that degraded to a loose object would still fail on `null`.
 */

import { describe, expect, it } from 'vitest';
import {
  DRAFT_REVIEW_MAX,
  DRAFT_REVIEW_PART_TYPE,
  DraftReviewItemSchema,
  DraftReviewListSchema,
} from './index';

const ISSUE = {
  rule: 'flow-multi-write-unfiltered',
  path: 'flows[0].nodes[1].config.multi',
  where: 'flow "leave_approval" · node "approve"',
  message: 'A multi-record write names no filter.',
  hint: 'Add a filter.',
  severity: 'error' as const,
};

const ROW = {
  type: 'object',
  name: 'acme_invoice',
  package: 'acme',
  verdict: { publishable: true, refusals: [], advisories: [] },
  verdictRead: 'turn-end' as const,
  review: {
    changes: '/studio/acme/data?changes=review',
    item: '/studio/acme/metadata/object/acme_invoice?review=1',
  },
};

/** The first issue's code and path, or `undefined` when the parse succeeds. */
function firstIssue(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; keys?: string[] }> } } }, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) return undefined;
  const [issue] = result.error!.issues;
  return { code: issue.code, path: issue.path, keys: issue.keys };
}

describe('DraftReviewItemSchema', () => {
  it('admits a row with a verdict, and keeps the label and the refusals', () => {
    const row = { ...ROW, label: 'Invoice', verdict: { publishable: false, refusals: [ISSUE], advisories: [] }, verdictRead: 'save' };
    const parsed = DraftReviewItemSchema.safeParse(row);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(row);
  });

  it('admits a null verdict with the door\'s withheld or error refusal beside it', () => {
    const refusal = { code: 'PERMISSION_DENIED', message: 'Not readable.', status: 403 };
    expect(DraftReviewItemSchema.safeParse({ ...ROW, verdict: null, verdictWithheld: refusal }).success).toBe(true);
    expect(DraftReviewItemSchema.safeParse({ ...ROW, verdict: null, verdictError: { ...refusal, code: 'INTERNAL_ERROR', status: 500 } }).success).toBe(true);
  });

  it('refuses a missing verdict: null is stated, never left out', () => {
    const { verdict: _verdict, ...noVerdict } = ROW;
    expect(firstIssue(DraftReviewItemSchema, noVerdict)).toMatchObject({ path: ['verdict'] });
  });

  it('refuses an unknown key on the row, the verdict and the links, never drops it', () => {
    expect(firstIssue(DraftReviewItemSchema, { ...ROW, publishable: true })).toMatchObject({ code: 'unrecognized_keys', keys: ['publishable'] });
    expect(firstIssue(DraftReviewItemSchema, { ...ROW, verdict: { ...ROW.verdict, note: 'x' } })).toMatchObject({ code: 'unrecognized_keys', path: ['verdict'] });
    expect(firstIssue(DraftReviewItemSchema, { ...ROW, review: { ...ROW.review, note: 'x' } })).toMatchObject({ code: 'unrecognized_keys', path: ['review'] });
  });

  it('refuses a review link that is not a Console path, or that a browser reads as another host', () => {
    const offSite = [
      'https://evil.example/studio',
      '//evil.example/studio',
      'javascript:alert(1)',
      'studio/acme',
      '',
      '/\\evil.example/x', // a browser reads `\` as `/`: `//evil.example/x`
      '/\t/evil.example/x', // a real tab, which the URL parser strips: `//evil.example/x`
      '/\n/evil.example/x',
      '/studio/acme data',
      '/studio/acme\u0000',
    ];
    for (const href of offSite) {
      expect(firstIssue(DraftReviewItemSchema, { ...ROW, review: { ...ROW.review, item: href } })).toMatchObject({ path: ['review', 'item'] });
      expect(firstIssue(DraftReviewItemSchema, { ...ROW, review: { ...ROW.review, changes: href } })).toMatchObject({ path: ['review', 'changes'] });
    }
  });

  it('admits a link the builders make, segments percent-encoded', () => {
    // The spelling of `studioItemReviewLink` / `studioChangesReviewLink` (`@objectstack/types`).
    const pkg = 'acme crm';
    const name = 'inv\\oice\tlist/v2';
    const review = {
      changes: `/studio/${encodeURIComponent(pkg)}/data?changes=review`,
      item: `/studio/${encodeURIComponent(pkg)}/metadata/${encodeURIComponent('view')}/${encodeURIComponent(name)}?review=1`,
    };
    expect(DraftReviewItemSchema.safeParse({ ...ROW, package: pkg, type: 'view', name, review }).success).toBe(true);
  });

  it('keeps the door\'s finding shape: an unknown key on a finding is dropped, not refused', () => {
    const parsed = DraftReviewItemSchema.safeParse({
      ...ROW,
      verdict: { publishable: false, refusals: [{ ...ISSUE, docs: 'https://docs.example/rule' }], advisories: [] },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.verdict!.refusals[0]).toEqual(ISSUE);
  });

  it('refuses an unknown verdictRead, and an empty type, name or package', () => {
    expect(firstIssue(DraftReviewItemSchema, { ...ROW, verdictRead: 'publish' })).toMatchObject({ path: ['verdictRead'] });
    for (const key of ['type', 'name', 'package'] as const) {
      expect(firstIssue(DraftReviewItemSchema, { ...ROW, [key]: '' })).toMatchObject({ code: 'too_small', path: [key] });
    }
  });
});

describe('DraftReviewListSchema and the data part', () => {
  it('names the part data-draft-review', () => {
    expect(DRAFT_REVIEW_PART_TYPE).toBe('data-draft-review');
  });

  it('admits a list with omitted, and refuses an empty list', () => {
    expect(DraftReviewListSchema.safeParse({ drafts: [ROW], omitted: 3 }).success).toBe(true);
    expect(firstIssue(DraftReviewListSchema, { drafts: [] })).toMatchObject({ code: 'too_small', path: ['drafts'] });
  });

  it('caps the list at DRAFT_REVIEW_MAX', () => {
    expect(DRAFT_REVIEW_MAX).toBe(50);
    const rows = Array.from({ length: DRAFT_REVIEW_MAX + 1 }, (_, i) => ({ ...ROW, name: `acme_item_${i}` }));
    expect(DraftReviewListSchema.safeParse({ drafts: rows.slice(0, DRAFT_REVIEW_MAX) }).success).toBe(true);
    expect(firstIssue(DraftReviewListSchema, { drafts: rows })).toMatchObject({ code: 'too_big', path: ['drafts'] });
  });

  it('refuses omitted 0, a fraction, and an unknown key', () => {
    expect(firstIssue(DraftReviewListSchema, { drafts: [ROW], omitted: 0 })).toMatchObject({ code: 'too_small', path: ['omitted'] });
    expect(firstIssue(DraftReviewListSchema, { drafts: [ROW], omitted: 1.5 })).toMatchObject({ path: ['omitted'] });
    expect(firstIssue(DraftReviewListSchema, { drafts: [ROW], total: 1 })).toMatchObject({ code: 'unrecognized_keys', keys: ['total'] });
  });
});
