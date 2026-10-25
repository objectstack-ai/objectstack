/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "Test this policy against a sample record" dialog (objectui#2413).
 *
 * RLS is the one authoring surface where a wrong predicate silently changes the
 * row scope — and a reviewer can't eyeball a CEL string and know which rows it
 * lets through. This dry-runs a `USING` / `CHECK` predicate against an
 * author-supplied sample `record` + `current_user` through the SAME engine the
 * server uses, so the author sees allow / deny BEFORE shipping.
 *
 * The bind recipe (record namespace + flattened fields + verbatim
 * `current_user`) lives in {@link file://./celAuthoring.ts}; this component is
 * just the form + result surface.
 *
 * Its words read the `t` its host binds to the designer locale. That includes
 * the two sentences the dry-run writes itself (the empty-predicate result, the
 * no-message fallback): `testRunCelPredicate` hands them back as catalogue
 * keys and the banner reads them through the same `t` (objectui#10862).
 */

import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DIALOG_VIEWPORT_GUTTER,
  Label,
  Textarea,
  cn,
} from '@object-ui/components';
import { AlertCircle, AlertTriangle, ShieldCheck, ShieldX, FlaskConical } from 'lucide-react';
import { testRunCelPredicate, type CelTestOutcome } from './celAuthoring.js';

type Clause = 'using' | 'check';

/** A JSON skeleton for the sample record — the object's fields set to `null`. */
function recordSkeleton(fields: string[]): string {
  const picked = fields.slice(0, 20);
  if (picked.length === 0) return '{\n  "id": "record-1"\n}';
  const obj: Record<string, null> = {};
  for (const f of picked) obj[f] = null;
  return JSON.stringify(obj, null, 2);
}

/** A sensible default acting subject (snake_case mirrors the editor placeholder). */
const DEFAULT_USER_JSON = JSON.stringify(
  { id: 'user-1', organization_id: 'org-1', positions: ['admin'] },
  null,
  2,
);

export interface CelTestRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyName?: string;
  objectName?: string;
  fieldNames?: string[];
  using?: string;
  check?: string;
  t: (k: string) => string;
}

const EMPTY_FIELDS: string[] = [];

export function CelTestRunDialog({
  open,
  onOpenChange,
  policyName,
  objectName,
  fieldNames = EMPTY_FIELDS,
  using,
  check,
  t,
}: CelTestRunDialogProps) {
  const clauses = React.useMemo<Clause[]>(() => {
    const out: Clause[] = [];
    if (using && using.trim()) out.push('using');
    if (check && check.trim()) out.push('check');
    return out;
  }, [using, check]);

  const [clause, setClause] = React.useState<Clause>('using');
  const [recordJson, setRecordJson] = React.useState('{}');
  const [userJson, setUserJson] = React.useState(DEFAULT_USER_JSON);
  const [outcome, setOutcome] = React.useState<CelTestOutcome | null>(null);
  const [jsonError, setJsonError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);

  // Re-seed the form whenever the dialog is (re)opened for a policy.
  React.useEffect(() => {
    if (!open) return;
    setClause(clauses[0] ?? 'using');
    setRecordJson(recordSkeleton(fieldNames));
    setUserJson(DEFAULT_USER_JSON);
    setOutcome(null);
    setJsonError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const source = clause === 'using' ? (using ?? '') : (check ?? '');

  async function run() {
    setOutcome(null);
    setJsonError(null);
    const record = parseObject(recordJson, t('perm.cel.test.record'), t);
    if (!record.ok) return setJsonError(record.error);
    const currentUser = parseObject(userJson, t('perm.cel.test.user'), t);
    if (!currentUser.ok) return setJsonError(currentUser.error);
    setRunning(true);
    try {
      setOutcome(await testRunCelPredicate(source, { record: record.value, currentUser: currentUser.value }));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-2xl ${DIALOG_VIEWPORT_GUTTER}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            {t('perm.cel.test.title')}
            {policyName ? <span className="text-muted-foreground font-normal">· {policyName}</span> : null}
          </DialogTitle>
          <DialogDescription>{t('perm.cel.test.help')}</DialogDescription>
        </DialogHeader>

        {clauses.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-4">{t('perm.cel.test.noPredicate')}</p>
        ) : (
          <div className="space-y-3">
            {/* Clause selector — only clauses that have a predicate. */}
            {clauses.length > 1 && (
              <div className="flex items-center gap-1.5" role="tablist" aria-label={t('perm.cel.test.clause')}>
                {clauses.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="tab"
                    aria-selected={clause === c}
                    onClick={() => {
                      setClause(c);
                      setOutcome(null);
                    }}
                    className={cn(
                      'rounded-md border px-3 py-1 text-xs transition-colors',
                      clause === c
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background hover:bg-accent',
                    )}
                  >
                    {c === 'using' ? t('perm.rls.using') : t('perm.rls.check')}
                  </button>
                ))}
              </div>
            )}

            {/* The predicate under test. */}
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-[10px] uppercase text-muted-foreground">
                {clause === 'using' ? t('perm.rls.using') : t('perm.rls.check')}
                {objectName ? ` · ${objectName}` : ''}
              </div>
              <code className="block whitespace-pre-wrap break-words font-mono text-xs">{source}</code>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase text-muted-foreground" htmlFor="cel-test-record">
                  {t('perm.cel.test.record')}
                </Label>
                <Textarea
                  id="cel-test-record"
                  value={recordJson}
                  onChange={(e) => setRecordJson(e.target.value)}
                  rows={8}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase text-muted-foreground" htmlFor="cel-test-user">
                  {t('perm.cel.test.user')} <span className="font-mono normal-case">current_user</span>
                </Label>
                <Textarea
                  id="cel-test-user"
                  value={userJson}
                  onChange={(e) => setUserJson(e.target.value)}
                  rows={8}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            {jsonError && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
                {jsonError}
              </p>
            )}

            {outcome && <OutcomeBanner outcome={outcome} t={t} />}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('engine.cancel')}
          </Button>
          <Button onClick={run} disabled={running || clauses.length === 0}>
            <FlaskConical className="h-4 w-4 mr-1" />
            {t('perm.cel.test.run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ParsedObject =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Parse a JSON object textarea into a friendly, located result (never throws).
 * The parser's own message passes through as written; the not-an-object
 * refusal reads `engine.celTest.notObject` (objectui#10862).
 */
function parseObject(raw: string, label: string, t: (k: string) => string): ParsedObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch (e) {
    return { ok: false, error: `${label}: ${(e as Error).message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: `${label}: ${t('engine.celTest.notObject')}` };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

function OutcomeBanner({ outcome, t }: { outcome: CelTestOutcome; t: (k: string) => string }) {
  if (outcome.status === 'allow') {
    return (
      <Banner tone="allow" icon={<ShieldCheck className="h-4 w-4 shrink-0" />} title={t('perm.cel.test.allow')}>
        {t('perm.cel.test.allowHint')}
      </Banner>
    );
  }
  if (outcome.status === 'deny') {
    return (
      <Banner tone="deny" icon={<ShieldX className="h-4 w-4 shrink-0" />} title={t('perm.cel.test.deny')}>
        {t('perm.cel.test.denyHint')}
      </Banner>
    );
  }
  if (outcome.status === 'value') {
    return (
      <Banner tone="warn" icon={<AlertTriangle className="h-4 w-4 shrink-0" />} title={t('perm.cel.test.nonBool')}>
        <code className="font-mono">{JSON.stringify(outcome.value)}</code> — {t('perm.cel.test.nonBoolHint')}
      </Banner>
    );
  }
  if (outcome.status === 'unavailable') {
    return (
      <Banner tone="warn" icon={<AlertTriangle className="h-4 w-4 shrink-0" />} title={t('perm.cel.test.unavailable')}>
        {t('perm.cel.test.unavailableHint')}
      </Banner>
    );
  }
  return (
    <Banner tone="error" icon={<AlertCircle className="h-4 w-4 shrink-0" />} title={t('perm.cel.test.error')}>
      <code className="block whitespace-pre-wrap break-words font-mono text-[11px]">
        {outcome.messageKey ? t(outcome.messageKey) : outcome.message}
      </code>
    </Banner>
  );
}

const TONE_CLS: Record<string, string> = {
  allow: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  deny: 'border-destructive/40 bg-destructive/10 text-destructive',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
};

function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: keyof typeof TONE_CLS | string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-md border px-3 py-2 text-xs', TONE_CLS[tone])} role="status" aria-live="polite">
      <div className="flex items-center gap-1.5 font-medium">
        {icon}
        {title}
      </div>
      <div className="mt-1 opacity-90">{children}</div>
    </div>
  );
}

export default CelTestRunDialog;
