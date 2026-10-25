/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DetailView } from '../DetailView';
import { __clearRecordEditableCache } from '../useRecordEditable';
import type { DetailViewSchema, TextSchema } from '@object-ui/types';

/**
 * objectui#3339 — a stand-in for the record-level explain probe.
 *
 * Every schema in this file that carries `objectName` + `resourceId` makes
 * DetailView mount `useRecordEditable` twice (update + delete). With no
 * `SchemaRendererProvider` in the tree the hook has no host `apiFetch` and
 * falls back to the GLOBAL fetch — by design, for standalone embeds. Under
 * happy-dom that global fetch is a REAL request to the default origin, so the
 * suite fired 28 live `POST http://localhost:3000/api/v1/security/explain`
 * calls per run. They failed fire-and-forget: the hook swallows the rejection
 * in order to fail open, so the tests stayed green while stderr filled with
 * `connect ECONNREFUSED 127.0.0.1:3000`.
 *
 * Serving the probe from a double is the "inject the data dependency as a test
 * double" half of the issue's guidance. It is deliberately NOT a global error
 * sink: it records every URL it is handed, so an escape to some OTHER endpoint
 * becomes a recorded call that `probes the record-level explain endpoint …`
 * below fails on, instead of vanishing into a swallowed rejection.
 *
 * `visible: true` keeps the observable behaviour identical to what the failing
 * network produced — the hook fails open, so the Edit/Delete CTAs stayed
 * enabled either way. No assertion in this file changes meaning.
 */
function installExplainDouble() {
  const calls: { url: string; body: Record<string, unknown> | undefined }[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return { ok: true, json: async () => ({ record: { visible: true } }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('DetailView', () => {
  let explainCalls: ReturnType<typeof installExplainDouble>;

  beforeEach(() => {
    // The hook memoises verdicts in module scope; clear it so each test starts
    // from the same place regardless of order.
    __clearRecordEditableCache();
    explainCalls = installExplainDouble();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('should be exported', () => {
    expect(DetailView).toBeDefined();
  });

  it('should be a function', () => {
    expect(typeof DetailView).toBe('function');
  });

  it('should render with basic schema', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: {
        name: 'John Doe',
        email: 'john@example.com',
      },
      fields: [
        { name: 'name', label: 'Name' },
        { name: 'email', label: 'Email' },
      ],
    };

    const { container } = render(<DetailView schema={schema} />);
    expect(container).toBeTruthy();
  });

  it('should render title', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
    };

    render(<DetailView schema={schema} />);
    expect(screen.getByText('Contact Details')).toBeInTheDocument();
  });

  it('should render back button when showBack is true', () => {
    const onBack = vi.fn();
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      showBack: true,
    };

    render(<DetailView schema={schema} onBack={onBack} />);
    
    const buttons = screen.getAllByRole('button');
    const backButton = buttons.find(btn => 
      btn.querySelector('svg') !== null
    );
    
    expect(backButton).toBeTruthy();
  });

  it('should call onBack when back button is clicked', () => {
    const onBack = vi.fn();
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      showBack: true,
    };

    render(<DetailView schema={schema} onBack={onBack} />);
    
    const buttons = screen.getAllByRole('button');
    const backButton = buttons.find(btn => 
      btn.querySelector('svg') !== null
    );
    
    if (backButton) {
      fireEvent.click(backButton);
      expect(onBack).toHaveBeenCalled();
    }
  });

  it('should render edit button when showEdit is true', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      showEdit: true,
    };

    render(<DetailView schema={schema} />);
    
    // Edit button should be present
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('should call onEdit when edit button is clicked', () => {
    const onEdit = vi.fn();
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      showEdit: true,
      // Disable back button to ensure it's not the first button found if using generic search
      showBack: false 
    };

    render(<DetailView schema={schema} onEdit={onEdit} />);
    
    // Find button with text "Edit"
    const editButton = screen.getByRole('button', { name: /edit/i });
    
    if (editButton) {
      fireEvent.click(editButton);
      expect(onEdit).toHaveBeenCalled();
    }
  });

  it('should render delete button when showDelete is true', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      showDelete: true,
    };

    render(<DetailView schema={schema} />);
    
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('should render sections when provided', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '123-456-7890',
      },
      sections: [
        {
          title: 'Basic Information',
          fields: [
            { name: 'name', label: 'Name' },
            { name: 'email', label: 'Email' },
          ],
        },
        {
          title: 'Contact Information',
          fields: [
            { name: 'phone', label: 'Phone' },
          ],
        },
      ],
    };

    render(<DetailView schema={schema} />);
    
    expect(screen.getByText('Basic Information')).toBeInTheDocument();
    expect(screen.getByText('Contact Information')).toBeInTheDocument();
  });

  it('should render tabs when provided', () => {
    // Each tab's content is a `text` node, typed as one: `text` draws its
    // `content` key (`TextSchema`). These fixtures used to author `text`, which
    // no renderer reads (objectui#11355).
    const detailsContent: TextSchema = { type: 'text', content: 'Details content' };
    const activityContent: TextSchema = { type: 'text', content: 'Activity content' };
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Account Details',
      data: { name: 'Acme Corp' },
      tabs: [
        {
          key: 'details',
          label: 'Details',
          content: detailsContent,
        },
        {
          key: 'activity',
          label: 'Activity',
          content: activityContent,
        },
      ],
    };

    render(<DetailView schema={schema} />);
    
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Activity')).toBeInTheDocument();
  });

  it('no longer renders a related list — the entry is retired (objectui#7997)', () => {
    // WAS `should render related lists when provided`, and its inversion is the
    // point of objectui#7997: `DetailViewSchema.related` retired under ADR-0049
    // enforce-or-remove (maintainer ruling 2026-09-10). The capability moved to
    // its one protocol-governed entry, `record:related_list`.
    //
    // The cast is load-bearing, not laziness: the member is a `?: never`
    // tombstone, so this object cannot be authored without one — which is the
    // TypeScript half of the refusal. It is cast anyway so the RUNTIME half is
    // read too: a host that ignores `tsc`, or a plain JSON document, still gets
    // nothing rendered rather than a silently honoured second door.
    const schema = {
      type: 'detail-view',
      title: 'Account Details',
      data: { name: 'Acme Corp' },
      fields: [{ name: 'name', label: 'Name' }],
      related: [{ title: 'Contacts', type: 'table', data: [] }],
    } as unknown as DetailViewSchema;

    render(<DetailView schema={schema} />);

    expect(screen.queryByText('Contacts')).not.toBeInTheDocument();
    // The section heading went with it — this row absorbed the former
    // `should use i18n fallback for related section heading` test, whose whole
    // subject was that heading.
    expect(screen.queryByText('Related')).not.toBeInTheDocument();
    // CONTROL: the rest of the node still renders, so the two absences above
    // are readings and not a component that failed to mount.
    expect(screen.getByText('Account Details')).toBeInTheDocument();
  });

  it('should show loading skeleton when loading is true', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      loading: true,
    };

    const { container } = render(<DetailView schema={schema} />);
    
    // Check for skeleton elements (they typically have animate-pulse class)
    // DetailedView uses Skeleton component which has animate-pulse class
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should render prev/next navigation when recordNavigation is provided', () => {
    const onNavigate = vi.fn();
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      showBack: false,
      recordNavigation: {
        recordIds: ['id1', 'id2', 'id3'],
        currentIndex: 1,
        onNavigate,
      },
    };

    render(<DetailView schema={schema} />);
    
    // Should show position indicator
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  it('should call onNavigate with previous record id', () => {
    const onNavigate = vi.fn();
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      showBack: false,
      recordNavigation: {
        recordIds: ['id1', 'id2', 'id3'],
        currentIndex: 1,
        onNavigate,
      },
    };

    const { container } = render(<DetailView schema={schema} />);
    
    // Find the prev button (first in the navigation group)
    const navButtons = container.querySelectorAll('button');
    // The prev button is the one that contains a chevron-left icon and is not disabled
    const prevButton = Array.from(navButtons).find(btn =>
      btn.querySelector('.lucide-chevron-left')
    );
    expect(prevButton).toBeTruthy();
    fireEvent.click(prevButton!);
    expect(onNavigate).toHaveBeenCalledWith('id1');
  });

  it('should call onNavigate with next record id', () => {
    const onNavigate = vi.fn();
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      showBack: false,
      recordNavigation: {
        recordIds: ['id1', 'id2', 'id3'],
        currentIndex: 1,
        onNavigate,
      },
    };

    const { container } = render(<DetailView schema={schema} />);
    
    const nextButton = Array.from(container.querySelectorAll('button')).find(btn =>
      btn.querySelector('.lucide-chevron-right')
    );
    expect(nextButton).toBeTruthy();
    fireEvent.click(nextButton!);
    expect(onNavigate).toHaveBeenCalledWith('id3');
  });

  it('should disable prev button at first record', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      showBack: false,
      recordNavigation: {
        recordIds: ['id1', 'id2'],
        currentIndex: 0,
        onNavigate: vi.fn(),
      },
    };

    const { container } = render(<DetailView schema={schema} />);
    
    const prevButton = Array.from(container.querySelectorAll('button')).find(btn =>
      btn.querySelector('.lucide-chevron-left')
    );
    expect(prevButton).toBeTruthy();
    expect(prevButton!).toBeDisabled();
  });

  it('should disable next button at last record', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      showBack: false,
      recordNavigation: {
        recordIds: ['id1', 'id2'],
        currentIndex: 1,
        onNavigate: vi.fn(),
      },
    };

    const { container } = render(<DetailView schema={schema} />);
    
    const nextButton = Array.from(container.querySelectorAll('button')).find(btn =>
      btn.querySelector('.lucide-chevron-right')
    );
    expect(nextButton).toBeTruthy();
    expect(nextButton!).toBeDisabled();
  });

  it('should render comments section when comments are provided', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      comments: [
        {
          id: '1',
          text: 'Great contact!',
          author: 'Alice',
          createdAt: '2026-02-16T08:00:00Z',
        },
      ],
    };

    render(<DetailView schema={schema} />);
    
    expect(screen.getByText('Comments')).toBeInTheDocument();
    expect(screen.getByText('Great contact!')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('should render activity timeline when activities are provided', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      data: { name: 'John Doe' },
      fields: [{ name: 'name', label: 'Name' }],
      activities: [
        {
          id: '1',
          type: 'create',
          user: 'Bob',
          timestamp: '2026-02-15T10:00:00Z',
        },
        {
          id: '2',
          type: 'field_change',
          field: 'email',
          oldValue: 'old@test.com',
          newValue: 'new@test.com',
          user: 'Alice',
          timestamp: '2026-02-16T09:00:00Z',
        },
      ],
    };

    render(<DetailView schema={schema} />);
    
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('should render primaryField value as header title', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact',
      primaryField: 'name',
      data: { name: 'John Doe', email: 'john@example.com' },
      fields: [
        { name: 'name', label: 'Name' },
        { name: 'email', label: 'Email' },
      ],
    };

    render(<DetailView schema={schema} />);
    // The h1 heading should show the primary field value
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('John Doe');
  });

  it('should fall back to title when primaryField value is empty', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact',
      primaryField: 'name',
      data: { email: 'john@example.com' },
      fields: [
        { name: 'name', label: 'Name' },
        { name: 'email', label: 'Email' },
      ],
    };

    render(<DetailView schema={schema} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Contact');
  });

  it('should render summaryFields as badges', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact',
      primaryField: 'name',
      summaryFields: ['status', 'department'],
      data: { name: 'Jane Doe', status: 'Active', department: 'Engineering' },
      fields: [
        { name: 'name', label: 'Name' },
        { name: 'status', label: 'Status' },
        { name: 'department', label: 'Department' },
      ],
    };

    render(<DetailView schema={schema} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Jane Doe');
    // Summary badges should be present (they appear both as badges and as field values)
    const activeElements = screen.getAllByText('Active');
    expect(activeElements.length).toBeGreaterThanOrEqual(1);
    const engElements = screen.getAllByText('Engineering');
    expect(engElements.length).toBeGreaterThanOrEqual(1);
  });

  it('should not render summary badge for empty values', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact',
      summaryFields: ['status', 'department'],
      data: { name: 'Jane Doe', status: 'Active', department: null },
      fields: [
        { name: 'name', label: 'Name' },
        { name: 'status', label: 'Status' },
      ],
    };

    const { container } = render(<DetailView schema={schema} />);
    // The header area should have a badge for 'Active' but not 'department'
    // Find badges within the header
    const headerBadges = container.querySelectorAll('.border-b .rounded-full');
    const badgeTexts = Array.from(headerBadges).map(b => b.textContent);
    expect(badgeTexts).toContain('Active');
  });

  it('should show "Record not found" when data is null after loading', async () => {
    const mockDataSource = {
      findOne: vi.fn().mockResolvedValue(null),
    } as any;

    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      objectName: 'contact',
      resourceId: 'nonexistent-id',
      fields: [{ name: 'name', label: 'Name' }],
    };

    const { findByText } = render(<DetailView schema={schema} dataSource={mockDataSource} />);
    expect(await findByText('Record not found')).toBeInTheDocument();
    expect(await findByText(/does not exist or may have been deleted/)).toBeInTheDocument();
  });

  it('should show "Go back" button in "Record not found" state when showBack is true', async () => {
    const mockDataSource = {
      findOne: vi.fn().mockResolvedValue(null),
    } as any;
    const onBack = vi.fn();

    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      objectName: 'contact',
      resourceId: 'nonexistent-id',
      fields: [{ name: 'name', label: 'Name' }],
      showBack: true,
    };

    const { findByText } = render(<DetailView schema={schema} dataSource={mockDataSource} onBack={onBack} />);
    const goBackBtn = await findByText('Go back');
    fireEvent.click(goBackBtn);
    expect(onBack).toHaveBeenCalled();
  });

  it('should try fallback with alternate ID when first findOne throws an error', async () => {
    let callCount = 0;
    const mockDataSource = {
      findOne: vi.fn().mockImplementation((_obj: string, _id: string) => {
        callCount++;
        if (callCount === 1) {
          // First call throws (simulate server error)
          return Promise.reject(new Error('Server error'));
        }
        // Second call (fallback) succeeds
        return Promise.resolve({ name: 'Alice' });
      }),
    } as any;

    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      objectName: 'contact',
      resourceId: 'contact-123',
      fields: [{ name: 'name', label: 'Name' }],
    };

    const { findByText } = render(<DetailView schema={schema} dataSource={mockDataSource} />);
    // The fallback should find the record using the stripped ID
    expect(await findByText('Alice')).toBeInTheDocument();
    // findOne should be called twice: first with original ID, then with stripped prefix
    expect(mockDataSource.findOne).toHaveBeenCalledTimes(2);
    expect(mockDataSource.findOne).toHaveBeenNthCalledWith(1, 'contact', 'contact-123');
    expect(mockDataSource.findOne).toHaveBeenNthCalledWith(2, 'contact', '123');
  });

  it('should call findOne with $expand when objectSchema has lookup fields', async () => {
    const mockDataSource = {
      getObjectSchema: vi.fn().mockResolvedValue({
        fields: {
          name: { type: 'text' },
          customer: { type: 'lookup', reference: 'contact' },
          account: { type: 'master_detail', reference: 'account' },
        },
      }),
      findOne: vi.fn().mockResolvedValue({ name: 'Order 1', customer: { name: 'Alice' }, account: { name: 'Acme' } }),
    } as any;

    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Order Details',
      objectName: 'order',
      resourceId: 'order-1',
      fields: [
        { name: 'name', label: 'Name' },
        { name: 'customer', label: 'Customer' },
        { name: 'account', label: 'Account' },
      ],
    };

    render(<DetailView schema={schema} dataSource={mockDataSource} />);

    await waitFor(() => {
      expect(mockDataSource.getObjectSchema).toHaveBeenCalledWith('order');
      expect(mockDataSource.findOne).toHaveBeenCalledWith(
        'order',
        'order-1',
        expect.objectContaining({ $expand: expect.arrayContaining(['customer', 'account']) }),
      );
    });
  });

  it('should call findOne without $expand when objectSchema has no lookup fields', async () => {
    const mockDataSource = {
      getObjectSchema: vi.fn().mockResolvedValue({
        fields: {
          name: { type: 'text' },
          email: { type: 'text' },
        },
      }),
      findOne: vi.fn().mockResolvedValue({ name: 'Alice', email: 'alice@example.com' }),
    } as any;

    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      objectName: 'contact',
      resourceId: 'c1',
      fields: [
        { name: 'name', label: 'Name' },
        { name: 'email', label: 'Email' },
      ],
    };

    render(<DetailView schema={schema} dataSource={mockDataSource} />);

    await waitFor(() => {
      // When no lookup fields exist, findOne should be called without $expand params
      expect(mockDataSource.findOne).toHaveBeenCalledWith('contact', 'c1');
    });
  });

  it('should still work when getObjectSchema is not available on dataSource', async () => {
    const mockDataSource = {
      findOne: vi.fn().mockResolvedValue({ name: 'Bob' }),
    } as any;

    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      objectName: 'contact',
      resourceId: 'c1',
      fields: [{ name: 'name', label: 'Name' }],
    };

    const { findByText } = render(<DetailView schema={schema} dataSource={mockDataSource} />);
    expect(await findByText('Bob')).toBeInTheDocument();
  });

  it('should use i18n fallback for "Record not found" text', async () => {
    const mockDataSource = {
      findOne: vi.fn().mockResolvedValue(null),
    } as any;

    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      objectName: 'contact',
      resourceId: 'nonexistent-id',
      fields: [{ name: 'name', label: 'Name' }],
    };

    const { findByText } = render(<DetailView schema={schema} dataSource={mockDataSource} />);
    // These use the default English translations from useDetailTranslation fallback
    expect(await findByText('Record not found')).toBeInTheDocument();
    expect(await findByText('Go back')).toBeInTheDocument();
  });

  /**
   * objectui#3339 — the request the double above now absorbs used to be pure
   * fire-and-forget: nothing asserted on it, so its shape (and the fact that it
   * left the process at all) was invisible. Pin it here.
   *
   * This is DetailView's own wiring, which `useRecordEditable.test.tsx` cannot
   * see: that the recordId comes from `resourceId`, and that BOTH the update
   * and the delete CTA are gated — one probe each.
   */
  it('probes the record-level explain endpoint for update and delete, and nothing else', async () => {
    const mockDataSource = {
      findOne: vi.fn().mockResolvedValue({ name: 'Alice' }),
    } as any;

    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Contact Details',
      objectName: 'contact',
      resourceId: 'c1',
      fields: [{ name: 'name', label: 'Name' }],
      // Each verdict is asked only for a button the host shows (objectui#13045).
      showEdit: true,
      showDelete: true,
    };

    render(<DetailView schema={schema} dataSource={mockDataSource} />);

    await waitFor(() => expect(explainCalls).toHaveLength(2));

    // No test in this file may reach the network: the double is the only fetch
    // in the tree, and it must only ever be asked for the explain endpoint.
    expect(explainCalls.map((c) => c.url)).toEqual([
      '/api/v1/security/explain',
      '/api/v1/security/explain',
    ]);

    expect(explainCalls.map((c) => c.body)).toEqual(
      expect.arrayContaining([
        { object: 'contact', operation: 'update', recordId: 'c1' },
        { object: 'contact', operation: 'delete', recordId: 'c1' },
      ]),
    );
  });

});
