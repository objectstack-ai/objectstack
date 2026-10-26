// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Clone" for a DECLARED sharing rule (objectui#12982): a new organization
 * rule pre-filled from the declaration, under a new name, and then the offer
 * to switch the declared rule off. See `sharing-rule-catalog.ts` for where
 * each field comes from and why.
 *
 * Two outcomes, decided by what the server serves for the source rule:
 *
 * - its compiled projection is served: the dialog writes the copy through the
 *   `sys_sharing_rule` data door, then offers the switch-off;
 * - it is not (the rule is switched off): the dialog opens that object's New
 *   form pre-filled with every field it has, and the admin enters the
 *   criteria there.
 *
 * Every refusal (`409 RESOURCE_CONFLICT` for a declared name, a duplicate, a
 * missing capability) is the server's sentence, shown as sent.
 */

import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@object-ui/components';
import { extractWriteErrorMessage, useAdapter } from '@object-ui/react';
import { t as translate, tFormat } from './i18n.js';
import { writeCatalogActivation } from './catalog-activation.js';
import {
  DECLARED_SHARING_RULE_TYPE,
  ORGANIZATION_SHARING_RULE_OBJECT,
  cloneRecordOf,
  readSharingRuleProjection,
  suggestCloneName,
  type SharingRuleProjection,
} from './sharing-rule-catalog.js';

export interface SharingRuleCloneDialogProps {
  /** The declaration being copied, as `GET /meta/sharing_rule` lists it. */
  declaration: Record<string, unknown>;
  /** Every declared rule name the list shows; the suggested name avoids them. */
  declaredNames: readonly string[];
  /** Whether the declared rule is switched on, by the ledger (`undefined`: unknown). */
  sourceActive: boolean | undefined;
  locale: string;
  onClose: () => void;
  /** The declared rule was switched through the door; the list updates its state. */
  onSourceSwitched: (name: string, enabled: boolean) => void;
}

type Projection = SharingRuleProjection | null | 'loading' | { failed: string };

/** Mounted only while open, so every opening starts from the declaration. */
export function SharingRuleCloneDialog({
  declaration,
  declaredNames,
  sourceActive,
  locale,
  onClose,
  onSourceSwitched,
}: SharingRuleCloneDialogProps) {
  const t = (k: string) => translate(k, locale);
  const adapter = useAdapter();
  const navigate = useNavigate();
  const { appName } = useParams<{ appName?: string }>();
  const source = String(declaration.name ?? '');
  const sourceLabel = typeof declaration.label === 'string' && declaration.label ? declaration.label : source;

  const [name, setName] = React.useState(() => suggestCloneName(source, declaredNames));
  const [label, setLabel] = React.useState(() => tFormat('engine.sharingRule.clone.copyLabel', locale, { label: sourceLabel }));
  const [projection, setProjection] = React.useState<Projection>('loading');
  const [busy, setBusy] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  /** The copy the server saved: the dialog's second step. */
  const [created, setCreated] = React.useState<{ name: string; id: string } | null>(null);
  const [switchState, setSwitchState] = React.useState<'idle' | 'busy' | 'off' | { failed: string }>('idle');

  React.useEffect(() => {
    const controller = new AbortController();
    readSharingRuleProjection(source, controller.signal)
      .then((row) => {
        if (!controller.signal.aborted) setProjection(row);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setProjection({ failed: err instanceof Error && err.message ? err.message : String(err) });
        }
      });
    return () => controller.abort();
  }, [source]);

  const served = projection !== 'loading' && projection !== null && !('failed' in projection) ? projection : null;
  const ready = name.trim() !== '' && label.trim() !== '' && projection !== 'loading';
  const appBase = `/apps/${encodeURIComponent(appName ?? 'setup')}/${ORGANIZATION_SHARING_RULE_OBJECT}`;

  async function submit() {
    if (!ready || busy) return;
    const record = cloneRecordOf(declaration, served, { name: name.trim(), label: label.trim() });
    if (record.criteria_json === undefined) {
      // No compiled criteria to copy: the New form, pre-filled, asks for them.
      const prefill = new URLSearchParams(Object.entries(record).map(([k, v]) => [k, String(v)]));
      navigate(`${appBase}/new?${prefill.toString()}`);
      return;
    }
    if (!adapter) {
      setRefusal(t('engine.sharingRule.clone.failed'));
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      const saved = (await adapter.create(ORGANIZATION_SHARING_RULE_OBJECT, record)) as { id?: unknown } | null;
      setCreated({ name: String(record.name), id: saved?.id != null ? String(saved.id) : '' });
    } catch (err: unknown) {
      setRefusal(extractWriteErrorMessage(err) || t('engine.sharingRule.clone.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function switchSourceOff() {
    setSwitchState('busy');
    try {
      const enabled = await writeCatalogActivation(DECLARED_SHARING_RULE_TYPE, source, false);
      onSourceSwitched(source, enabled);
      setSwitchState(enabled ? 'idle' : 'off');
    } catch (err: unknown) {
      setSwitchState({ failed: err instanceof Error && err.message ? err.message : String(err) });
    }
  }

  const sharedWith = declaration.sharedWith as { type?: unknown; value?: unknown } | undefined;
  const summary: Array<[string, string]> = [
    [t('engine.list.col.object'), String(served?.object_name ?? declaration.object ?? '—')],
    [
      t('engine.list.col.sharedWith'),
      `${String(served?.recipient_type ?? sharedWith?.type ?? '—')}: ${String(served?.recipient_id ?? sharedWith?.value ?? '—')}`,
    ],
    [t('engine.list.col.accessLevel'), String(served?.access_level ?? declaration.accessLevel ?? '—')],
  ];

  return (
    <Dialog open onOpenChange={(open: boolean) => !open && !busy && onClose()}>
      <DialogContent data-testid="sharing-rule-clone-dialog">
        <DialogHeader>
          <DialogTitle>{t('engine.sharingRule.clone.title')}</DialogTitle>
          <DialogDescription>{tFormat('engine.sharingRule.clone.body', locale, { name: source })}</DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-3" data-testid="sharing-rule-clone-created">
            <p className="text-sm">
              {tFormat('engine.sharingRule.clone.created', locale, { name: created.name, source })}
            </p>
            {sourceActive === false || switchState === 'off' ? (
              <p className="text-sm text-muted-foreground" data-testid="sharing-rule-clone-source-off">
                {tFormat('engine.sharingRule.clone.sourceOff', locale, { source })}
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => void switchSourceOff()}
                disabled={switchState === 'busy'}
                data-testid="sharing-rule-clone-disable-source"
              >
                {switchState === 'busy' && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {tFormat('engine.sharingRule.clone.disableSource', locale, { source })}
              </Button>
            )}
            {typeof switchState === 'object' && (
              <p role="alert" className="text-sm text-destructive">
                {tFormat('engine.catalog.active.failed', locale, { message: switchState.failed })}
              </p>
            )}
            <DialogFooter>
              {created.id && (
                <Button asChild variant="ghost">
                  <Link to={`${appBase}/record/${encodeURIComponent(created.id)}`}>
                    {t('engine.sharingRule.clone.openCopy')}
                  </Link>
                </Button>
              )}
              <Button type="button" onClick={onClose}>
                {t('engine.sharingRule.clone.done')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="sharing-rule-clone-name">{t('engine.sharingRule.clone.name')}</Label>
              <Input
                id="sharing-rule-clone-name"
                value={name}
                disabled={busy}
                onChange={(e) => {
                  setName(e.target.value);
                  setRefusal(null);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sharing-rule-clone-label">{t('engine.sharingRule.clone.label')}</Label>
              <Input
                id="sharing-rule-clone-label"
                value={label}
                disabled={busy}
                onChange={(e) => {
                  setLabel(e.target.value);
                  setRefusal(null);
                }}
              />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs">
              {summary.map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono break-all">{v}</dd>
                </React.Fragment>
              ))}
              <dt className="text-muted-foreground">{t('engine.list.col.criteria')}</dt>
              <dd className="font-mono break-all" data-testid="sharing-rule-clone-criteria">
                {projection === 'loading' ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-label={t('engine.sharingRule.clone.loading')} />
                ) : served?.criteria != null ? (
                  JSON.stringify(served.criteria)
                ) : (
                  '—'
                )}
              </dd>
            </dl>
            {projection !== 'loading' && served?.criteria == null && (
              <p className="text-xs text-muted-foreground" data-testid="sharing-rule-clone-no-criteria">
                {projection !== null && 'failed' in projection
                  ? projection.failed
                  : tFormat('engine.sharingRule.clone.noCriteria', locale, { name: source })}
              </p>
            )}
            {refusal !== null && (
              <p role="alert" className="text-sm text-destructive">
                {refusal}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                {t('engine.cancel')}
              </Button>
              <Button type="submit" disabled={!ready || busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {served?.criteria != null
                  ? t('engine.sharingRule.clone.confirm')
                  : t('engine.sharingRule.clone.continueInForm')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
