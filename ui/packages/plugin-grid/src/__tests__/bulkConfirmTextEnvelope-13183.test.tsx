/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13183 step 1 — a bulk action's `confirmText` is read as a string or
 * as the `{ dialect: 'template', source }` envelope the protocol serves once
 * objectstack#24947 makes the slot a `template` slot.
 *
 * Two halves:
 *   - the reader `bulkConfirmTextSource`: a string, an envelope (with and
 *     without `dialect`), blank and absent values;
 *   - the real `BulkActionDialog`: an envelope's `source` is the confirm
 *     sentence (never `[object Object]`), a plain string renders unchanged, and
 *     a blank or absent value keeps the default sentence.
 * Holes are not filled at this step: `{{ count }}` stays as written.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { BulkActionDef } from '@object-ui/types';

import { BulkActionDialog } from '../components/BulkActionDialog';
import { bulkConfirmTextSource } from '../components/bulkConfirmText';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

describe('bulkConfirmTextSource (objectui#13183)', () => {
  it('returns a plain string as written', () => {
    expect(bulkConfirmTextSource('Archive these accounts?')).toBe('Archive these accounts?');
  });

  it("returns an envelope's source verbatim, holes unfilled", () => {
    expect(
      bulkConfirmTextSource({ dialect: 'template', source: 'Update {{ count }} record(s)?' }),
    ).toBe('Update {{ count }} record(s)?');
  });

  it('reads an envelope that omits `dialect`', () => {
    expect(bulkConfirmTextSource({ source: 'Close these deals?' })).toBe('Close these deals?');
  });

  it('returns undefined for a blank string or a blank source', () => {
    expect(bulkConfirmTextSource('')).toBeUndefined();
    expect(bulkConfirmTextSource('   ')).toBeUndefined();
    expect(bulkConfirmTextSource({ dialect: 'template', source: '  ' })).toBeUndefined();
  });

  it('returns undefined for an envelope that carries no source (objectstack#25438)', () => {
    // The protocol's envelope types `source` as optional: a parsed slot may
    // carry only its `ast`. The slot's type admits that shape, and the reader
    // shows the default sentence for it.
    const astOnly: BulkActionDef['confirmText'] = { dialect: 'template' };
    expect(bulkConfirmTextSource(astOnly)).toBeUndefined();
  });

  it('returns undefined when absent', () => {
    expect(bulkConfirmTextSource(undefined)).toBeUndefined();
    expect(bulkConfirmTextSource(null)).toBeUndefined();
  });

  it('returns undefined for an envelope with no string source', () => {
    expect(bulkConfirmTextSource({ dialect: 'template' } as never)).toBeUndefined();
  });
});

const ROWS = [{ id: 'r1', name: 'Acme' }, { id: 'r2', name: 'Globex' }];

function openConfirm(confirmText: BulkActionDef['confirmText']) {
  cleanup();
  const def: BulkActionDef = {
    name: 'archive',
    label: 'Archive',
    operation: 'update',
    patch: { archived: true },
    ...(confirmText !== undefined && { confirmText }),
  };
  render(
    <BulkActionDialog
      def={def}
      rows={ROWS}
      resource="account"
      dataSource={{ update: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) } as any}
      open
      onClose={() => {}}
    />,
  );
}

describe('BulkActionDialog renders confirmText through the reader (objectui#13183)', () => {
  it("renders an envelope's source, never [object Object]", async () => {
    openConfirm({ dialect: 'template', source: 'Archive {{ count }} account(s)?' });
    expect(await screen.findByText('Archive {{ count }} account(s)?')).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
  });

  it('renders a plain string unchanged', async () => {
    openConfirm('Archive these accounts?');
    expect(await screen.findByText('Archive these accounts?')).toBeInTheDocument();
  });

  it('keeps the default sentence when the slot is absent', async () => {
    openConfirm(undefined);
    expect(await screen.findByText(/This will apply to 2 record/)).toBeInTheDocument();
  });

  it('keeps the default sentence when the slot is blank', async () => {
    openConfirm({ dialect: 'template', source: ' ' });
    expect(await screen.findByText(/This will apply to 2 record/)).toBeInTheDocument();
  });
});
