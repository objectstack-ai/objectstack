// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The view variant inspector REPORTS an object-required field inside a
 * predicate-gated form section as a blocking issue, and shows the refusal
 * (objectui#6900, ruling 5749269225, letter c).
 *
 * The ruled behaviour: refuse at authoring time, name both facts — the field is
 * required on the OBJECT, and its section is shown only under a predicate — and
 * teach the three remedies (move the field out, drop the predicate, or make the
 * field not required on the object). It is fenced for the predicate shapes the
 * object's own field rules cannot restate (identity, feature, host and page
 * state); a `record.*` predicate draws nothing, because it can be written as
 * the field's server-enforced `requiredWhen` and the build-time lint already
 * teaches that.
 *
 * Both routes to the same editor are exercised: SCOPED through `ViewInspector`
 * and HOME through `ViewDefaultInspector`. The Save gate those reports feed is
 * pinned from the host side in
 * {@link file://../ResourceEditPage.requiredInGatedSection-6900.test.tsx}.
 *
 * The object catalog is read by the real `useObjectFields` (a stubbed
 * `client.get('object', …)` answering the spec document), and the predicate's
 * roots by the real `@objectstack/formula` parser.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';

const cel = (source: string) => ({ dialect: 'cel', source });
const IDENTITY_GATE = "'sales_manager' in current_user.positions";

const state = vi.hoisted(() => ({
  salaryRequired: true,
  metadataClient: {
    get: null as unknown as (type: string, name: string) => Promise<unknown>,
    list: async () => [] as unknown[],
    withPreviewDrafts() { return this; },
  },
}));

vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  return { ...mod, useMetadataClient: () => state.metadataClient };
});

import { ViewInspector, ViewDefaultInspector } from './ViewInspector';

beforeEach(() => {
  state.salaryRequired = true;
  state.metadataClient.get = async (type: string, name: string) =>
    type === 'object' && name === 'employee'
      ? {
          name: 'employee',
          fields: {
            subject: { type: 'text', label: 'Subject' },
            salary: { type: 'number', label: 'Salary', ...(state.salaryRequired ? { required: true } : {}) },
          },
        }
      : null;
});

afterEach(() => {
  cleanup();
});

type Section = Record<string, unknown>;

function formDraft(sections: Section[]): Record<string, unknown> {
  return {
    name: 'employee_form',
    label: 'Employee form',
    object: 'employee',
    viewKind: 'form',
    config: { type: 'simple', sections },
  };
}

const gatedPay = (gate: unknown = cel(IDENTITY_GATE)): Section[] => [
  { name: 'basics', label: 'Basics', fields: ['subject'] },
  { name: 'pay', label: 'Compensation', visibleWhen: gate, fields: ['salary'] },
];

function renderHost(host: 'scoped' | 'home', draft: Record<string, unknown>, report: (n: number) => void) {
  const common = {
    type: 'view',
    name: 'employee_form',
    draft,
    onPatch: () => {},
    onSelectionChange: () => {},
    readOnly: false,
    locale: 'en-US' as never,
    onBlockingIssuesChange: report,
  };
  if (host === 'scoped') {
    return render(
      <ViewInspector {...common} selection={{ kind: 'view', id: 'config' }} onClearSelection={() => {}} />,
    );
  }
  return render(<ViewDefaultInspector {...common} />);
}

/** Let the catalog read and the lazy parser settle before a negative reading. */
async function settle() {
  await act(async () => {
    await import('@objectstack/formula');
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe.each([['scoped'], ['home']] as const)(
  'ViewVariantInspector on the %s path — a required field in a gated section (objectui#6900)',
  (host) => {
    it('reports ONE blocking issue and names both facts plus the three remedies', async () => {
      const report = vi.fn();
      renderHost(host, formDraft(gatedPay()), report);

      await waitFor(() => expect(report.mock.calls.at(-1)?.[0]).toBe(1), { timeout: 4000 });
      const alert = await screen.findByTestId('view-gated-required-issues');
      const text = alert.textContent ?? '';
      // The field, and that it is required ON THE OBJECT.
      expect(text).toContain('"Salary" (salary) is required on object "employee"');
      // The section, and its predicate gate.
      expect(text).toContain('section "Compensation"');
      expect(text).toContain(IDENTITY_GATE);
      // The three remedies.
      expect(text).toContain('Move "Salary" into a section that has no visibleWhen');
      expect(text).toContain('Remove visibleWhen from section "Compensation"');
      expect(text).toContain('Make "Salary" not required on object "employee"');
    });

    it('control: a RECORD-scoped gate draws no issue', async () => {
      const report = vi.fn();
      renderHost(host, formDraft(gatedPay(cel("record.status == 'sent'"))), report);
      await settle();
      expect(report.mock.calls.at(-1)?.[0]).toBe(0);
      expect(screen.queryByTestId('view-gated-required-issues')).toBeNull();
    });

    it('control: the field NOT required on the object draws no issue', async () => {
      state.salaryRequired = false;
      const report = vi.fn();
      renderHost(host, formDraft(gatedPay()), report);
      await settle();
      expect(report.mock.calls.at(-1)?.[0]).toBe(0);
      expect(screen.queryByTestId('view-gated-required-issues')).toBeNull();
    });

    it('control: the field moved OUT of the gated section draws no issue', async () => {
      const report = vi.fn();
      renderHost(
        host,
        formDraft([
          { name: 'basics', label: 'Basics', fields: ['subject', 'salary'] },
          { name: 'pay', label: 'Compensation', visibleWhen: cel(IDENTITY_GATE), fields: [] },
        ]),
        report,
      );
      await settle();
      expect(report.mock.calls.at(-1)?.[0]).toBe(0);
      expect(screen.queryByTestId('view-gated-required-issues')).toBeNull();
    });
  },
);
