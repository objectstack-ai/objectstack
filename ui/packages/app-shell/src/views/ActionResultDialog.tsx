/**
 * ActionResultDialog — One-shot reveal of an action's API response.
 *
 * Rendered when an action completes successfully AND its spec declares a
 * `resultDialog`. Used for values the user MUST copy now because the
 * server will not surface them again: 2FA TOTP URI + backup codes,
 * freshly minted OAuth client_secret, regenerated recovery codes.
 *
 * Contract (mirrors `Action.resultDialog` in @objectstack/spec):
 *   - `spec.fields[]` selects what to render. Each entry has a dot `path`
 *     into `data` and an optional `format` (qrcode/code-list/secret/
 *     text/json/table; `table` with its `columns`, objectstack#33187). When
 *     `fields` is omitted, the dialog renders the whole payload as JSON. Entries whose `path` does not resolve in the payload
 *     are skipped — the response shape varies per request (e.g. no
 *     `temporaryPassword` when the admin typed one), and a labelled
 *     `undefined` row would be noise.
 *   - `title`, `description`, `acknowledge` and each `fields[].label` are
 *     `I18nLabel` on the contract — a plain string OR an inline per-locale map
 *     — and every one is resolved against the display language before it
 *     reaches the DOM (`43c0d1710`).
 *   - The dialog has NO close button — the user must click acknowledge.
 *     This is the whole point: a toast would let them dismiss the value
 *     before reading it.
 *   - The handler installed by ObjectView/RecordDetailView is
 *     promise-based, mirroring the ActionParamDialog pattern.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useActionDialogReturnFocus } from './actionDialogReturnFocus.js';
import { Copy, Eye, EyeOff, Check } from 'lucide-react';
import { toCanvas } from 'qrcode';
// Aliased per PR #4169's convention — app-shell has its OWN `resolveI18nLabel`
// for the KEYED vocabulary, which does not accept the inline per-locale map
// this resolves. ⛔ Not `resolveKeyedI18nLabel`: the two are structurally
// confusable and answer wrongly for each other's input (objectui#4167), and
// `resultDialog`'s label members are the INLINE form.
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
import type { ResultDialogSpec, ResultDialogFieldSpec } from '@object-ui/core';

export interface ResultDialogState {
  open: boolean;
  spec?: ResultDialogSpec;
  data?: unknown;
  resolve?: () => void;
}

interface ActionResultDialogProps {
  state: ResultDialogState;
  onAcknowledge: () => void;
}

type FieldFormat = NonNullable<ResultDialogFieldSpec['format']>;
/**
 * A `table` column, as the runner's field spec derives it from the contract's
 * answer-field row (objectstack#34391). Both callers hand the declared row
 * through whole (the result dialog's localized spec spreads each row; the
 * preflight panel's rows are the contract's own), so `columns` arrives as
 * written.
 */
type AnswerTableColumn = NonNullable<ResultDialogFieldSpec['columns']>[number];

function readPath(root: unknown, path: string): unknown {
  if (root == null) return undefined;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, root);
}

export function ActionResultDialog({ state, onAcknowledge }: ActionResultDialogProps) {
  // `language` is the display locale every other inline-`I18nLabel` caller in
  // this package resolves against — `UnifiedSidebar` reads it off this same
  // hook, `resolveActionParams` takes it threaded in by both its callers, and
  // metadata-admin's `useMetadataLocale` narrows this same value to that
  // designer's two bundled locales. One source, so a title and the
  // surrounding chrome cannot disagree about the user's language.
  const { t, language } = useObjectTranslation();
  const { spec, data } = state;
  // Focus returns to the control that started the action (see the helper).
  const returnFocus = useActionDialogReturnFocus(state.open);

  // Each of these three is an `I18nLabel` on the contract: a plain string, or
  // an inline per-locale map. Resolved here, once, on the way INTO JSX — an
  // unresolved map is an object, and React refuses an object as a child, so the
  // dialog threw rather than mis-rendering and the one-shot value it exists to
  // reveal was lost on an action that had already succeeded (`43c0d1710`).
  // `|| fallback` is kept over `??`: the resolver answers `undefined` for a map
  // with no usable entry, and an empty string must reach the default too.
  const title = resolveInlineI18nLabel(spec?.title, language);
  const description = resolveInlineI18nLabel(spec?.description, language);
  const acknowledge = resolveInlineI18nLabel(spec?.acknowledge, language);

  // Synthesise a single-field render plan when the action did not declare
  // explicit fields — keeps the dialog body uniform. Declared fields whose
  // path does not resolve in the payload are dropped: the value is
  // response-shape dependent (e.g. `temporaryPassword` only exists when the
  // server generated one), and a labelled `undefined` row helps nobody.
  const fields = useMemo<Array<{ field: ResultDialogFieldSpec; value: unknown }>>(() => {
    const declared: ResultDialogFieldSpec[] =
      spec?.fields && spec.fields.length > 0
        ? spec.fields
        : [{ path: '', label: undefined, format: spec?.format ?? 'json' }];
    return declared
      .map((field) => ({
        field,
        value: field.path === '' ? data : readPath(data, field.path),
      }))
      .filter(({ field, value }) => field.path === '' || value !== undefined);
  }, [spec, data]);
  // A table of several columns does not fit the narrow reveal dialog; the
  // dialog widens when it draws one.
  const drawsTable = fields.some(({ field, value }) => field.format === 'table' && Array.isArray(value));

  return (
    <Dialog
      open={state.open}
      // Block click-outside / Escape: the user must explicitly acknowledge.
      onOpenChange={(open) => { if (open === false) return; /* swallow */ }}
    >
      <DialogContent
        ref={returnFocus.contentRef}
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        // Block the X close button's intent too.
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className={drawsTable ? 'max-w-3xl' : 'max-w-lg'}
      >
        <DialogHeader>
          <DialogTitle>
            {title || t('actions.resultDialog.defaultTitle') || 'Save this value now'}
          </DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="space-y-4 py-2">
          {fields.map(({ field, value }, idx) => (
            <ResultField
              key={`${field.path}-${idx}`}
              field={field}
              value={value}
              defaultFormat={spec?.format}
            />
          ))}
        </div>

        <DialogFooter>
          <Button onClick={onAcknowledge}>
            {acknowledge || t('actions.resultDialog.acknowledge') || 'I have saved this'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One field of an action's answer, drawn in its declared format. Exported for
 * the param dialog's preflight panel (objectstack#31808), whose `fields` are
 * this dialog's own row and format set, so the two draw a format alike.
 */
export function ResultField({
  field,
  value,
  defaultFormat,
}: {
  field: ResultDialogFieldSpec;
  value: unknown;
  defaultFormat?: FieldFormat;
}) {
  const { t, language } = useObjectTranslation();
  const format: FieldFormat = field.format ?? defaultFormat ?? 'json';
  // Same `I18nLabel` contract as the dialog's own three label members, same
  // resolution — a field label is the fourth member the block declares as one.
  const label = resolveInlineI18nLabel(field.label, language);
  // The accessible name of this field's icon-only copy buttons: the field's
  // label when it has one, so two fields' buttons are told apart by name.
  const copyName = label
    ? t('actions.resultDialog.copyField', { label })
    : t('actions.resultDialog.copyValue');
  const copyItemName = (index: number) =>
    label
      ? t('actions.resultDialog.copyFieldItem', { label, index })
      : t('actions.resultDialog.copyItem', { index });

  // Type-guard each renderer rather than crash if the server returned an
  // unexpected shape (e.g. format=qrcode but value is undefined). We
  // degrade gracefully to JSON so the user can still recover the value.
  // `table` draws an array (the contract: a value that is not an array draws
  // as `json`, as `code-list` does); every other format is the contract's fit
  // test, the one a table cell applies too.
  const safeFormat: FieldFormat = (() => {
    if (format === 'table') return Array.isArray(value) ? 'table' : 'json';
    return valueFitsFormat(format, value) ? format : 'json';
  })();

  return (
    <div className="space-y-1.5">
      {label ? (
        <div className="text-sm font-medium text-foreground/80">{label}</div>
      ) : null}
      {safeFormat === 'qrcode' ? <QrcodeBlock value={value as string} copyName={copyName} /> : null}
      {safeFormat === 'code-list' ? (
        <CodeListBlock value={value as string[]} copyItemName={copyItemName} />
      ) : null}
      {safeFormat === 'secret' ? <SecretBlock value={value as string} copyName={copyName} /> : null}
      {safeFormat === 'text' ? <TextBlock value={value as string} copyName={copyName} /> : null}
      {safeFormat === 'json' ? <JsonBlock value={value} copyName={copyName} /> : null}
      {safeFormat === 'table' ? (
        <TableBlock rows={value as unknown[]} columns={field.columns ?? []} label={label} />
      ) : null}
    </div>
  );
}

/**
 * Whether a present value fits a format the way the contract's renderer
 * contract says (`resultDialog` in `@objectstack/spec`): `qrcode`, `secret`
 * and `text` take a string, `code-list` an array of strings, `json` anything.
 * A value that does not fit draws as JSON instead.
 */
function valueFitsFormat(format: Exclude<FieldFormat, 'table'>, value: unknown): boolean {
  switch (format) {
    case 'qrcode':
    case 'secret':
    case 'text':
      return typeof value === 'string';
    case 'code-list':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
    case 'json':
      return true;
  }
}

/** A plain object: the only element a column `path` is read in. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One line of JSON text: how `json`, and any value that does not fit its format, draws in a cell. */
function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * `format: 'table'` (objectstack#34391): each element of the array is one row
 * and each entry of `columns` one cell, in `columns` order, under a header
 * that is the column's `label`, falling back to its `path`. A cell reads the
 * column's dot `path` in the element; a path that resolves to nothing, or to
 * `null`, draws an empty cell. An element that is not a plain object has no
 * paths to read, so its row draws the element itself as compact JSON text in
 * the first cell and leaves the others empty. `[]` draws the header row over
 * an empty-state line.
 */
function TableBlock({
  rows,
  columns,
  label,
}: {
  rows: unknown[];
  columns: AnswerTableColumn[];
  label: string | undefined;
}) {
  const { t, language } = useObjectTranslation();
  const headers = columns.map((column) => resolveInlineI18nLabel(column.label, language) || column.path);
  return (
    <div className="max-h-96 overflow-auto rounded-md border" data-testid="result-table">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column, index) => (
              <TableHead key={`${column.path}-${index}`}>{headers[index]}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={Math.max(columns.length, 1)} className="text-center text-sm text-muted-foreground">
                {t('table.noRows')}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((element, rowIndex) => (
              <TableRow key={rowIndex}>
                {columns.map((column, columnIndex) => {
                  if (!isPlainObject(element)) {
                    return (
                      <TableCell key={`${column.path}-${columnIndex}`} className="align-top">
                        {columnIndex === 0 ? <CompactJson value={element} /> : null}
                      </TableCell>
                    );
                  }
                  const cellName = label ? `${label}, ${headers[columnIndex]}` : headers[columnIndex]!;
                  return (
                    <TableCell key={`${column.path}-${columnIndex}`} className="align-top">
                      <TableCellValue
                        value={readPath(element, column.path)}
                        format={column.format ?? 'text'}
                        copyName={t('actions.resultDialog.copyFieldItem', { label: cellName, index: rowIndex + 1 })}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * One cell of a table. Missing and `null` draw nothing; a value that fits the
 * column's format draws in it; any other value, and every `json` cell, draws
 * as compact JSON text. Inside a row a cell is compact: `text` and
 * `code-list` draw the value alone, while `secret` keeps its mask and reveal
 * toggle and `qrcode` its code, each with its copy button.
 */
function TableCellValue({
  value,
  format,
  copyName,
}: {
  value: unknown;
  format: Exclude<FieldFormat, 'table'>;
  copyName: string;
}) {
  if (value === undefined || value === null) return null;
  if (format === 'json' || !valueFitsFormat(format, value)) return <CompactJson value={value} />;
  if (format === 'text') return <span className="break-words">{value as string}</span>;
  if (format === 'secret') return <SecretBlock value={value as string} copyName={copyName} />;
  if (format === 'qrcode') return <QrcodeBlock value={value as string} copyName={copyName} />;
  return (
    <ul className="space-y-0.5">
      {(value as string[]).map((code, i) => (
        <li key={`${i}-${code}`}>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{code}</code>
        </li>
      ))}
    </ul>
  );
}

function CompactJson({ value }: { value: unknown }) {
  return <code className="break-all text-xs font-mono">{compactJson(value)}</code>;
}

function useCopy(value: string | undefined) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = async () => {
    if (value == null) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // ignore — typically denied permission. The plaintext is already
      // visible in the dialog so the user can manually copy.
    }
  };
  return { copy, copied };
}

/**
 * A copy button. With a visible `label` that text is its accessible name;
 * an icon-only button takes `name` as its `aria-label` instead. The copied
 * state is announced through a polite live region, mounted empty before it
 * fills — a region inserted together with its text is not reliably read.
 */
function CopyButton({
  value,
  label,
  name,
}: { value: string | undefined } & ({ label: string; name?: never } | { label?: never; name: string })) {
  const { t } = useObjectTranslation();
  const { copy, copied } = useCopy(value);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={label ? undefined : name}>
        {copied ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
        {label ? <span className="ml-2">{label}</span> : null}
      </Button>
      <span role="status" className="sr-only">
        {copied ? t('actions.resultDialog.copied') : ''}
      </span>
    </>
  );
}

function QrcodeBlock({ value, copyName }: { value: string; copyName: string }) {
  // QR codes for 2FA carry the shared secret. Render entirely client-side
  // (toCanvas writes into a local <canvas>) — never round-trip to a third
  // party. Falls back to plaintext if rendering fails (e.g. value too long
  // for QR encoding).
  const [error, setError] = useState<string | null>(null);
  const canvasRef = (node: HTMLCanvasElement | null) => {
    if (!node || !value) return;
    toCanvas(node, value, { width: 200, margin: 1 }, (err) => {
      if (err) setError(err.message);
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex justify-center rounded-md border bg-white p-3">
        {error ? (
          <span className="text-sm text-destructive">{error}</span>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs font-mono">
          {value}
        </code>
        <CopyButton value={value} name={copyName} />
      </div>
    </div>
  );
}

function CodeListBlock({
  value,
  copyItemName,
}: {
  value: string[];
  copyItemName: (index: number) => string;
}) {
  const { t } = useObjectTranslation();
  const joined = value.join('\n');
  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-muted/40 p-2">
        <ul className="space-y-1">
          {value.map((code, i) => (
            <li key={`${i}-${code}`} className="flex items-center gap-2">
              <code className="flex-1 rounded bg-background px-2 py-1 text-sm font-mono">
                {code}
              </code>
              <CopyButton value={code} name={copyItemName(i + 1)} />
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-end">
        <CopyButton value={joined} label={t('actions.resultDialog.copyAll')} />
      </div>
    </div>
  );
}

function SecretBlock({ value, copyName }: { value: string; copyName: string }) {
  const { t } = useObjectTranslation();
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded bg-muted px-2 py-1 text-sm font-mono break-all">
        {revealed ? value : value.replace(/./g, '•')}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? t('actions.resultDialog.hideValue') : t('actions.resultDialog.showValue')}
      >
        {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </Button>
      <CopyButton value={value} name={copyName} />
    </div>
  );
}

function TextBlock({ value, copyName }: { value: string; copyName: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded bg-muted px-2 py-1 text-sm font-mono break-all">
        {value}
      </code>
      <CopyButton value={value} name={copyName} />
    </div>
  );
}

function JsonBlock({ value, copyName }: { value: unknown; copyName: string }) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);
  return (
    <div className="space-y-2">
      <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-xs font-mono">
        {text}
      </pre>
      <div className="flex justify-end">
        <CopyButton value={text} name={copyName} />
      </div>
    </div>
  );
}
