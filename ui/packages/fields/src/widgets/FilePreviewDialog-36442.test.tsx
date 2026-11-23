/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36442 — the in-page file preview (decision objectstack#34781,
 * option A): images, PDF, plain text and CSV preview in the page; Word, Excel,
 * PowerPoint and HTML are download only; past a size limit the dialog says
 * "too large"; a refusal reads as the download's refusal; SVG is only ever an
 * `img`; HTML never reaches an `iframe` and never becomes markup.
 *
 * These pins read the rendered dialog: which view mounted (`data-preview-state`),
 * which element carries the file, and which requests went out.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { FilePreviewDialog, filePreviewKind, type FilePreviewDialogProps, type FilePreviewItem } from './FilePreviewDialog';
import { FileValueAffordance } from './file-affordance';
import { readFileValue } from './file-value';

const MB = 1024 * 1024;

function renderDialog(props: Partial<FilePreviewDialogProps> & { files: FilePreviewItem[] }) {
  const onOpenChange = vi.fn();
  const utils = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <FilePreviewDialog index={0} open onOpenChange={onOpenChange} {...props} />
    </I18nProvider>,
  );
  return { ...utils, onOpenChange };
}

/** The view the dialog mounted, by the slot it marks. */
async function viewOf(): Promise<string | null> {
  const dialog = await screen.findByTestId('file-preview-dialog');
  await waitFor(() => expect(dialog.querySelector('[data-preview-state]')).not.toBeNull());
  return dialog.querySelector('[data-preview-state]')!.getAttribute('data-preview-state');
}

/** The PDF view's frame, if one mounted. */
function frameOf(): HTMLIFrameElement | null {
  return screen.getByTestId('file-preview-dialog').querySelector('iframe');
}

function textResponse(body: BodyInit, init: ResponseInit = {}) {
  return new Response(body, { status: 200, ...init });
}

/** What the stable storage endpoint answers a grant with: a redirect, not followed. */
const REDIRECT = { type: 'opaqueredirect', status: 0, ok: false, body: null } as unknown as Response;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('filePreviewKind — which view a file gets (objectstack#36442)', () => {
  it.each([
    [{ name: 'a.png', mimeType: 'image/png' }, 'image'],
    [{ name: 'a.jpg', mimeType: 'image/jpeg' }, 'image'],
    [{ name: 'a.gif', mimeType: 'image/gif' }, 'image'],
    [{ name: 'a.webp', mimeType: 'image/webp' }, 'image'],
    [{ name: 'logo.svg', mimeType: 'image/svg+xml' }, 'image'],
    [{ name: 'a.pdf', mimeType: 'application/pdf' }, 'pdf'],
    [{ name: 'notes.txt', mimeType: 'text/plain; charset=utf-8' }, 'text'],
    [{ name: 'data.csv', mimeType: 'text/csv' }, 'csv'],
    [{ name: 'data.csv', mimeType: 'application/vnd.ms-excel' }, 'csv'],
    [{ name: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, 'unsupported'],
    [{ name: 'sheet.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, 'unsupported'],
    [{ name: 'deck.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }, 'unsupported'],
    [{ name: 'old.doc', mimeType: 'application/msword' }, 'unsupported'],
    [{ name: 'page.html', mimeType: 'text/html' }, 'unsupported'],
    // A declared HTML type wins over a harmless-looking name, and the name wins
    // over a declared plain-text type: neither is ever drawn or framed.
    [{ name: 'page.pdf', mimeType: 'text/html' }, 'unsupported'],
    [{ name: 'page.html', mimeType: 'text/plain' }, 'unsupported'],
    // A PDF name with a non-PDF declared type is not framed.
    [{ name: 'a.pdf', mimeType: 'application/octet-stream' }, 'unsupported'],
    // The name decides only when no type is declared.
    [{ name: 'a.pdf' }, 'pdf'],
    [{ name: 'a.PNG' }, 'image'],
    [{ name: 'File' }, 'unsupported'],
  ] as Array<[FilePreviewItem, string]>)('%o → %s', (file, kind) => {
    expect(filePreviewKind(file)).toBe(kind);
  });
});

describe('FilePreviewDialog — the four views (objectstack#36442)', () => {
  it('draws an image through an img element, from the resolved link', async () => {
    renderDialog({ files: [{ name: 'a.png', mimeType: 'image/png' }], resolveUrl: async () => 'https://store.example/a.png?sig=1' });
    expect(await viewOf()).toBe('image');
    const img = screen.getByRole('img', { name: 'a.png' }) as HTMLImageElement;
    expect(img.src).toBe('https://store.example/a.png?sig=1');
  });

  it('draws an SVG only through an img element: no inline svg, no iframe, no object', async () => {
    const fetchSpy = vi.fn();
    renderDialog({
      files: [{ name: 'logo.svg', mimeType: 'image/svg+xml' }],
      resolveUrl: async () => 'https://store.example/logo.svg',
      fetchImpl: fetchSpy,
    });
    expect(await viewOf()).toBe('image');
    const dialog = screen.getByTestId('file-preview-dialog');
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://store.example/logo.svg');
    expect(dialog.querySelector('iframe, object, embed')).toBeNull();
    // The dialog's own icons are lucide `svg`s; none carries the file.
    dialog.querySelectorAll('svg').forEach((svg) => expect(svg.getAttribute('aria-hidden')).toBe('true'));
    // The bytes are never fetched into the page.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('frames a PDF on the desktop', async () => {
    renderDialog({ files: [{ name: 'contract.pdf', mimeType: 'application/pdf' }], resolveUrl: async () => '/api/v1/storage/_local/raw/tok' });
    expect(await viewOf()).toBe('pdf');
    const frame = frameOf()!;
    expect(frame.getAttribute('title')).toBe('contract.pdf');
    expect(frame.getAttribute('src')).toBe('/api/v1/storage/_local/raw/tok');
  });

  it('on a phone, a PDF is offered in a new tab (the system viewer), never framed', async () => {
    vi.stubGlobal('innerWidth', 375);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderDialog({ files: [{ name: 'contract.pdf', mimeType: 'application/pdf' }], resolveUrl: async () => 'https://store.example/c.pdf' });
    expect(await viewOf()).toBe('pdf-outside');
    expect(screen.getByTestId('file-preview-dialog').querySelector('iframe')).toBeNull();
    const view = screen.getByTestId('file-preview-dialog').querySelector('[data-preview-state="pdf-outside"]') as HTMLElement;
    fireEvent.click(within(view).getByRole('button', { name: 'Open in new tab' }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://store.example/c.pdf', '_blank', 'noopener,noreferrer'));
  });

  it('on a phone, an image and a text file still preview in the page', async () => {
    vi.stubGlobal('innerWidth', 375);
    const fetchImpl = vi.fn(async () => textResponse('hello'));
    renderDialog({
      files: [{ name: 'a.png', mimeType: 'image/png' }, { name: 'n.txt', mimeType: 'text/plain' }],
      resolveUrl: async (f) => `https://store.example/${f.name}`,
      fetchImpl,
    });
    expect(await viewOf()).toBe('image');
  });

  it('reads plain text through the resolved link and draws it as text, not markup', async () => {
    const fetchImpl = vi.fn(async () => textResponse('line one\n<script>window.__x = 1</script>\n<b>bold</b>'));
    renderDialog({ files: [{ name: 'notes.txt', mimeType: 'text/plain' }], resolveUrl: async () => 'https://store.example/notes.txt', fetchImpl });
    expect(await viewOf()).toBe('text');
    expect(fetchImpl).toHaveBeenCalledWith('https://store.example/notes.txt', expect.anything());
    const dialog = screen.getByTestId('file-preview-dialog');
    expect(dialog.querySelector('pre')?.textContent).toContain('<script>window.__x = 1</script>');
    expect(dialog.querySelector('script, b')).toBeNull();
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });

  it('reads a GBK CSV with the import wizard\'s decoder and draws a table', async () => {
    // 「姓名,城市\n张三,北京\n」 in GBK, as zh-CN Excel saves a CSV.
    const gbk = new Uint8Array([208, 213, 195, 251, 44, 179, 199, 202, 208, 10, 213, 197, 200, 253, 44, 177, 177, 190, 169, 10]);
    const fetchImpl = vi.fn(async () => textResponse(gbk));
    renderDialog({ files: [{ name: 'people.csv', mimeType: 'text/csv' }], resolveUrl: async () => 'https://store.example/p.csv', fetchImpl });
    expect(await viewOf()).toBe('csv');
    expect(screen.getByRole('columnheader', { name: '姓名' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '北京' })).toBeInTheDocument();
  });

  it('shows the first 1000 rows of a long CSV and says so', async () => {
    const csv = ['id,name', ...Array.from({ length: 1500 }, (_, i) => `${i},n${i}`)].join('\n');
    const fetchImpl = vi.fn(async () => textResponse(csv));
    renderDialog({ files: [{ name: 'big.csv', mimeType: 'text/csv' }], resolveUrl: async () => 'https://store.example/b.csv', fetchImpl });
    expect(await viewOf()).toBe('csv');
    expect(screen.getByText('Showing the first 1000 rows.')).toBeInTheDocument();
    // Header row + 1000 data rows.
    expect(screen.getAllByRole('row')).toHaveLength(1001);
  });
});

describe('FilePreviewDialog — download only, and too large (objectstack#36442)', () => {
  it.each([
    ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['page.html', 'text/html'],
  ])('%s offers the download only: nothing is resolved, fetched or framed', async (name, mimeType) => {
    const resolveUrl = vi.fn(async () => 'https://store.example/x');
    const fetchImpl = vi.fn();
    const onDownload = vi.fn();
    renderDialog({ files: [{ name, mimeType }], resolveUrl, fetchImpl, onDownload });
    expect(await viewOf()).toBe('unsupported');
    expect(screen.getByText('This file type cannot be previewed. Please download it.')).toBeInTheDocument();
    const dialog = screen.getByTestId('file-preview-dialog');
    expect(dialog.querySelector('iframe, img, pre, table')).toBeNull();
    expect(resolveUrl).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    const view = dialog.querySelector('[data-preview-state="unsupported"]') as HTMLElement;
    fireEvent.click(within(view).getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalledWith(expect.objectContaining({ name }), 0);
  });

  it.each([
    ['photo.png', 'image/png', 20 * MB + 1],
    ['scan.pdf', 'application/pdf', 20 * MB + 1],
    ['log.txt', 'text/plain', 2 * MB + 1],
    ['rows.csv', 'text/csv', 2 * MB + 1],
  ])('%s past its limit shows "too large" with a download, and nothing is read', async (name, mimeType, size) => {
    const resolveUrl = vi.fn(async () => 'https://store.example/x');
    const fetchImpl = vi.fn();
    const onDownload = vi.fn();
    renderDialog({ files: [{ name, mimeType, size }], resolveUrl, fetchImpl, onDownload });
    expect(await viewOf()).toBe('too-large');
    expect(screen.getByText('This file is too large to preview. Please download it.')).toBeInTheDocument();
    expect(resolveUrl).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    const view = screen.getByTestId('file-preview-dialog').querySelector('[data-preview-state="too-large"]') as HTMLElement;
    fireEvent.click(within(view).getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: at exactly its limit a file still previews', async () => {
    renderDialog({ files: [{ name: 'photo.png', mimeType: 'image/png', size: 20 * MB }], resolveUrl: async () => 'https://store.example/p.png' });
    expect(await viewOf()).toBe('image');
  });

  it('a text file whose size was not declared is judged on the bytes it answers', async () => {
    const fetchImpl = vi.fn(async () => textResponse(new Uint8Array(2 * MB + 10)));
    renderDialog({ files: [{ name: 'huge.txt', mimeType: 'text/plain' }], resolveUrl: async () => 'https://store.example/h.txt', fetchImpl });
    expect(await viewOf()).toBe('too-large');
  });
});

describe('FilePreviewDialog — the refusal is the download\'s refusal (objectstack#36442)', () => {
  it('a resolveUrl rejection is shown with its own message, for every view', async () => {
    const resolveUrl = vi.fn(async () => {
      throw new Error("You don't have access to download this attachment.");
    });
    renderDialog({ files: [{ name: 'a.pdf', mimeType: 'application/pdf' }], resolveUrl });
    expect(await viewOf()).toBe('error');
    expect(screen.getByRole('alert')).toHaveTextContent("You don't have access to download this attachment.");
    expect(screen.getByTestId('file-preview-dialog').querySelector('iframe')).toBeNull();
  });

  it('by default, the stable storage endpoint is asked without following its redirect; a 403 is refused', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: false, error: { code: 'FILE_DOWNLOAD_DENIED' } }), { status: 403 }));
    renderDialog({ files: [{ name: 'a.png', mimeType: 'image/png', url: '/api/v1/storage/files/f1' }], fetchImpl });
    expect(await viewOf()).toBe('error');
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this file.');
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/storage/files/f1', expect.objectContaining({ redirect: 'manual' }));
    expect(screen.getByTestId('file-preview-dialog').querySelector('img')).toBeNull();
  });

  it('CONTROL: by default, a redirect (a grant) previews the stable URL itself', async () => {
    const fetchImpl = vi.fn(async () => REDIRECT);
    renderDialog({ files: [{ name: 'a.png', mimeType: 'image/png', url: '/api/v1/storage/files/f1' }], fetchImpl });
    expect(await viewOf()).toBe('image');
    expect((screen.getByRole('img', { name: 'a.png' }) as HTMLImageElement).getAttribute('src')).toBe('/api/v1/storage/files/f1');
  });

  it('a 403 on the text read is the same refusal', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 }));
    renderDialog({ files: [{ name: 'n.txt', mimeType: 'text/plain' }], resolveUrl: async () => 'https://store.example/n.txt', fetchImpl });
    expect(await viewOf()).toBe('error');
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this file.');
  });

  it('a read the browser blocks (a bucket without CORS) offers the new tab', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderDialog({ files: [{ name: 'p.csv', mimeType: 'text/csv' }], resolveUrl: async () => 'https://bucket.example/p.csv?sig=1', fetchImpl });
    expect(await viewOf()).toBe('blocked');
    const view = screen.getByTestId('file-preview-dialog').querySelector('[data-preview-state="blocked"]') as HTMLElement;
    fireEvent.click(within(view).getByRole('button', { name: 'Open in new tab' }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://bucket.example/p.csv?sig=1', '_blank', 'noopener,noreferrer'));
  });
});

describe('FilePreviewDialog — previous, next, download, new tab (objectstack#36442)', () => {
  const files: FilePreviewItem[] = [
    { id: 'f1', name: 'a.png', mimeType: 'image/png' },
    { id: 'f2', name: 'b.pdf', mimeType: 'application/pdf' },
    { id: 'f3', name: 'c.docx', mimeType: 'application/msword' },
  ];

  it('previous and next walk the set and wrap; the arrow keys do the same', () => {
    const onIndexChange = vi.fn();
    renderDialog({ files, index: 0, onIndexChange, resolveUrl: async (f) => `https://s/${f.id}` });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Previous file' }));
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(screen.getByTestId('file-preview-dialog'), { key: 'ArrowRight' });
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
  });

  it('each file gets its own view and its own link as the index moves', async () => {
    const resolveUrl = vi.fn(async (f: FilePreviewItem) => `https://s/${f.id}`);
    const { rerender } = renderDialog({ files, index: 0, resolveUrl });
    expect(await viewOf()).toBe('image');
    rerender(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <FilePreviewDialog files={files} index={1} open onOpenChange={() => {}} resolveUrl={resolveUrl} />
      </I18nProvider>,
    );
    await waitFor(() => expect(frameOf()?.getAttribute('src')).toBe('https://s/f2'));
    expect(screen.getByTestId('file-preview-dialog').querySelector('img')).toBeNull();
  });

  it('a single file draws no previous / next', () => {
    renderDialog({ files: [files[0]!], resolveUrl: async () => 'https://s/f1' });
    expect(screen.queryByRole('button', { name: 'Next file' })).toBeNull();
    expect(screen.queryByText('1 / 1')).toBeNull();
  });

  it('the header download hands the file to onDownload; the new tab opens the resolved link', async () => {
    const onDownload = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderDialog({ files, index: 1, onDownload, resolveUrl: async (f) => `https://s/${f.id}` });
    const header = screen.getByTestId('file-preview-dialog');
    fireEvent.click(within(header).getAllByRole('button', { name: 'Download' })[0]!);
    expect(onDownload).toHaveBeenCalledWith(files[1], 1);
    fireEvent.click(within(header).getAllByRole('button', { name: 'Open in new tab' })[0]!);
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://s/f2', '_blank', 'noopener,noreferrer'));
  });
});

describe('FileValueAffordance — a file field opens the preview (objectstack#36442)', () => {
  function renderAffordance(value: unknown) {
    return render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <div data-testid="row" onClick={rowClick}>
          <FileValueAffordance view={readFileValue(value)} fallback={<span>none</span>} />
        </div>
      </I18nProvider>,
    );
  }
  const rowClick = vi.fn();

  it('a plain click opens the dialog in the page, on the same link the download uses', async () => {
    rowClick.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => REDIRECT));
    renderAffordance({ id: 'f9', name: 'scan.pdf', mimeType: 'application/pdf', url: '/api/v1/storage/files/f9' });
    const link = screen.getByRole('link', { name: 'scan.pdf' });
    expect(link.getAttribute('href')).toBe('/api/v1/storage/files/f9');
    fireEvent.click(link);
    expect(await viewOf()).toBe('pdf');
    expect(frameOf()?.getAttribute('src')).toBe('/api/v1/storage/files/f9');
    expect(rowClick).not.toHaveBeenCalled();
    // A click inside the dialog does not reach the row behind it either.
    fireEvent.click(screen.getAllByRole('button', { name: 'Download' })[0]!);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('a modified click keeps the browser\'s own new tab and opens no dialog', () => {
    renderAffordance({ id: 'f9', name: 'scan.pdf', mimeType: 'application/pdf', url: '/api/v1/storage/files/f9' });
    fireEvent.click(screen.getByRole('link', { name: 'scan.pdf' }), { ctrlKey: true });
    expect(screen.queryByTestId('file-preview-dialog')).toBeNull();
  });

  it('a field file the reader may not download gets the refusal in the preview', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    renderAffordance({ id: 'f9', name: 'scan.png', mimeType: 'image/png', url: '/api/v1/storage/files/f9' });
    fireEvent.click(screen.getByRole('link', { name: 'scan.png' }));
    expect(await viewOf()).toBe('error');
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this file.');
  });

  it('a Word file from a field offers the download only', async () => {
    renderAffordance({ id: 'f9', name: 'memo.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', url: '/api/v1/storage/files/f9' });
    fireEvent.click(screen.getByRole('link', { name: 'memo.docx' }));
    expect(await viewOf()).toBe('unsupported');
  });
});
