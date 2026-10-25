// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12233 — a record page's lookup links carry the router's basename,
 * so the same href works from a left click, a new tab and a copied link.
 *
 * Measured on hosted HotCRM (the console mounted at `/_console`): the account
 * and contact links in a lead's conversion section and its owner link read
 * `/apps/APP/crm_account/record/ID?from=…`. A left click worked, because the
 * anchor hands it to the SPA and `navigate` applies the basename. Opening the
 * link in a new tab, middle-clicking it or pasting a copied link resolved the
 * bare route against the origin and landed on the server's
 * `ENDPOINT_NOT_FOUND` body.
 *
 * Every case mounts what a record page mounts around its lookups: the real
 * `RelatedRecordActionsBridge` under a router, with the real
 * `LookupCellRenderer` that the detail body resolves a lookup through. The
 * oracle for the href is react-router's own `Link` for the same route, so the
 * pin does not restate how a basename is joined. The control mounts the same
 * tree with no basename and keeps today's href.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';
import { LookupCellRenderer } from '@object-ui/fields';

import { RelatedRecordActionsBridge } from '../RelatedRecordActionsBridge';

afterEach(() => {
  cleanup();
});

const APP = 'hotcrm';
const OBJECTS = [{ name: 'crm_lead' }, { name: 'crm_account' }, { name: 'crm_contact' }, { name: 'sys_user' }];

/** The three links the hosted pass measured on a lead page. */
const LOOKUPS = [
  { reference: 'crm_account', value: { id: 'A-1', name: 'Acme Corp' } },
  { reference: 'crm_contact', value: { id: 'C-1', name: 'Ada Lovelace' } },
  { reference: 'sys_user', value: { id: 'U-1', name: 'Grace Hopper' } },
] as const;

const routeOf = (objectName: string, id: string) => `/apps/${APP}/${objectName}/record/${id}`;

/** The router's own location, basename stripped: where a left click took us. */
function RouterLocation() {
  const location = useLocation();
  return <output data-testid="router-location">{`${location.pathname}${location.search}`}</output>;
}

function mount(basename?: string) {
  const root = basename ?? '';
  return render(
    <MemoryRouter basename={basename} initialEntries={[`${root}${routeOf('crm_lead', 'L-1')}`]}>
      <RelatedRecordActionsBridge
        appName={APP}
        objects={OBJECTS}
        dataSource={null}
        parentObjectName="crm_lead"
        parentRecordId="L-1"
        parentTitle="Lead One"
      >
        {LOOKUPS.map(({ reference, value }) => (
          <LookupCellRenderer
            key={reference}
            value={value}
            field={{ type: 'lookup', reference } as never}
          />
        ))}
        {LOOKUPS.map(({ reference, value }) => (
          <Link key={reference} to={routeOf(reference, value.id)} data-testid={`oracle-${reference}`}>
            oracle
          </Link>
        ))}
      </RelatedRecordActionsBridge>
      <RouterLocation />
    </MemoryRouter>,
  );
}

const anchorFor = (name: string) => screen.getByText(name).closest('a');
const hrefOf = (el: Element | null) => el?.getAttribute('href') ?? null;
const pathOf = (href: string | null) => (href ?? '').split('?')[0];

describe('record-page lookup links carry the router basename (objectui#12233)', () => {
  it('under basename /_console: each lookup href is the one react-router renders for its route', () => {
    mount('/_console');
    for (const { reference, value } of LOOKUPS) {
      const href = hrefOf(anchorFor(value.name));
      expect(pathOf(href)).toBe(`/_console${routeOf(reference, value.id)}`);
      expect(pathOf(href)).toBe(hrefOf(screen.getByTestId(`oracle-${reference}`)));
      // The parent trail the record body pathes back through is still carried.
      expect(href).toContain('?from=');
    }
  });

  it('under basename /_console: a left click routes to the same destination the href names, without a second basename', () => {
    mount('/_console');
    const account = anchorFor('Acme Corp');
    const href = hrefOf(account);
    fireEvent.click(account as Element, { button: 0 });
    const routed = screen.getByTestId('router-location').textContent ?? '';
    expect(routed.split('?')[0]).toBe(routeOf('crm_account', 'A-1'));
    expect(href).toBe(`/_console${routed}`);
  });

  it('control, no basename: the href is the bare route, as before', () => {
    mount();
    for (const { reference, value } of LOOKUPS) {
      const href = hrefOf(anchorFor(value.name));
      expect(pathOf(href)).toBe(routeOf(reference, value.id));
      expect(pathOf(href)).toBe(hrefOf(screen.getByTestId(`oracle-${reference}`)));
    }
    const account = anchorFor('Acme Corp');
    const href = hrefOf(account);
    fireEvent.click(account as Element, { button: 0 });
    expect(href).toBe(screen.getByTestId('router-location').textContent);
  });
});
