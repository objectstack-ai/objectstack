/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The console's in-page file preview: one dialog for a record's attachments
 * and for a file field's value (decision objectstack#34781, option A).
 *
 * Four views and nothing else, with no new dependency:
 *   - image (PNG, JPEG, GIF, WebP, and SVG): the lightbox's own `img` element.
 *     ⛔ An SVG is never inlined: an `img` element runs no script.
 *   - PDF: an `iframe` on the browser's own viewer. On a phone the dialog
 *     offers the new tab instead, which hands the file to the system viewer.
 *   - plain text: the bytes decoded and drawn as text.
 *   - CSV: the same GBK-aware decode and delimited parser the grid's import
 *     wizard reads with (`delimitedText.ts`), drawn as a table.
 * Every other type, Word, Excel, PowerPoint and HTML included, is the
 * "unsupported, please download" state. ⛔ An `iframe` is only ever pointed at
 * a file judged PDF, never at HTML or SVG.
 *
 * Past a size limit (images and PDF 20 MB; text and CSV 2 MB) the dialog draws
 * "too large, please download"; text and CSV show their first 1000 lines.
 *
 * The preview reads the file through the SAME door as the download: the
 * caller's `resolveUrl` (the attachments panel mints the signed link exactly as
 * its download does) or, by default, the file's own URL — the stable storage
 * endpoint, probed without following its redirect so a refusal reads as the
 * download's refusal. When the browser cannot read a file in the page (a
 * bucket on another origin without the CORS rule the preview needs), the
 * dialog offers the new tab instead.
 */

import * as React from 'react';
import {
  Button,
  cn,
  Dialog,
  DialogDescription,
  DialogTitle,
  MobileDialogContent,
  useIsMobile,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, ExternalLink, FileX, Loader2 } from 'lucide-react';
import { LightboxImageView } from './ImageLightbox.js';
import { decodeSpreadsheetText, parseDelimited } from './delimitedText.js';

/** One file the dialog can show. A `FileValueView` satisfies it as it is. */
export interface FilePreviewItem {
  /**
   * The file's stable identity (a `sys_file` id). With `url`, it is what the
   * dialog remembers a resolved link by, so pass it when there is no `url`.
   */
  id?: string;
  /** Display name; its extension decides the view when no MIME type is known. */
  name: string;
  /** Where the bytes are. Optional when the caller passes `resolveUrl`. */
  url?: string;
  /** Declared MIME type; decides the view when present. */
  mimeType?: string;
  /** Size in bytes, when known: a file past its limit is never fetched. */
  size?: number;
}

export interface FilePreviewDialogProps {
  files: FilePreviewItem[];
  /** Index of the file shown. Controlled, like `ImageLightbox`. */
  index: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called on previous / next (buttons and arrow keys). Without it the set does not move. */
  onIndexChange?: (index: number) => void;
  /**
   * The link the preview reads, minted by the same check as the download.
   * A rejection is the refusal: its `message` is shown as it is, so pass the
   * copy the download would have shown. Default: the file's own `url`.
   */
  resolveUrl?: (file: FilePreviewItem, index: number) => Promise<string>;
  /** The download. Default: a link to the resolved URL with `download` set. */
  onDownload?: (file: FilePreviewItem, index: number) => void;
  /** The fetch used to read text and CSV, and to probe the default URL. */
  fetchImpl?: typeof fetch;
}

type PreviewKind = 'image' | 'pdf' | 'text' | 'csv' | 'unsupported';

const MB = 1024 * 1024;
const MEDIA_LIMIT_BYTES = 20 * MB;
const TEXT_LIMIT_BYTES = 2 * MB;
const TEXT_ROW_LIMIT = 1000;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const CSV_TYPES = new Set(['text/csv', 'application/csv', 'text/x-csv', 'text/comma-separated-values']);
/** Types a `.csv` file is commonly uploaded under besides its own. */
const CSV_LOOSE_TYPES = new Set(['', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream']);
const TEXT_EXTENSIONS = new Set(['txt', 'log']);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** A MIME type's essence: lower case, parameters dropped. */
function essenceOf(mimeType?: string): string {
  return (mimeType ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * The view a file gets. The declared type decides; the extension only fills
 * in where no type is declared, except for the text views, which draw bytes as
 * text and so cannot execute anything whatever the bytes are.
 *
 * ⛔ HTML is unsupported, never text and never framed. ⛔ PDF needs a PDF
 * signal: the declared type, or the extension when nothing is declared — the
 * `iframe` is the one view that hands bytes to the browser to interpret.
 */
export function filePreviewKind(file: FilePreviewItem): PreviewKind {
  const type = essenceOf(file.mimeType);
  const ext = extensionOf(file.name);
  if (type === 'text/html' || type === 'application/xhtml+xml' || ext === 'html' || ext === 'htm') return 'unsupported';
  if (CSV_TYPES.has(type) || (ext === 'csv' && CSV_LOOSE_TYPES.has(type))) return 'csv';
  if (type === 'text/plain' || (!type && TEXT_EXTENSIONS.has(ext))) return 'text';
  if (IMAGE_TYPES.has(type) || (!type && IMAGE_EXTENSIONS.has(ext))) return 'image';
  if (type === 'application/pdf' || (!type && ext === 'pdf')) return 'pdf';
  return 'unsupported';
}

function limitFor(kind: PreviewKind): number {
  return kind === 'text' || kind === 'csv' ? TEXT_LIMIT_BYTES : MEDIA_LIMIT_BYTES;
}

type BodyState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; text?: string; rows?: string[][]; truncated?: boolean }
  /** Refused or failed: the message says which. */
  | { status: 'error'; message: string }
  /** The browser could not read the bytes in the page (cross-origin without CORS). */
  | { status: 'blocked' }
  | { status: 'tooLarge' };

/** An error whose message is already the copy to show. */
class PreviewRefusal extends Error {}

/** What a file is remembered by: primitives, never the item object (ui/AGENTS.md #10). */
function fileKey(file: FilePreviewItem, index: number): string {
  return JSON.stringify([file.id ?? null, file.url ?? null, file.id || file.url ? null : index, file.name]);
}

function isSameOrigin(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Hook state for one dialog: resolves each file's URL once and remembers it,
 * so previous / next and the header's buttons never mint twice.
 */
function useResolver(
  resolveUrl: FilePreviewDialogProps['resolveUrl'],
  fetchImpl: typeof fetch,
  t: (key: string, params?: Record<string, unknown>) => string,
) {
  const cache = React.useRef(new Map<string, Promise<string>>());
  return React.useCallback(
    (file: FilePreviewItem, index: number): Promise<string> => {
      const key = fileKey(file, index);
      const hit = cache.current.get(key);
      if (hit) return hit;
      const run = (async () => {
        if (resolveUrl) return resolveUrl(file, index);
        const url = file.url?.trim();
        if (!url) throw new PreviewRefusal(t('fields.filePreview.loadFailed'));
        // The stable storage endpoint answers a refusal itself and a grant with
        // a redirect to the signed link: ask it without following, so the
        // answer is the download's answer and no byte moves twice.
        if (isSameOrigin(url)) {
          let res: Response | undefined;
          try {
            res = await fetchImpl(url, { redirect: 'manual', credentials: 'same-origin' });
          } catch {
            res = undefined; // Unreadable here; the view itself will say so.
          }
          if (res) {
            void res.body?.cancel().catch(() => undefined);
            if (res.status === 401 || res.status === 403) throw new PreviewRefusal(t('fields.filePreview.denied'));
            if (res.status >= 400) throw new PreviewRefusal(t('fields.filePreview.loadFailed'));
          }
        }
        return url;
      })();
      cache.current.set(key, run);
      // A failed resolution is not remembered: the next try asks again.
      run.catch(() => cache.current.delete(key));
      return run;
    },
    [resolveUrl, fetchImpl, t],
  );
}

/** Read a text or CSV file's bytes through the resolved link. */
async function readTextBody(
  url: string,
  kind: 'text' | 'csv',
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  t: (key: string, params?: Record<string, unknown>) => string,
): Promise<BodyState> {
  let res: Response;
  try {
    res = await fetchImpl(url, { credentials: 'same-origin', signal });
  } catch (err) {
    if (signal.aborted) throw err;
    return { status: 'blocked' };
  }
  if (res.status === 401 || res.status === 403) return { status: 'error', message: t('fields.filePreview.denied') };
  if (!res.ok) return { status: 'error', message: t('fields.filePreview.loadFailed') };
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > TEXT_LIMIT_BYTES) {
    void res.body?.cancel().catch(() => undefined);
    return { status: 'tooLarge' };
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > TEXT_LIMIT_BYTES) return { status: 'tooLarge' };
  const text = decodeSpreadsheetText(buffer);
  if (kind === 'csv') {
    const rows = parseDelimited(text, ',');
    // The header row plus the first 1000 data rows.
    return { status: 'ready', url, rows: rows.slice(0, TEXT_ROW_LIMIT + 1), truncated: rows.length > TEXT_ROW_LIMIT + 1 };
  }
  const lines = text.split(/\r?\n/);
  return {
    status: 'ready',
    url,
    text: lines.slice(0, TEXT_ROW_LIMIT).join('\n'),
    truncated: lines.length > TEXT_ROW_LIMIT,
  };
}

/**
 * A shared preview dialog for files: previous / next across `files`, download,
 * open in a new tab, and one of the four views — or the "too large" or
 * "unsupported" state, both of which offer the download.
 */
export function FilePreviewDialog({
  files,
  index,
  open,
  onOpenChange,
  onIndexChange,
  resolveUrl,
  onDownload,
  fetchImpl,
}: FilePreviewDialogProps) {
  const { t } = useObjectTranslation();
  const tr = t as (key: string, params?: Record<string, unknown>) => string;
  const isMobile = useIsMobile();
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const resolve = useResolver(resolveUrl, doFetch, tr);
  const count = files.length;
  const file = files[index];
  const kind: PreviewKind = file ? filePreviewKind(file) : 'unsupported';
  const tooLargeByDeclaration = !!file && typeof file.size === 'number' && file.size > limitFor(kind);
  const pdfOutside = kind === 'pdf' && isMobile;
  const needsBody = open && !!file && kind !== 'unsupported' && !tooLargeByDeclaration && !pdfOutside;

  const key = file ? fileKey(file, index) : '';
  // Each answer carries the key of the file it is about, so a file never
  // draws the previous file's answer while its own is on the way.
  const [answer, setAnswer] = React.useState<{ key: string; state: BodyState; url?: string }>({
    key: '',
    state: { status: 'loading' },
  });
  const state: BodyState = answer.key === key ? answer.state : { status: 'loading' };
  const resolvedUrl = answer.key === key ? answer.url : undefined;
  const setState = React.useCallback(
    (next: BodyState, url?: string) => setAnswer((prev) => ({ key, state: next, url: url ?? (prev.key === key ? prev.url : undefined) })),
    [key],
  );

  React.useEffect(() => {
    if (!needsBody || !file) return;
    const controller = new AbortController();
    let live = true;
    (async () => {
      let url: string;
      try {
        url = await resolve(file, index);
      } catch (err) {
        if (!live) return;
        const message = err instanceof Error && err.message ? err.message : tr('fields.filePreview.loadFailed');
        setState({ status: 'error', message });
        return;
      }
      if (!live) return;
      if (kind === 'text' || kind === 'csv') {
        try {
          const next = await readTextBody(url, kind, doFetch, controller.signal, tr);
          if (live) setState(next, url);
        } catch {
          if (live) setState({ status: 'error', message: tr('fields.filePreview.loadFailed') }, url);
        }
        return;
      }
      setState({ status: 'ready', url }, url);
    })();
    return () => {
      live = false;
      controller.abort();
    };
    // Keyed on the file's primitives (`key`), never on the item object (ui/AGENTS.md #10);
    // `doFetch` and `tr` are read through the run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsBody, key, kind, resolve, setState]);

  const go = React.useCallback(
    (delta: number) => {
      if (count <= 1) return;
      onIndexChange?.((index + delta + count) % count);
    },
    [count, index, onIndexChange],
  );

  const openInNewTab = React.useCallback(async () => {
    if (!file) return;
    try {
      const url = resolvedUrl ?? (await resolve(file, index));
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error && err.message ? err.message : tr('fields.filePreview.loadFailed'),
      });
    }
  }, [file, index, resolvedUrl, resolve, setState, tr]);

  const download = React.useCallback(async () => {
    if (!file) return;
    if (onDownload) {
      onDownload(file, index);
      return;
    }
    try {
      const url = resolvedUrl ?? (await resolve(file, index));
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error && err.message ? err.message : tr('fields.filePreview.loadFailed'),
      });
    }
  }, [file, index, onDownload, resolvedUrl, resolve, setState, tr]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      // Stopped too: a grid row behind a portal still hears React's bubble.
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        go(-1);
      }
    },
    [go],
  );

  if (!file) return null;

  const notice = (icon: React.ReactNode, message: string, slot: string, extra?: React.ReactNode) => (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground"
      data-preview-state={slot}
      role={slot === 'error' ? 'alert' : undefined}
    >
      {icon}
      <p className="max-w-sm">{message}</p>
      {extra}
    </div>
  );
  const downloadButton = (
    <Button type="button" size="sm" onClick={() => void download()}>
      <Download className="mr-2 size-4" aria-hidden="true" />
      {t('fields.filePreview.download')}
    </Button>
  );
  const newTabButton = (
    <Button type="button" size="sm" variant="outline" onClick={() => void openInNewTab()}>
      <ExternalLink className="mr-2 size-4" aria-hidden="true" />
      {t('fields.filePreview.openInNewTab')}
    </Button>
  );

  let body: React.ReactNode;
  if (kind === 'unsupported') {
    body = notice(<FileX className="size-10" aria-hidden="true" />, t('fields.filePreview.unsupported'), 'unsupported', downloadButton);
  } else if (tooLargeByDeclaration || state.status === 'tooLarge') {
    body = notice(<FileX className="size-10" aria-hidden="true" />, t('fields.filePreview.tooLarge'), 'too-large', downloadButton);
  } else if (pdfOutside) {
    body = notice(<ExternalLink className="size-10" aria-hidden="true" />, t('fields.filePreview.pdfOutside'), 'pdf-outside', newTabButton);
  } else if (state.status === 'loading') {
    body = notice(<Loader2 className="size-6 animate-spin" aria-hidden="true" />, t('fields.filePreview.loading'), 'loading');
  } else if (state.status === 'error') {
    body = notice(<AlertTriangle className="size-10" aria-hidden="true" />, state.message, 'error');
  } else if (state.status === 'blocked') {
    body = notice(<ExternalLink className="size-10" aria-hidden="true" />, t('fields.filePreview.blocked'), 'blocked', newTabButton);
  } else if (kind === 'image') {
    body = (
      <div className="flex h-full items-center justify-center" data-preview-state="image">
        <LightboxImageView
          url={state.url}
          name={file.name}
          index={index}
          className="max-h-full max-w-full rounded-md object-contain"
          onError={() => setState({ status: 'error', message: tr('fields.filePreview.loadFailed') })}
        />
      </div>
    );
  } else if (kind === 'pdf') {
    body = <iframe src={state.url} title={file.name} className="size-full rounded-md border-0" data-preview-state="pdf" />;
  } else if (kind === 'csv') {
    const [header = [], ...rest] = state.rows ?? [];
    body = (
      <div className="flex h-full flex-col gap-2" data-preview-state="csv">
        {state.truncated && (
          <p className="text-xs text-muted-foreground">{t('fields.filePreview.truncatedRows', { limit: TEXT_ROW_LIMIT })}</p>
        )}
        {header.length === 0 ? (
          notice(<FileX className="size-10" aria-hidden="true" />, t('fields.filePreview.empty'), 'empty')
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {header.map((cell, i) => (
                    <th key={i} className="whitespace-nowrap border-b px-2 py-1 text-left font-medium">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rest.map((row, r) => (
                  <tr key={r} className="even:bg-muted/40">
                    {row.map((cell, c) => (
                      <td key={c} className="whitespace-nowrap border-b px-2 py-1 align-top">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  } else {
    body = (
      <div className="flex h-full flex-col gap-2" data-preview-state="text">
        {state.truncated && (
          <p className="text-xs text-muted-foreground">{t('fields.filePreview.truncatedLines', { limit: TEXT_ROW_LIMIT })}</p>
        )}
        {state.text ? (
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 font-mono text-xs">
            {state.text}
          </pre>
        ) : (
          notice(<FileX className="size-10" aria-hidden="true" />, t('fields.filePreview.empty'), 'empty')
        )}
      </div>
    );
  }

  const iconButton = 'size-11 sm:size-8';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <MobileDialogContent
        className="flex flex-col gap-3 sm:h-[85vh] sm:max-h-[85vh] sm:max-w-5xl sm:w-[calc(100%-2rem)]"
        onKeyDown={handleKeyDown}
        data-testid="file-preview-dialog"
      >
        <div className="flex min-w-0 items-center gap-1 pr-10">
          <DialogTitle className="min-w-0 flex-1 truncate text-base" title={file.name}>
            {file.name || t('fields.filePreview.title')}
          </DialogTitle>
          {count > 1 && (
            <>
              <span className="px-1 text-xs tabular-nums text-muted-foreground">
                {t('fields.image.counter', { current: index + 1, total: count })}
              </span>
              <Button type="button" variant="ghost" size="icon" className={iconButton} onClick={() => go(-1)} aria-label={t('fields.filePreview.previous')}>
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className={iconButton} onClick={() => go(1)} aria-label={t('fields.filePreview.next')}>
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </>
          )}
          <Button type="button" variant="ghost" size="icon" className={iconButton} onClick={() => void download()} aria-label={t('fields.filePreview.download')}>
            <Download className="size-4" aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className={iconButton} onClick={() => void openInNewTab()} aria-label={t('fields.filePreview.openInNewTab')}>
            <ExternalLink className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <DialogDescription className="sr-only">{t('fields.filePreview.title')}</DialogDescription>
        <div className={cn('min-h-0 flex-1')}>{body}</div>
      </MobileDialogContent>
    </Dialog>
  );
}
