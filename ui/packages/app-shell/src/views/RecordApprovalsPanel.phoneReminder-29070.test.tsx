// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29070 — the record approval panel's Send reminder at phone width.
 *
 * Measured in Chromium at 375 and 390 px on the showcase: the submitter's
 * Send reminder was a 24 px chip (`h-6`). Below 768 px (`useIsMobile`) it now
 * takes Button's `lg` size, the 44 px touch height; a desktop keeps the chip.
 * The geometry itself is pinned in `ui/e2e/approvals-inbox-phone.spec.ts`;
 * this file pins which arm each width picks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ApprovalRequestLite } from '../hooks/useRecordApprovals';

const { MOBILE } = vi.hoisted(() => ({ MOBILE: { value: false } }));

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIsMobile: () => MOBILE.value,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { RecordApprovalsPanel } from './RecordApprovalsPanel';

const PENDING: ApprovalRequestLite = {
  id: 'req_1',
  process_name: 'flow:invoice_dual_signoff',
  process_label: 'Invoice Dual Sign-off',
  object_name: 'showcase_invoice',
  record_id: 'inv_1',
  status: 'pending',
  submitter_id: 'u_me',
  submitter_name: 'Dev Admin',
  submitted_at: '2026-11-02T07:00:00Z',
  pending_approvers: ['u_fin', 'u_legal'],
  pending_approver_names: { u_fin: 'Fay Finance', u_legal: 'Lee Legal' },
  viewer: { can_act: false, is_submitter: true },
};

function renderPanel() {
  return render(
    <RecordApprovalsPanel
      approvals={{ available: true, requests: [PENDING], pendingRequest: PENDING }}
      currentUserId="u_me"
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  MOBILE.value = false;
});

describe('Send reminder at phone width (objectstack#29070)', () => {
  it('takes the 44 px lg size below 768 px', async () => {
    MOBILE.value = true;
    renderPanel();
    const btn = await screen.findByRole('button', { name: /Send reminder/ });
    const cls = btn.className.split(/\s+/);
    expect(cls).toContain('h-11');
    expect(cls).not.toContain('h-6');
  });

  it('keeps the compact chip on a desktop', async () => {
    renderPanel();
    const btn = await screen.findByRole('button', { name: /Send reminder/ });
    const cls = btn.className.split(/\s+/);
    expect(cls).toContain('h-6');
    expect(cls).not.toContain('h-11');
  });
});
