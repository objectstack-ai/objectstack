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
 *     text/json). When `fields` is omitted, the dialog renders the whole
 *     payload as JSON. Entries whose `path` does not resolve in the payload
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
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
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

  return (
    <Dialog
      open={state.open}
      // Block click-outside / Escape: the user must explicitly acknowledge.
      onOpenChange={(open) => { if (open === false) return; /* swallow */ }}
    >
      <DialogContent
        // Block the X close button's intent too.
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="max-w-lg"
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

function ResultField({
  field,
  value,
  defaultFormat,
}: {
  field: ResultDialogFieldSpec;
  value: unknown;
  defaultFormat?: FieldFormat;
}) {
  const { language } = useObjectTranslation();
  const format: FieldFormat = field.format ?? defaultFormat ?? 'json';
  // Same `I18nLabel` contract as the dialog's own three label members, same
  // resolution — a field label is the fourth member the block declares as one.
  const label = resolveInlineI18nLabel(field.label, language);

  // Type-guard each renderer rather than crash if the server returned an
  // unexpected shape (e.g. format=qrcode but value is undefined). We
  // degrade gracefully to JSON so the user can still recover the value.
  const safeFormat: FieldFormat = (() => {
    if (format === 'qrcode' && typeof value !== 'string') return 'json';
    if (format === 'code-list' && !Array.isArray(value)) return 'json';
    if ((format === 'secret' || format === 'text') && typeof value !== 'string') return 'json';
    return format;
  })();

  return (
    <div className="space-y-1.5">
      {label ? (
        <div className="text-sm font-medium text-foreground/80">{label}</div>
      ) : null}
      {safeFormat === 'qrcode' ? <QrcodeBlock value={value as string} /> : null}
      {safeFormat === 'code-list' ? <CodeListBlock value={value as string[]} /> : null}
      {safeFormat === 'secret' ? <SecretBlock value={value as string} /> : null}
      {safeFormat === 'text' ? <TextBlock value={value as string} /> : null}
      {safeFormat === 'json' ? <JsonBlock value={value} /> : null}
    </div>
  );
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

function CopyButton({ value, label }: { value: string | undefined; label?: string }) {
  const { copy, copied } = useCopy(value);
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      {label ? <span className="ml-2">{label}</span> : null}
    </Button>
  );
}

function QrcodeBlock({ value }: { value: string }) {
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
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function CodeListBlock({ value }: { value: string[] }) {
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
              <CopyButton value={code} />
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

function SecretBlock({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded bg-muted px-2 py-1 text-sm font-mono break-all">
        {revealed ? value : value.replace(/./g, '•')}
      </code>
      <Button type="button" variant="outline" size="sm" onClick={() => setRevealed((v) => !v)}>
        {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </Button>
      <CopyButton value={value} />
    </div>
  );
}

function TextBlock({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded bg-muted px-2 py-1 text-sm font-mono break-all">
        {value}
      </code>
      <CopyButton value={value} />
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
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
        <CopyButton value={text} />
      </div>
    </div>
  );
}
