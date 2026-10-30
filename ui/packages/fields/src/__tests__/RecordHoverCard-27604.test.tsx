/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27604 — every record reference shows a hover card: the target's
 * icon, name and object label, and its DECLARED `highlightFields` minus the
 * name (at most six), drawn by the target's own cell renderers. Pinned through
 * `LookupCellRenderer`, the one renderer a relation cell in a list, the
 * enlarged tab's table and a lookup chip in the details column all draw with.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { LookupCellRenderer } from '../index';
import { RelatedRecordActionsProvider, SchemaRendererProvider } from '@object-ui/react';

const LEAD = {
  name: 'lead',
  label: 'Lead',
  icon: 'user-plus',
  nameField: 'name',
  fields: {
    name: { type: 'text', label: 'Name' },
    company: { type: 'text', label: 'Company' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'new', label: 'New' },
        { value: 'working', label: 'Working' },
      ],
    },
    rating: { type: 'select', label: 'Rating', options: [{ value: 'hot', label: 'Hot' }] },
    email: { type: 'email', label: 'Email' },
    annual_revenue: { type: 'currency', label: 'Annual revenue', currency: 'USD' },
    phone: { type: 'phone', label: 'Phone' },
    lead_source: { type: 'text', label: 'Lead source' },
  },
  // Eight entries, the name first: the card drops the name and stops at six.
  highlightFields: ['name', 'company', 'status', 'rating', 'email', 'annual_revenue', 'phone', 'lead_source'],
};

const CONTACT = {
  name: 'contact',
  label: 'Contact',
  icon: 'contact',
  nameField: 'name',
  // No status field anywhere on the object.
  fields: {
    name: { type: 'text', label: 'Name' },
    title: { type: 'text', label: 'Title' },
    email: { type: 'email', label: 'Email' },
    phone: { type: 'phone', label: 'Phone' },
    account: { type: 'lookup', label: 'Account', reference: 'account' },
  },
  highlightFields: ['account', 'title', 'email', 'phone'],
};

const PRODUCT = {
  name: 'product',
  label: 'Product',
  icon: 'package',
  nameField: 'name',
  fields: {
    name: { type: 'text', label: 'Name' },
    product_code: { type: 'text', label: 'Product code' },
    family: { type: 'select', label: 'Family', options: [{ value: 'hardware', label: 'Hardware' }] },
    price: { type: 'currency', label: 'Price', currency: 'USD' },
  },
  highlightFields: ['product_code', 'family', 'price'],
};

/** Declares no `highlightFields`: nothing may be invented for it. */
const NOTE = {
  name: 'note',
  label: 'Note',
  nameField: 'name',
  fields: { name: { type: 'text', label: 'Name' }, body: { type: 'textarea', label: 'Body' }, status: { type: 'text' } },
};

const ACCOUNT = { name: 'account', label: 'Account', nameField: 'name', fields: { name: { type: 'text' } } };

const DEFS: Record<string, any> = { lead: LEAD, contact: CONTACT, product: PRODUCT, note: NOTE, account: ACCOUNT };

function recordOf(objectName: string, id: string): Record<string, unknown> | null {
  if (objectName === 'lead') {
    return {
      id,
      name: `Lead ${id}`,
      company: 'Analytical Engines',
      status: 'working',
      rating: 'hot',
      email: 'ada@engines.example',
      annual_revenue: 1200000,
      phone: '+1-555-0100',
      lead_source: 'Web',
    };
  }
  if (objectName === 'contact') {
    return { id, name: 'Grace Hopper', title: 'Rear Admiral', email: 'grace@navy.example', phone: '+1-555-0199', account: { id: 'acc-1', name: 'Navy' } };
  }
  if (objectName === 'product') return { id, name: 'Widget', product_code: 'W-100', family: 'hardware', price: 1200 };
  if (objectName === 'note') return { id, name: 'Kickoff notes', body: 'Long body', status: 'draft' };
  return null;
}

function makeSource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async (objectName: string, id: string) => recordOf(objectName, id)),
    getObjectSchema: vi.fn(async (objectName: string) => DEFS[objectName]),
    ...overrides,
  };
}

function makeHost() {
  return {
    resolve: () => ({}),
    recordHref: (objectName: string, recordId: string | number) => `/apps/crm/${objectName}/record/${recordId}`,
    openRecord: vi.fn(),
  } as any;
}

function renderRefs(
  refs: Array<{ objectName: string; id: string; name: string }>,
  source = makeSource(),
  host = makeHost(),
  onRowClick = vi.fn(),
) {
  const utils = render(
    <SchemaRendererProvider dataSource={source as any}>
      <RelatedRecordActionsProvider value={host}>
        <div data-testid="host" onClick={onRowClick}>
          {refs.map((ref) => (
            <div key={`${ref.objectName}:${ref.id}`} data-row={ref.id}>
              <LookupCellRenderer value={{ id: ref.id, name: ref.name }} field={{ type: 'lookup', reference: ref.objectName } as any} />
            </div>
          ))}
        </div>
      </RelatedRecordActionsProvider>
    </SchemaRendererProvider>,
  );
  return { ...utils, source, host, onRowClick };
}

const linkOf = (id: string) => document.querySelector(`[data-row="${id}"] a`) as HTMLAnchorElement;
const cards = () => Array.from(document.querySelectorAll('[data-record-hover-card]'));
const card = () => document.querySelector('[data-record-hover-card]') as HTMLElement | null;
const shownFields = () =>
  Array.from(document.querySelectorAll('[data-record-hover-card-field]')).map((el) => el.getAttribute('data-record-hover-card-field'));

function hover(el: Element) {
  fireEvent.pointerOver(el, { pointerType: 'mouse' });
}
function unhover(el: Element) {
  fireEvent.pointerOut(el, { pointerType: 'mouse' });
}

/** The read the schema leaves the cell to make settles before the hover. */
async function settled(source: ReturnType<typeof makeSource>) {
  await waitFor(() => expect(source.getObjectSchema).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openCardOver(id: string) {
  hover(linkOf(id));
  await waitFor(() => expect(card()).not.toBeNull(), { timeout: 2000 });
  await waitFor(() => expect(card()).not.toHaveAttribute('aria-busy'));
}

describe('RecordHoverCard over a lookup reference (objectstack#27604)', () => {
  it('a lead: the declared highlights minus the name, six at most, in the target\'s own renderers', async () => {
    const { source } = renderRefs([{ objectName: 'lead', id: 'lead-a', name: 'Lead lead-a' }]);
    await settled(source);
    await openCardOver('lead-a');

    expect(shownFields()).toEqual(['company', 'status', 'rating', 'email', 'annual_revenue', 'phone']);
    const c = card()!;
    expect(c.querySelector('[data-record-hover-card-title]')).toHaveTextContent('Lead lead-a');
    expect(c.querySelector('[data-record-hover-card-object-label]')).toHaveTextContent('Lead');
    // The select draws its option label, the currency its formatted amount.
    expect(c.querySelector('[data-record-hover-card-field="status"]')).toHaveTextContent('Working');
    expect(c.querySelector('[data-record-hover-card-field="annual_revenue"]')?.textContent).toMatch(/1,200,000/);
    expect(c).toHaveTextContent('Annual revenue');
  });

  it('a contact (no status field): exactly the declared four, nothing invented, one read with $expand', async () => {
    const { source } = renderRefs([{ objectName: 'contact', id: 'contact-a', name: 'Grace Hopper' }]);
    await settled(source);
    await openCardOver('contact-a');

    expect(shownFields()).toEqual(['account', 'title', 'email', 'phone']);
    expect(card()).not.toHaveTextContent('Status');
    expect(source.findOne).toHaveBeenCalledTimes(1);
    expect(source.findOne).toHaveBeenCalledWith('contact', 'contact-a', { $expand: ['account'] });
    // A reference inside the card is a plain link: it has no card of its own.
    const inner = card()!.querySelector('[data-record-hover-card-field="account"] a') as HTMLAnchorElement;
    expect(inner).toHaveTextContent('Navy');
    hover(inner);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(cards()).toHaveLength(1);
  });

  it('a product: its declared highlights in order', async () => {
    const { source } = renderRefs([{ objectName: 'product', id: 'product-a', name: 'Widget' }]);
    await settled(source);
    await openCardOver('product-a');

    expect(shownFields()).toEqual(['product_code', 'family', 'price']);
    expect(card()!.querySelector('[data-record-hover-card-field="family"]')).toHaveTextContent('Hardware');
    expect(card()!.querySelector('[data-record-hover-card-field="price"]')?.textContent).toMatch(/1,200/);
  });

  it('an object that declares no highlightFields: the name and the object label only', async () => {
    const { source } = renderRefs([{ objectName: 'note', id: 'note-a', name: 'Kickoff notes' }]);
    await settled(source);
    await openCardOver('note-a');

    expect(card()!.querySelector('[data-record-hover-card-title]')).toHaveTextContent('Kickoff notes');
    expect(card()!.querySelector('[data-record-hover-card-object-label]')).toHaveTextContent('Note');
    expect(shownFields()).toEqual([]);
    expect(card()!.querySelector('dl')).toBeNull();
  });

  it('an unreadable record: the reference\'s name and the object label, nothing else', async () => {
    const source = makeSource({ findOne: vi.fn(async () => Promise.reject(new Error('404'))) });
    renderRefs([{ objectName: 'lead', id: 'lead-gone', name: 'Old lead' }], source);
    await settled(source);
    await openCardOver('lead-gone');

    expect(card()!.querySelector('[data-record-hover-card-title]')).toHaveTextContent('Old lead');
    expect(card()!.querySelector('[data-record-hover-card-object-label]')).toHaveTextContent('Lead');
    expect(shownFields()).toEqual([]);
  });

  it('one request per shown card, none on row render, cached per record', async () => {
    const refs = Array.from({ length: 200 }, (_, i) => ({ objectName: 'lead', id: `lead-r${i}`, name: `Lead ${i}` }));
    const { source } = renderRefs(refs);
    await settled(source);
    // 200 rows drawn: not one record read.
    expect(source.findOne).not.toHaveBeenCalled();

    await openCardOver('lead-r5');
    expect(source.findOne).toHaveBeenCalledTimes(1);

    unhover(linkOf('lead-r5'));
    await waitFor(() => expect(card()).toBeNull());
    await openCardOver('lead-r5');
    // The same record again: answered from the cache.
    expect(source.findOne).toHaveBeenCalledTimes(1);

    unhover(linkOf('lead-r5'));
    await waitFor(() => expect(card()).toBeNull());
    await openCardOver('lead-r6');
    expect(source.findOne).toHaveBeenCalledTimes(2);
  });

  it('shows after the hover delay, not at once', async () => {
    const { source } = renderRefs([{ objectName: 'lead', id: 'lead-delay', name: 'Lead delay' }]);
    await settled(source);
    hover(linkOf('lead-delay'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(card()).toBeNull();
    await waitFor(() => expect(card()).not.toBeNull(), { timeout: 2000 });
  });

  it('keyboard: focus alone shows nothing, Space shows the card, Esc hides it', async () => {
    const { source } = renderRefs([{ objectName: 'lead', id: 'lead-kb', name: 'Lead kb' }]);
    await settled(source);
    const link = linkOf('lead-kb');
    act(() => link.focus());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(card()).toBeNull();

    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(space);
    });
    // Space shows the card instead of scrolling the page.
    expect(space.defaultPrevented).toBe(true);
    await waitFor(() => expect(card()).not.toBeNull());

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(card()).toBeNull());
  });

  it('one card at a time', async () => {
    const { source } = renderRefs([
      { objectName: 'lead', id: 'lead-one', name: 'Lead one' },
      { objectName: 'product', id: 'product-two', name: 'Widget two' },
    ]);
    await settled(source);
    fireEvent.keyDown(linkOf('lead-one'), { key: ' ' });
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.keyDown(linkOf('product-two'), { key: ' ' });
    await waitFor(() => expect(card()).toHaveAttribute('data-record-hover-card-object', 'product'));
    expect(cards()).toHaveLength(1);
  });

  it('the card never changes the host\'s layout: it floats outside the host\'s DOM', async () => {
    const { source } = renderRefs([{ objectName: 'lead', id: 'lead-layout', name: 'Lead layout' }]);
    await settled(source);
    const hostEl = document.querySelector('[data-testid="host"]') as HTMLElement;
    const markup = () => hostEl.innerHTML.replace(/ data-state="(open|closed)"/g, '');
    const before = markup();

    await openCardOver('lead-layout');

    expect(hostEl.contains(card())).toBe(false);
    expect(document.body.contains(card())).toBe(true);
    expect(markup()).toBe(before);
  });

  it('the title opens the record the way the reference does, and nothing under the card hears the click', async () => {
    const { source, host, onRowClick } = renderRefs([{ objectName: 'lead', id: 'lead-open', name: 'Lead open' }]);
    await settled(source);
    await openCardOver('lead-open');

    const title = card()!.querySelector('[data-record-hover-card-title]') as HTMLAnchorElement;
    expect(title).toHaveAttribute('href', '/apps/crm/lead/record/lead-open');
    fireEvent.click(title);

    expect(host.openRecord).toHaveBeenCalledWith('lead', 'lead-open');
    expect(onRowClick).not.toHaveBeenCalled();
    await waitFor(() => expect(card()).toBeNull());
  });
});
