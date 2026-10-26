/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12339 — a file the reader may not open arrives as the platform's
 * refused marker `{ id, metadataRefused: true }` (`FileRefusedValueSchema`,
 * objectstack#22593) and must render as a RESTRICTED state, not a generic
 * file chip.
 *
 * Before this card `readFileValue` took the marker through its ordinary object
 * arm: it kept the id, derived the URL, fell back to the name `File` and
 * dropped `metadataRefused`, so every renderer drew an ordinary-looking file
 * named `File` and the refusal never reached the screen.
 *
 * What is pinned, on REAL renders of the shipping components:
 *
 *  - each named renderer (the `file` grid cell `FileCellRenderer`, the
 *    `FileField` read-only list, the line-item `FileCell`, `ImageField`, the
 *    `image` / `avatar` grid cell `ImageCellRenderer`, and `AvatarField`)
 *    draws the restricted state for the marker, and no `<img>` for it — no
 *    MIME type was served, so no thumbnail is attempted;
 *  - where the renderer offers an open affordance, it stays a link to the
 *    id-derived endpoint: the download door decides on its own;
 *  - a normal file value renders exactly as before (no restricted mark);
 *  - an editable widget re-submitting the field's other values sends the
 *    marker back as its bare id, never as the marker object.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { UploadProvider, type UploadAdapter, type UploadResult } from '@object-ui/providers';
import { FileRefusedValueSchema } from '@objectstack/spec/data';

import { getCellRenderer, readFileValue } from '../index';
import { FileField, FileCell } from '../widgets/FileField';
import { ImageField } from '../widgets/ImageField';
import { AvatarField } from '../widgets/AvatarField';

const REFUSED_ID = 'kR3mQ8xf_2Tb-9Lw';
const REFUSED = { id: REFUSED_ID, metadataRefused: true as const };
const REFUSED_URL = `/api/v1/storage/files/${REFUSED_ID}`;

const EXPANDED = {
  id: 'f_1928',
  name: 'att-1928.txt',
  size: 56,
  mimeType: 'text/plain',
  url: '/api/v1/storage/files/f_1928',
};
const EXPANDED_IMAGE = {
  id: 'f_2001',
  name: 'cover.png',
  size: 900,
  mimeType: 'image/png',
  url: '/api/v1/storage/files/f_2001',
};

const LABEL = (en as any).fields.file.restricted as string;
const FALLBACK = (en as any).fields.file.fileFallback as string;

const restrictedMarks = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('[data-slot="file-restricted"]'));
const imgs = (c: HTMLElement) => Array.from(c.querySelectorAll('img'));

function inI18n(node: React.ReactNode, language = 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>{node}</I18nProvider>,
  );
}

function renderCell(type: string, value: unknown, field: any = { name: 'f', type, multiple: true }) {
  const Cell = getCellRenderer(type);
  return inI18n(<Cell value={value} field={field} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#12339 — the view carries the refusal', () => {
  it('the fixture IS the spec marker (control: the closed schema accepts it)', () => {
    expect(FileRefusedValueSchema.safeParse(REFUSED).success).toBe(true);
  });

  it('readFileValue flags the marker, keeps the id-derived URL, and sets no mimeType', () => {
    const v = readFileValue(REFUSED, FALLBACK);
    expect(v.metadataRefused).toBe(true);
    expect(v.id).toBe(REFUSED_ID);
    expect(v.url).toBe(REFUSED_URL);
    expect(v.mimeType).toBeUndefined();
  });

  it('a normal expanded value is unchanged and carries no flag', () => {
    const v = readFileValue(EXPANDED, FALLBACK);
    expect('metadataRefused' in v).toBe(false);
    expect(v).toMatchObject({ id: EXPANDED.id, name: EXPANDED.name, url: EXPANDED.url });
  });

  it('an object with any other key is not the marker (the schema is closed)', () => {
    expect(readFileValue({ ...REFUSED, name: 'x.pdf' }).metadataRefused).toBeUndefined();
    expect(readFileValue({ id: REFUSED_ID, metadataRefused: false }).metadataRefused).toBeUndefined();
  });
});

describe('objectui#12339 — `file` grid cell (FileCellRenderer)', () => {
  it('the marker draws the restricted state, linked to the id-derived endpoint', () => {
    const { container } = renderCell('file', [REFUSED]);
    const link = within(container).getByRole('link', { name: LABEL });
    expect(link).toHaveAttribute('href', REFUSED_URL);
    expect(link).toHaveAttribute('data-slot', 'file-restricted');
    expect(container.textContent).not.toContain(FALLBACK);
  });

  it('single (non-array) value too', () => {
    const { container } = renderCell('file', REFUSED, { name: 'f', type: 'file' });
    expect(within(container).getByRole('link', { name: LABEL })).toHaveAttribute('href', REFUSED_URL);
  });

  it('a normal file beside it is unchanged', () => {
    const { container } = renderCell('file', [EXPANDED, REFUSED]);
    expect(within(container).getByRole('link', { name: EXPANDED.name })).toHaveAttribute('href', EXPANDED.url);
    expect(restrictedMarks(container)).toHaveLength(1);
  });

  it('a normal file alone renders no restricted mark', () => {
    const { container } = renderCell('file', [EXPANDED]);
    expect(restrictedMarks(container)).toHaveLength(0);
  });

  it('the label comes off the i18n channel', () => {
    const Cell = getCellRenderer('file');
    const { container } = inI18n(<Cell value={[REFUSED]} field={{ name: 'f', type: 'file' } as any} />, 'zh');
    within(container).getByRole('link', { name: (zh as any).fields.file.restricted });
  });
});

describe('objectui#12339 — FileField read-only list and FileCell', () => {
  it('FileField readonly: restricted link, no image, normal file unchanged', () => {
    const { container } = inI18n(
      <FileField
        field={{ name: 'a', type: 'file', multiple: true } as any}
        value={[EXPANDED, REFUSED]}
        onChange={() => {}}
        readonly
      />,
    );
    expect(within(container).getByRole('link', { name: LABEL })).toHaveAttribute('href', REFUSED_URL);
    expect(within(container).getByRole('link', { name: EXPANDED.name })).toHaveAttribute('href', EXPANDED.url);
    expect(restrictedMarks(container)).toHaveLength(1);
    expect(imgs(container)).toHaveLength(0);
  });

  it('FileCell: the restricted chip draws no thumbnail and names itself by the label', () => {
    const { container } = inI18n(
      <FileCell value={[REFUSED, EXPANDED_IMAGE]} onChange={() => {}} multiple disabled />,
    );
    const chips = within(container).getAllByTestId('file-cell-chip');
    expect(chips).toHaveLength(2);
    expect(within(chips[0]).getByRole('link', { name: LABEL })).toHaveAttribute('href', REFUSED_URL);
    expect(chips[0].querySelector('img')).toBeNull();
    // Control: the normal image chip still draws its thumbnail.
    expect(chips[1].querySelector('img')).toHaveAttribute('src', EXPANDED_IMAGE.url);
  });
});

describe('objectui#12339 — image renderers', () => {
  it('`image` grid cell: the marker draws a restricted mark and no <img>', () => {
    const { container } = renderCell('image', [REFUSED]);
    expect(imgs(container)).toHaveLength(0);
    expect(within(container).getByRole('link', { name: LABEL })).toHaveAttribute('href', REFUSED_URL);
  });

  it('`avatar` grid cell rides the same renderer', () => {
    const { container } = renderCell('avatar', REFUSED, { name: 'f', type: 'avatar' });
    expect(imgs(container)).toHaveLength(0);
    expect(restrictedMarks(container)).toHaveLength(1);
  });

  it('`image` grid cell: a normal image beside it keeps its thumbnail', () => {
    const { container } = renderCell('image', [EXPANDED_IMAGE, REFUSED]);
    expect(imgs(container).map((i) => i.getAttribute('src'))).toEqual([EXPANDED_IMAGE.url]);
    expect(restrictedMarks(container)).toHaveLength(1);
  });

  it('`image` grid cell: a normal image alone is unchanged', () => {
    const { container } = renderCell('image', [EXPANDED_IMAGE]);
    expect(imgs(container)).toHaveLength(1);
    expect(restrictedMarks(container)).toHaveLength(0);
  });

  it('ImageField readonly: restricted tile instead of a thumbnail; normal image unchanged', () => {
    const { container } = inI18n(
      <ImageField
        field={{ name: 'i', type: 'image', multiple: true } as any}
        value={[REFUSED, EXPANDED_IMAGE]}
        onChange={() => {}}
        readonly
      />,
    );
    expect(imgs(container).map((i) => i.getAttribute('src'))).toEqual([EXPANDED_IMAGE.url]);
    expect(within(container).getByRole('link', { name: LABEL })).toHaveAttribute('href', REFUSED_URL);
  });

  it('ImageField readonly: the marker alone is not "No value"', () => {
    const { container } = inI18n(
      <ImageField field={{ name: 'i', type: 'image' } as any} value={REFUSED} onChange={() => {}} readonly />,
    );
    expect(restrictedMarks(container)).toHaveLength(1);
    expect(imgs(container)).toHaveLength(0);
  });

  it('ImageField editable: restricted tile, no thumbnail, no crop button for it', () => {
    const { container } = inI18n(
      <ImageField field={{ name: 'i', type: 'image', multiple: true } as any} value={[REFUSED]} onChange={() => {}} />,
    );
    expect(imgs(container)).toHaveLength(0);
    expect(restrictedMarks(container)).toHaveLength(1);
    expect(container.querySelector('[data-testid="image-field-crop-0"]')).toBeNull();
  });

  it('AvatarField readonly: a lock named by the label replaces the initials; normal avatar keeps them', () => {
    const restricted = inI18n(
      <AvatarField field={{ name: 'av', type: 'avatar', label: 'Jane Doe' } as any} value={REFUSED as any} onChange={() => {}} readonly />,
    );
    within(restricted.container).getByRole('img', { name: LABEL });
    expect(restricted.container.textContent).not.toContain('JD');
    cleanup();
    const normal = inI18n(
      <AvatarField field={{ name: 'av', type: 'avatar', label: 'Jane Doe' } as any} value={EXPANDED_IMAGE.id} onChange={() => {}} readonly />,
    );
    expect(restrictedMarks(normal.container)).toHaveLength(0);
    expect(normal.container.textContent).toContain('JD');
  });
});

describe('objectui#12339 — the editable widgets re-submit the bare id, never the marker', () => {
  const MINTED_ID = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
  function spyAdapter() {
    const upload = vi.fn(
      async (f: File | Blob): Promise<UploadResult> => ({
        url: `https://cdn.example/${(f as File).name}`,
        name: (f as File).name,
        size: f.size,
        mimeType: f.type || 'application/pdf',
        meta: { fileId: MINTED_ID },
      }),
    );
    const adapter: UploadAdapter = { name: 'spy', upload };
    return adapter;
  }
  const fileInput = (c: HTMLElement) => c.querySelector('input[type="file"]') as HTMLInputElement;

  it('FileField append: [marker] + upload ⇒ [bare id, new id]', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <UploadProvider adapter={spyAdapter()}>
        <FileField field={{ name: 'a', type: 'file', multiple: true } as any} value={[REFUSED]} onChange={onChange} />
      </UploadProvider>,
    );
    fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'n.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).toEqual([REFUSED_ID, MINTED_ID]);
  });

  it('FileCell remove: removing a sibling sends the marker back as its bare id', () => {
    const onChange = vi.fn();
    const { container } = inI18n(<FileCell value={[REFUSED, EXPANDED]} onChange={onChange} multiple />);
    const remove = within(container).getByRole('button', { name: `Remove ${EXPANDED.name}` });
    fireEvent.click(remove);
    expect(onChange).toHaveBeenCalledWith([REFUSED_ID]);
  });

  it('ImageField append: [marker] + upload ⇒ [bare id, new id]', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <UploadProvider adapter={spyAdapter()}>
        <ImageField field={{ name: 'i', type: 'image', multiple: true } as any} value={[REFUSED]} onChange={onChange} />
      </UploadProvider>,
    );
    fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).toEqual([REFUSED_ID, MINTED_ID]);
  });
});
