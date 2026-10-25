// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
// `formatMetadataError` / `extractIssues` and their cases moved to
// `@object-ui/data-objectstack` (`metadata-error.test.ts`) with the reader
// itself (objectui#11302); this file keeps the publish formatter's cases.
import { formatPublishFailures } from './metadataError';

describe('formatPublishFailures', () => {
  it('heads each failed draft and indents its field-anchored issues', () => {
    const out = formatPublishFailures([
      {
        type: 'object',
        name: 'invoice',
        error: 'failed spec validation',
        issues: [{ path: 'fields.total.type', message: 'Required' }],
      },
      { type: 'flow', name: 'notify', error: 'start node missing' },
    ]);
    expect(out).toBe(
      'object/invoice: failed spec validation\n  • fields.total.type — Required\n' +
        'flow/notify: start node missing',
    );
  });

  // framework 15.1+ (ADR-0067 D2) — the batch is all-or-nothing; `failed[]`
  // carries the causal item + BATCH_ABORTED markers for the rolled-back rest.
  it('15.1+ all-or-nothing: one rolled-back banner anchored on the causal item', () => {
    const out = formatPublishFailures([
      { type: 'object', name: 'crm_lead', error: 'not published — the batch is all-or-nothing…', code: 'BATCH_ABORTED' },
      {
        type: 'object', name: 'crm_deal', error: 'failed spec validation', code: 'INVALID_METADATA',
        issues: [{ path: 'fields.amount.type', message: 'Required' }],
      },
      { type: 'view', name: 'lead_list', error: 'not published — …', code: 'BATCH_ABORTED' },
    ]);
    expect(out).toContain('Nothing was published — the batch rolled back');
    // causal item with its real error and field-anchored issues…
    expect(out).toContain('object/crm_deal: failed spec validation');
    expect(out).toContain('fields.amount.type — Required');
    // …aborted entries summarized, not listed as parallel errors
    expect(out).not.toContain('crm_lead: not published');
    expect(out).toContain('2 other drafts aborted with it');
  });

  it('all entries aborted (defensive): banner still renders with one sample', () => {
    const out = formatPublishFailures([
      { type: 'object', name: 'a', error: 'not published — …', code: 'BATCH_ABORTED' },
      { type: 'object', name: 'b', error: 'not published — …', code: 'BATCH_ABORTED' },
    ]);
    expect(out).toContain('Nothing was published');
    expect(out).toContain('object/a');
  });
});

// objectui#11985 — the fixtures above once spelled the sibling code
// `batch_aborted`, a spelling `publishPackageDrafts` never emits, so the banner
// branch was green in tests and dead in Studio. These two cases use the
// producer's rollback answer verbatim: a causal item, then each sibling with
// the producer's own sentence and `code: 'BATCH_ABORTED'`.
describe('formatPublishFailures on the producer rollback answer (objectui#11985)', () => {
  const sibling = (type: string, name: string) => ({
    type,
    name,
    error:
      'not published — the batch is all-or-nothing (ADR-0067 D2) and object/lead failed; the transaction rolled back',
    code: 'BATCH_ABORTED',
  });

  it('a rolled-back batch leads with the banner, names the cause and counts the aborted drafts', () => {
    const out = formatPublishFailures([
      { type: 'object', name: 'lead', error: 'failed spec validation', code: 'INVALID_METADATA' },
      sibling('view', 'lead_list'),
      sibling('page', 'lead_home'),
    ]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Nothing was published');
    expect(lines[1]).toBe('object/lead: failed spec validation');
    expect(lines[2]).toContain('2 other drafts aborted');
    // The siblings are counted, not listed as parallel errors.
    expect(out).not.toContain('view/lead_list');
    expect(out).not.toContain('page/lead_home');
  });

  it('control: a causal failure with no aborted sibling keeps its own error and no banner', () => {
    const out = formatPublishFailures([
      { type: 'object', name: 'lead', error: 'failed spec validation', code: 'INVALID_METADATA' },
    ]);
    expect(out).not.toContain('Nothing was published');
    expect(out).toBe('object/lead: failed spec validation');
  });
});
