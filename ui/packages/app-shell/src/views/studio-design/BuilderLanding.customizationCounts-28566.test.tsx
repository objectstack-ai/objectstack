// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D3 — each read-only base's Studio landing card says what this
 * deployment changed on it, "n customized, m switched off", from the server's
 * per-package customization read (`GET /api/v1/packages/:id/customizations`).
 *
 * The real `BuilderLanding` and the real reader (`packageCustomizations-io`)
 * run under a real router; only the package list and the wire are stubbed.
 * The stubbed answers are shaped by the route's declaration,
 * `GetPackageCustomizationsResponseSchema`, inside the dispatcher envelope.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { t, tFormat } from '../metadata-admin/i18n';
import { resetRuntimeConfigForTesting } from '../../runtime-config';

const packages = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => packages.list) };
});

// The create dialog is closed throughout; its form stack is not under test.
vi.mock('../metadata-admin/PackageFormDialog', () => ({ PackageFormDialog: () => null }));

import { BuilderLanding } from './BuilderLanding';

const HOTCRM = { id: 'hotcrm', name: 'HotCRM', writable: false, namespace: 'hotcrm' };
const HOTCRM_PAIR = { id: 'hotcrm.custom', name: 'HotCRM customizations', writable: true, namespace: 'hotcrm_custom' };
const SHOWCASE = { id: 'com.example.showcase', name: 'Showcase', writable: false, namespace: 'showcase' };
const WRITABLE = { id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' };
/** A pair served read-only (code-shipped): still a pair, so still no line. */
const READONLY_PAIR = { id: 'com.example.showcase.custom', name: 'Showcase pair', writable: false, namespace: 'showcase_custom' };

const CUSTOMIZATIONS_RE = /^\/api\/v1\/packages\/([^/]+)\/customizations$/;

/** A served answer for `id`: `overrides` overrides, `extensions` field members, `switchedOff` flows. */
function served(id: string, overrides: number, extensions: number, switchedOff: number) {
  const data = {
    packageId: id,
    overrides: Array.from({ length: overrides }, (_, i) => ({ type: 'view', name: `view_${i}` })),
    extensions: Array.from({ length: extensions }, (_, i) => ({ object: 'account', kind: 'field' as const, name: `field_${i}` })),
    switchedOff: Array.from({ length: switchedOff }, (_, i) => ({ type: 'flow', name: `flow_${i}` })),
    counts: { overrides, extensions, switchedOff },
  };
  return { status: 200, body: { success: true, data } };
}

type Answer = { status: number; body: unknown } | 'never';

/**
 * Stub the wire: each customization request is answered from `answers` by
 * base id; every request URL is recorded.
 */
function stubWire(answers: Record<string, Answer>) {
  const requested: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const m = CUSTOMIZATIONS_RE.exec(url);
    const answer = m ? answers[decodeURIComponent(m[1])] : undefined;
    if (answer === 'never') return new Promise<Response>(() => {});
    if (!answer) throw new Error(`unexpected request ${url}`);
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body,
      text: async () => JSON.stringify(answer.body),
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requested };
}

const customizationRequests = (requested: string[]) => requested.filter((u) => CUSTOMIZATIONS_RE.test(u));

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="location">{pathname}</div>;
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/studio']}>
      <LocationProbe />
      <Routes>
        <Route path="/studio" element={<BuilderLanding />} />
        <Route path="/studio/:packageId/:tab" element={<div data-testid="pillar-builder" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The card a package renders in: the element holding both its name and its links. */
function cardOf(name: string): HTMLElement {
  const card = screen.getByText(name).closest('.rounded-lg.border');
  if (!(card instanceof HTMLElement)) throw new Error(`no card found for ${name}`);
  return card;
}

const customizedText = (n: number) => tFormat('engine.studio.landing.customizations.customized', 'en-US', { customized: n });
const switchedOffText = (n: number) => tFormat('engine.studio.landing.customizations.switchedOff', 'en-US', { switchedOff: n });

afterEach(() => {
  cleanup();
  packages.list = [];
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('Studio landing: a read-only base says "n customized, m switched off" (ADR-0146 D3)', () => {
  it('reads 3 overrides + 1 extension and 2 switched off as "4 customized, 2 switched off", linking the pair and the Automations pillar', async () => {
    packages.list = [HOTCRM_PAIR, HOTCRM];
    const { requested } = stubWire({ hotcrm: served('hotcrm', 3, 1, 2) });
    renderLanding();

    const line = await within(await waitFor(() => cardOf('HotCRM'))).findByTestId('studio-landing-customizations');
    await waitFor(() => expect(line).toHaveAttribute('data-state', 'read'));
    expect(line).toHaveTextContent('4 customized, 2 switched off');

    const pairLink = within(line).getByTestId('studio-landing-customizations-pair');
    expect(pairLink).toHaveTextContent(customizedText(4));
    expect(pairLink).toHaveAttribute('href', '/studio/hotcrm.custom/data');
    const offLink = within(line).getByTestId('studio-landing-customizations-switched-off');
    expect(offLink).toHaveTextContent(switchedOffText(2));
    expect(offLink).toHaveAttribute('href', '/studio/hotcrm/automations');

    fireEvent.click(pairLink);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/hotcrm.custom/data'));
    // One read, for the base; never for its pair.
    expect(customizationRequests(requested)).toEqual(['/api/v1/packages/hotcrm/customizations']);
  });

  it('reads a base with no pair as "0 customized, 0 switched off", with no pair link', async () => {
    packages.list = [SHOWCASE];
    stubWire({ 'com.example.showcase': served('com.example.showcase', 0, 0, 0) });
    renderLanding();

    const line = await within(await waitFor(() => cardOf('Showcase'))).findByTestId('studio-landing-customizations');
    await waitFor(() => expect(line).toHaveAttribute('data-state', 'read'));
    expect(line).toHaveTextContent('0 customized, 0 switched off');
    expect(within(line).queryByTestId('studio-landing-customizations-pair')).not.toBeInTheDocument();
    expect(within(line).getByText(customizedText(0))).not.toHaveAttribute('href');
    expect(within(line).getByTestId('studio-landing-customizations-switched-off')).toHaveAttribute(
      'href',
      '/studio/com.example.showcase/automations',
    );
  });

  it('shows no number on a failed read: a muted "couldn’t read" with the server’s sentence as its title', async () => {
    packages.list = [SHOWCASE];
    const sentence = 'Metadata service not available';
    stubWire({ 'com.example.showcase': { status: 503, body: { success: false, error: { message: sentence } } } });
    renderLanding();

    const line = await within(await waitFor(() => cardOf('Showcase'))).findByTestId('studio-landing-customizations');
    await waitFor(() => expect(line).toHaveAttribute('data-state', 'failed'));
    expect(line).toHaveTextContent(t('engine.studio.landing.customizations.failed', 'en-US'));
    expect(line).toHaveAttribute('title', expect.stringContaining(sentence));
    expect(line.textContent).not.toMatch(/\d/);
  });

  it('shows no number when the answer is one the route’s declaration refuses', async () => {
    packages.list = [SHOWCASE];
    // `counts` missing: off-contract, so no count is read out of it.
    stubWire({
      'com.example.showcase': { status: 200, body: { success: true, data: { packageId: 'com.example.showcase', overrides: [] } } },
    });
    renderLanding();

    const line = await within(await waitFor(() => cardOf('Showcase'))).findByTestId('studio-landing-customizations');
    await waitFor(() => expect(line).toHaveAttribute('data-state', 'failed'));
    expect(line.textContent).not.toMatch(/\d/);
  });

  it('draws no line and sends no request for a writable package or a pair', async () => {
    packages.list = [WRITABLE, HOTCRM_PAIR, READONLY_PAIR, SHOWCASE];
    const { requested } = stubWire({ 'com.example.showcase': served('com.example.showcase', 1, 0, 0) });
    renderLanding();

    await screen.findByText('Showcase pair');
    await waitFor(() =>
      expect(within(cardOf('Showcase')).getByTestId('studio-landing-customizations')).toHaveAttribute('data-state', 'read'),
    );
    expect(within(cardOf('Acme')).queryByTestId('studio-landing-customizations')).not.toBeInTheDocument();
    expect(within(cardOf('HotCRM customizations')).queryByTestId('studio-landing-customizations')).not.toBeInTheDocument();
    expect(within(cardOf('Showcase pair')).queryByTestId('studio-landing-customizations')).not.toBeInTheDocument();
    expect(customizationRequests(requested)).toEqual(['/api/v1/packages/com.example.showcase/customizations']);
  });

  it('paints the landing before the counts arrive, with no number on the line', async () => {
    packages.list = [HOTCRM, SHOWCASE];
    const { requested } = stubWire({ hotcrm: 'never', 'com.example.showcase': 'never' });
    renderLanding();

    await screen.findByText('HotCRM');
    expect(screen.getByText('Showcase')).toBeInTheDocument();
    await waitFor(() => expect(customizationRequests(requested)).toHaveLength(2));
    for (const name of ['HotCRM', 'Showcase']) {
      const line = within(cardOf(name)).getByTestId('studio-landing-customizations');
      expect(line).toHaveAttribute('data-state', 'loading');
      expect(line.textContent).not.toMatch(/\d/);
    }
  });
});
