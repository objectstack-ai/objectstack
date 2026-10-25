/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * RecordApprovalsPanel — the pending approver is a NAME, not a truncated raw id
 * (objectui#5414).
 *
 * Measured on this tree before the fix, HotCRM opportunity with a pending
 * `approval` node routed to `position:sales_manager`:
 *
 *     Waiting on
 *       positi…ager          <- the whole answer to "who is holding this record"
 *
 * The step names beside it were human prose. These render the same panel and
 * read the chip back, in `en` and in `zh`, for every state the seat can be in:
 * resolved with people, resolved and unstaffed, resolved but unprobeable, and
 * unresolvable with no adapter at all. The raw reference stays reachable on
 * hover throughout — that is where the card says an internal identifier belongs.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { AdapterCtx, MetadataCtx } from '@object-ui/react';
import type { ApprovalRequestLite } from '../hooks/useRecordApprovals';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { RecordApprovalsPanel } from './RecordApprovalsPanel';
import { resetApproverDirectoryCache } from '../hooks/useApproverDirectory';

/** The exact string the card reports — pinned so it cannot come back. */
const REPORTED = 'positi…ager';

const request = (over: Partial<ApprovalRequestLite> = {}): ApprovalRequestLite => ({
  id: 'req_1',
  process_name: 'flow:large_deal_approval',
  process_label: 'Large Deal Approval (on create)',
  object_name: 'crm_opportunity',
  record_id: 'opp_1',
  status: 'pending',
  current_step: 'sales_manager_review',
  step_label: 'Sales Manager Review',
  submitter_id: 'u_sub',
  pending_approvers: ['position:sales_manager'],
  viewer: { can_act: false, is_submitter: false, can_override: true },
  ...over,
});

/**
 * A directory the panel can read. The metadata registry answers the label leg
 * (`ensureType('position')` on the console's metadata store: `@objectstack/spec`
 * 18 binds `position` to the registry, objectstack#22710 — it was a
 * `sys_position` read through 17.x, objectui#12030), and `sys_user_position`
 * -> `sys_user` the staffing leg; `failStaffing` makes the second leg reject
 * the way a denied object API does (`OBJECT_API_DISABLED`), which must read as
 * UNKNOWN staffing rather than as an empty seat.
 */
function directory(opts: {
  label?: string;
  holders?: Array<{ id: string; name: string }>;
  failStaffing?: boolean;
}) {
  const metadataStore = {
    ensureType: vi.fn(async (type: string) =>
      type === 'position' && opts.label !== undefined ? [{ name: 'sales_manager', label: opts.label }] : [],
    ),
  };
  return {
    metadataStore,
    find: vi.fn(async (object: string) => {
      if (object === 'sys_user_position') {
        if (opts.failStaffing) {
          throw Object.assign(new Error('denied'), { code: 'OBJECT_API_DISABLED' });
        }
        return {
          data: (opts.holders ?? []).map((h, i) => ({
            id: `up_${i}`, position: 'sales_manager', user_id: h.id,
          })),
        };
      }
      if (object === 'sys_user') {
        return { data: (opts.holders ?? []).map((h) => ({ id: h.id, name: h.name })) };
      }
      return { data: [] };
    }),
  };
}

function renderPanel(req: ApprovalRequestLite, adapter: unknown, language = 'en') {
  const store = (adapter as { metadataStore?: unknown } | null)?.metadataStore ?? null;
  render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <MetadataCtx.Provider value={store as never}>
        <AdapterCtx.Provider value={adapter as never}>
          <RecordApprovalsPanel
            approvals={{ available: true, requests: [req], pendingRequest: req }}
            currentUserId="u_sub"
          />
        </AdapterCtx.Provider>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
}

const chip = () => document.querySelector('[data-testid="approver-chip"]');
const chipText = () => chip()?.textContent ?? '';

beforeEach(() => {
  resetApproverDirectoryCache();
  // The panel's own action-thread fetch — inert here; the approver identity is
  // what is under test.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }) as never));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RecordApprovalsPanel — pending approver identity (objectui#5414)', () => {
  it('names the position and its people, and keeps the raw reference on hover', async () => {
    renderPanel(
      request(),
      directory({
        label: 'Sales Manager',
        holders: [{ id: 'u1', name: 'Zhang Wei' }, { id: 'u2', name: 'Li Na' }],
      }),
    );
    await waitFor(() => expect(chipText()).toContain('Zhang Wei'));
    expect(chipText()).toBe('Sales Manager· Zhang Wei, Li Na');
    expect(chipText()).not.toContain(REPORTED);
    expect(chipText()).not.toContain('position:sales_manager');
    // Where the internal identifier DOES belong.
    expect(chip()?.getAttribute('title')).toBe('position:sales_manager');
  });

  it('renders the same seat in zh — the strings the card asks for', async () => {
    renderPanel(
      request(),
      directory({
        label: '销售经理',
        holders: [{ id: 'u1', name: '张伟' }, { id: 'u2', name: '李娜' }],
      }),
      'zh',
    );
    await waitFor(() => expect(chipText()).toContain('张伟'));
    expect(chipText()).toBe('销售经理· 张伟、李娜');
  });

  it('surfaces the unstaffed seat rather than an unexplained label', async () => {
    renderPanel(request(), directory({ label: 'Sales Manager', holders: [] }));
    await waitFor(() => expect(chip()?.getAttribute('data-unstaffed')).toBe('true'));
    expect(chipText()).toBe('Sales Manager (no current holder)');
  });

  it('says the unstaffed seat in zh too', async () => {
    renderPanel(request(), directory({ label: '销售经理', holders: [] }), 'zh');
    await waitFor(() => expect(chip()?.getAttribute('data-unstaffed')).toBe('true'));
    expect(chipText()).toBe('销售经理（暂无在岗人员）');
  });

  it('does NOT claim an empty seat when the staffing read was refused', async () => {
    // A business-app reader may read the position registry and not list `sys_user_position`.
    // "I could not look" is a different claim from "nobody holds it", and only
    // one of them is safe to print on a governance surface.
    renderPanel(request(), directory({ label: 'Sales Manager', failStaffing: true }));
    await waitFor(() => expect(chipText()).toBe('Sales Manager'));
    expect(chip()?.getAttribute('data-unstaffed')).toBeNull();
  });

  it('still reads as prose with no adapter at all — the truncation is gone either way', async () => {
    renderPanel(request(), null);
    await waitFor(() => expect(chip()).toBeTruthy());
    expect(chipText()).toBe('Sales Manager');
    expect(chipText()).not.toContain(REPORTED);
  });

  it('leaves a server-resolved name alone, and asks the directory nothing', async () => {
    // Server-first: `pending_approver_names` is the producer's own resolution,
    // and a backend that sends it must cost the record page no extra request.
    const adapter = directory({ label: 'Sales Manager' });
    renderPanel(
      request({ pending_approver_names: { 'position:sales_manager': 'Sales Manager Desk' } }),
      adapter,
    );
    await waitFor(() => expect(chipText()).toBe('Sales Manager Desk'));
    expect(adapter.find).not.toHaveBeenCalled();
    expect(adapter.metadataStore.ensureType).not.toHaveBeenCalled();
  });

  it('leaves a plain user slate exactly as it rendered before', async () => {
    // The regression direction: #5414 must not restyle the ordinary case that
    // objectui#3461 already got right.
    renderPanel(
      request({
        pending_approvers: ['u_qa_head', 'u_prod_head'],
        pending_approver_names: { u_qa_head: 'Qian Hua', u_prod_head: 'Li Lei' },
      }),
      null,
    );
    await waitFor(() => expect(chip()).toBeTruthy());
    const labels = Array.from(document.querySelectorAll('[data-testid="approver-chip"]'))
      .map((n) => n.textContent);
    expect(labels).toEqual(['Qian Hua', 'Li Lei']);
  });
});
