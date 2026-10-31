/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack-ai/objectstack#27520 row 11 — a refused action keeps the
 * refusal's per-field entries, not only its text.
 *
 * The answer below is the one the action route gave on the showcase's draft
 * invoice → Submit for Sign-off (measured on a live stack): a 400
 * `VALIDATION_FAILED` whose `details.fields` names the field the
 * `requiredWhen` rule refused. The text alone reached the toast; the entries
 * were dropped, so the host could not say which field to fill in.
 */

import { describe, it, expect, vi } from 'vitest';
import { interpretActionResponse } from '../actionResponse';
import { createServerActionHandler, type ServerActionFetch } from '../serverActionHandler';
import type { ActionDef } from '../ActionRunner';

const SUBMIT_REFUSAL = {
  success: false,
  error: {
    code: 'VALIDATION_FAILED',
    message: 'Issued On is required',
    httpStatus: 400,
    details: { fields: [{ field: 'issued_on', code: 'required', message: 'Issued On is required', label: 'Issued On' }] },
  },
};

describe('a refused action keeps its per-field entries (objectstack#27520 row 11)', () => {
  it('reads the entries off the answer beside its text', () => {
    const out = interpretActionResponse({ ok: false, status: 400 }, SUBMIT_REFUSAL, 'Action "submit"');
    expect(out.ok).toBe(false);
    expect(out.error).toBe('Issued On is required');
    expect(out.fieldErrors).toEqual([
      { field: 'issued_on', code: 'required', message: 'Issued On is required', label: 'Issued On' },
    ]);
  });

  it('keeps the entries when the refusal also carries a producer-marked userMessage', () => {
    const out = interpretActionResponse({ ok: false, status: 400 }, {
      ...SUBMIT_REFUSAL,
      error: { ...SUBMIT_REFUSAL.error, userMessage: 'Add the issue date, then submit again.' },
    }, 'Action "submit"');
    expect(out.ok).toBe(false);
    expect(out.fieldErrors).toEqual(SUBMIT_REFUSAL.error.details.fields);
  });

  it('drops an entry with no field, and sets nothing when none is left', () => {
    const out = interpretActionResponse({ ok: false, status: 400 }, {
      success: false,
      error: { message: 'Refused', details: { fields: [{ code: 'required' }, { field: '' }] } },
    }, 'Action "x"');
    expect(out.error).toBe('Refused');
    expect(out).not.toHaveProperty('fieldErrors');
  });

  it('reads the legacy inner envelope’s own list', () => {
    const out = interpretActionResponse({ ok: true, status: 200 }, {
      success: true,
      data: { success: false, error: 'Issued On is required', fields: [{ field: 'issued_on', code: 'required' }] },
    }, 'Action "x"');
    expect(out.ok).toBe(false);
    expect(out.fieldErrors).toEqual([{ field: 'issued_on', code: 'required' }]);
  });

  it('hands the entries on through the dispatch’s failed result', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => SUBMIT_REFUSAL })) as unknown as ServerActionFetch;
    const handler = createServerActionHandler({ fetch });
    const res = await handler({ type: 'script', name: 'submit', objectName: 'invoice', recordId: 'inv_1' } as ActionDef);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Issued On is required');
    expect(res.fieldErrors).toEqual([
      { field: 'issued_on', code: 'required', message: 'Issued On is required', label: 'Issued On' },
    ]);
  });
});
