/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The synthesized record page's H1 and its body's H1 dedupe, RENDERED
 * TOGETHER on one record (objectui#9436, ruled C1).
 *
 * ## Why the two halves are pinned in one tree
 *
 * The H1 is drawn by `@object-ui/components`' `PageHeaderRenderer`
 * (`page:header`). The body is drawn by this package's `record:details`, which
 * hides the one row the H1 already shows. Each half has its own pins, and each
 * set of pins states the OTHER half's answer as an assumption in a comment.
 * That is how the two drifted apart once already. Before objectui#9436 the
 * header ranked `titleFormat` above the declared pointer and the dedupe
 * mirrored it. Moving the header alone to the protocol order was measured to
 * leave, on an object declaring both a `nameField` and a `titleFormat`:
 *
 *   - composite template → H1 `HT-2026-001`, with the `HT-2026-001` row still
 *     printed underneath it (a duplicate);
 *   - single-field template → H1 `HT-2026-005` with its row still printed,
 *     AND the `Acme Corporation` row hidden, a row the H1 no longer showed.
 *
 * Neither half's own pins could see that, because each one reads only its own
 * half. This file reads the REAL H1 beside the REAL body, so it reddens when
 * either half moves without the other:
 *
 *   - revert the header to the template-first order → the H1 assertions
 *     redden;
 *   - revert the dedupe to the template-first check → the body assertions
 *     redden.
 *
 * The agreement itself is also asserted, independent of any one value: the
 * H1's text is printed as no row of the body.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
// Registers `page:header` (and the rest of the atoms) on the shared registry.
import '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../record-details';

/** Declares BOTH the ADR-0079 pointer and a two-field template. */
const contractSchema = {
  name: 'contract',
  label: 'Contract',
  nameField: 'contract_no',
  titleFormat: '{contract_no} - {name}',
  fields: {
    contract_no: { type: 'text', label: 'Contract No' },
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  },
};

const FIELDS = ['contract_no', 'name', 'amount'];

/** Render the header and the body under ONE record context; read both. */
function renderPage(record: any, schema: any): { h1: string | null | undefined; body: string } {
  const Header = ComponentRegistry.get('page:header');
  if (!Header) throw new Error('page:header not registered');
  const { container } = render(
    <ActionProvider>
      <RecordContextProvider
        objectName={schema.name}
        recordId={record.id}
        data={record}
        objectSchema={schema}
      >
        <div data-testid="page-header">
          <Header schema={{ type: 'page:header' }} />
        </div>
        <div data-testid="page-body">
          <RecordDetailsRenderer schema={{ fields: FIELDS } as never} />
        </div>
      </RecordContextProvider>
    </ActionProvider>,
  );
  const h1 = container.querySelector('[data-testid="page-header"] h1')?.textContent;
  const body = container.querySelector('[data-testid="page-body"]')?.textContent ?? '';
  return { h1, body };
}

beforeEach(() => {
  // `useRecordEditable` probes `POST /api/v1/security/explain`; happy-dom
  // would resolve that to a REAL socket (objectui#6640). Its answer is
  // orthogonal to which heading renders and which row is hidden.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('record page — the H1 and the body dedupe agree on the declared pointer (#9436)', () => {
  it('composite template: the H1 is the declared pointer, and its row is not printed under it', () => {
    const { h1, body } = renderPage(
      { id: 'C1', contract_no: 'HT-2026-001', name: 'Acme Corporation', amount: 42 },
      contractSchema,
    );

    expect(h1).toBe('HT-2026-001');
    expect(body).not.toContain('HT-2026-001');
    // The template's other field is no heading, so its row stays.
    expect(body).toContain('Acme Corporation');
    expect(body).toContain('Amount'); // CONTROL: the body rendered at all
  });

  it('single-field template: the H1 is the declared pointer, and the template field keeps its row', () => {
    const { h1, body } = renderPage(
      { id: 'C5', contract_no: 'HT-2026-005', name: 'Acme Corporation', amount: 3 },
      { ...contractSchema, titleFormat: '{name}' },
    );

    expect(h1).toBe('HT-2026-005');
    expect(body).not.toContain('HT-2026-005');
    expect(body).toContain('Acme Corporation');
    expect(body).toContain('Amount'); // CONTROL: the body rendered at all
  });

  it('CONTROL — with NO declared pointer the template is the H1, and a composite hides no row', () => {
    // Where the template still titles the record, the two halves still agree:
    // the H1 is a composite that is no field's value, so both rows print.
    const { nameField: _declaredPointer, ...templateOnly } = contractSchema;
    const { h1, body } = renderPage(
      { id: 'C9', contract_no: 'HT-2026-009', name: 'Acme Corporation', amount: 8 },
      templateOnly,
    );

    expect(h1).toBe('HT-2026-009 - Acme Corporation');
    expect(body).toContain('HT-2026-009');
    expect(body).toContain('Acme Corporation');
  });
});
