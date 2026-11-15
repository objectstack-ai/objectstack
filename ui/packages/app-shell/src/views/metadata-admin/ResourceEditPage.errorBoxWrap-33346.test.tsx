// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#33346 (row 147) — the editor's top error box keeps a refusal
 * inside the viewport.
 *
 * A Studio refusal can be one unbroken token: a Zod enum issue prints the
 * whole option list as `"text"|"textarea"|"email"|…` with no space in it.
 * Measured live at 1440 px on the showcase (an object field saved without a
 * `type`), that box ran to a scroll width of 3067 px and the text was cut at
 * the right edge. The box now breaks anywhere and may shrink inside its flex
 * column, so the whole text stays on screen.
 *
 * jsdom does no layout, so the pin reads the two classes that make the box
 * wrap (the live 1440 px reading is in the PR). The CONTROL is the same box
 * carrying the whole message, untruncated.
 */

import '@testing-library/jest-dom/vitest';
// The source loads this lazily; pay that load at collection, not inside a
// case's clocked window.
import '@objectstack/lint';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const LONG_TOKEN =
  'Fields→amount→type:expected"text"|"textarea"|"email"|"url"|"phone"|"password"|"markdown"|"html"|"richtext"|"number"|"currency"|"percent"|"date"|"datetime"|"time"|"boolean"|"toggle"|"select"|"multiselect"|"radio"|"checkboxes"|"lookup"|"master_detail"|"tree"|"image"|"file"|"avatar"|"video"|"audio"|"formula"|"summary"|"autonumber"|"location"|"address"|"code"|"json"|"color"|"rating"|"slider"|"signature"|"qrcode"|"progress"|"tags"|"vector"';

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => {
    throw new Error(LONG_TOKEN);
  }),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        {
          type: 'object',
          name: 'object',
          label: 'Object',
          allowEnvironmentOverlay: false,
          allowRuntimeCreate: true,
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, label: { type: 'string' } },
          },
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderRefused() {
  render(
    <MemoryRouter initialEntries={['/metadata/object/showcase_account']}>
      <MetadataResourceEditPage type="object" name="showcase_account" />
    </MemoryRouter>,
  );
  return waitFor(() => {
    const el = screen.queryByTestId('resource-edit-error');
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
}

describe('#33346 row 147 — the top error box wraps an unbroken refusal', () => {
  it('breaks anywhere and may shrink inside its column', async () => {
    const box = await renderRefused();
    expect(box.className).toContain('[overflow-wrap:anywhere]');
    expect(box.className).toContain('min-w-0');
  });

  it('CONTROL — the box carries the whole refusal, untruncated', async () => {
    const box = await renderRefused();
    expect(box.textContent).toContain(LONG_TOKEN);
  });
});
