/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The temporary-password CSV an identity import hands out starts with the
 * UTF-8 byte-order mark (objectstack#34420).
 *
 * Excel reads a CSV with no mark in the system code page, so an identity with
 * a Chinese (or any non-ASCII) name opens garbled. The file is built in the
 * browser, so the mark is this writer's to put there. The pin reads the
 * downloaded Blob's BYTES, not `text()`, because the mark is a byte-level fact
 * a decoder may hide.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import type { ImportRecordsResult } from '@object-ui/types';
import { IdentityImportResultExtra } from '../IdentityImportPanels';

let blobs: Blob[];

beforeEach(() => {
  blobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    blobs.push(blob as Blob);
    return 'blob:objectstack-34420';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('IdentityImportResultExtra password CSV — UTF-8 byte-order mark (objectstack#34420)', () => {
  it('the downloaded file starts with EF BB BF, once, and the non-ASCII identity follows intact', async () => {
    const serverResult = {
      results: [{ row: 1, identity: '张三', temporaryPassword: 'Tmp-pass-1' }],
    } as unknown as ImportRecordsResult;
    render(<IdentityImportResultExtra serverResult={serverResult} />);
    fireEvent.click(screen.getByTestId('identity-import-passwords-download'));
    expect(blobs.length, 'CONTROL: the download produced a file').toBe(1);

    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3)), 'the file opens with the bytes EF BB BF').toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.slice(3));
    expect(body.charCodeAt(0), 'exactly one mark: no second one follows').not.toBe(0xfeff);
    expect(body, 'CONTROL: the header row and the entry follow the mark')
      .toBe('row,identity,temporary_password\n1,张三,Tmp-pass-1');
  });
});
