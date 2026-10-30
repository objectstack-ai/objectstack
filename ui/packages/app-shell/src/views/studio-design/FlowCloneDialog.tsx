// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Clone a read-only package's flow from Studio (ADR-0146 D4): the dialog the
 * Automations pillar's ⋯ menu opens, and the result notice the pillar shows
 * after the copy is made.
 *
 * The request is `requestFlowClone` (`setup/packagedFlowLedger.ts`), the one
 * Setup › Packaged automation sends: a mandatory new machine name and label,
 * opening on `<name>_copy` and "<label> (copy)", both editable. A refusal is
 * the server's sentence, shown verbatim in the dialog, which stays open.
 *
 * The result keeps the server's post-clone notice verbatim and offers the two
 * next steps objectui#13270 gave Setup's clone: switch the flow it was copied
 * from off for this deployment (the SAME ledger toggle as the pillar's switch,
 * offered only while that flow reads on; the pillar's own knowledge of which
 * flow was cloned, not a lineage the platform tracks — ADR-0126 §9), and open
 * the copy where the door put it.
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
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
import { t, tFormat } from '../metadata-admin/i18n.js';
import { requestFlowClone } from '../setup/packagedFlowLedger.js';

/** What a successful clone left on the pillar. */
export interface FlowCloneResult {
  /** Machine name the copy was created under. */
  name: string;
  /** The server's post-clone notice, verbatim. */
  notice: string;
  /** Machine name of the flow it was copied from. */
  source: string;
  /** That flow's label, as the rail shows it. */
  sourceLabel: string;
}

/** The clone dialog for the flow `source` / `sourceLabel`; `onCreated` receives the result. */
export function FlowCloneDialog({ open, onOpenChange, source, sourceLabel, locale, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: string;
  sourceLabel: string;
  locale: string;
  onCreated: (result: FlowCloneResult) => void;
}): React.ReactElement {
  const nameId = React.useId();
  const labelId = React.useId();
  const [name, setName] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Each opening starts on the submittable default: `<source>_copy` stays in
  // the `FlowSchema.name` shape because the source name is in it, and it is
  // the name the server's own taken-name refusal suggests.
  React.useEffect(() => {
    if (!open) return;
    setName(`${source}_copy`);
    setLabel(tFormat('engine.studio.auto.clone.copyLabel', locale, { label: sourceLabel || source }));
    setRefusal(null);
    setBusy(false);
  }, [open, source, sourceLabel, locale]);

  const valid = name.trim() !== '' && label.trim() !== '';
  const submit = async () => {
    setBusy(true);
    setRefusal(null);
    const outcome = await requestFlowClone(source, { name, label }, {
      http: (status) => tFormat('engine.studio.auto.clone.failedHttp', locale, { status }),
      network: t('engine.studio.auto.clone.failed', locale),
    });
    setBusy(false);
    if (!outcome.ok) {
      setRefusal(outcome.message);
      return;
    }
    onCreated({ name: outcome.name, notice: outcome.notice, source, sourceLabel: sourceLabel || source });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => !busy && onOpenChange(next)}>
      <DialogContent data-testid="auto-clone-dialog">
        <DialogHeader>
          <DialogTitle>{t('engine.studio.auto.clone.title', locale)}</DialogTitle>
          <DialogDescription>{t('engine.studio.auto.clone.body', locale)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={nameId}>{t('engine.studio.auto.idLabel', locale)}</Label>
            <Input
              id={nameId}
              data-testid="auto-clone-name"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setName(e.target.value);
                setRefusal(null);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={labelId}>{t('engine.studio.auto.nameLabel', locale)}</Label>
            <Input
              id={labelId}
              data-testid="auto-clone-label"
              value={label}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setLabel(e.target.value);
                setRefusal(null);
              }}
            />
          </div>
          {refusal && (
            // VERBATIM: a taken name's refusal says why and suggests a free one.
            <p role="alert" data-testid="auto-clone-refusal" className="text-sm text-destructive">
              {refusal}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('engine.cancel', locale)}
          </Button>
          <Button type="button" data-testid="auto-clone-confirm" disabled={!valid || busy} onClick={() => void submit()}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('engine.studio.auto.clone.confirm', locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The result of a clone, above the canvas: the server's notice verbatim, then
 * the next steps. `sourceOn` is the source's ledger flag as the pillar reads it
 * now (`undefined` when the engine reports no row, which offers no switch);
 * `onSwitchSourceOff` sends the pillar's own toggle, and `switchRefusal` is its
 * refusal, verbatim, beside the offer, which stays.
 */
export function FlowCloneResultNotice({
  result,
  sourceOn,
  switchBusy,
  switchRefusal,
  openTo,
  locale,
  onSwitchSourceOff,
  onDismiss,
}: {
  result: FlowCloneResult;
  sourceOn: boolean | undefined;
  switchBusy: boolean;
  switchRefusal: string | null;
  /** Where the copy is listed and edited today. */
  openTo: string;
  locale: string;
  onSwitchSourceOff: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div data-testid="auto-clone-result" className="relative space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2 pr-9 text-xs">
      <div role="status" className="space-y-1">
        <p className="font-medium text-foreground">
          {tFormat('engine.studio.auto.clone.created', locale, { name: result.name })}
        </p>
        {/* The server's own post-clone notice, verbatim. */}
        {result.notice && (
          <p data-testid="auto-clone-notice" className="text-muted-foreground">
            {result.notice}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {sourceOn === false ? (
          <p data-testid="auto-clone-source-off" className="text-muted-foreground">
            {tFormat('engine.studio.auto.clone.sourceOff', locale, { label: result.sourceLabel })}
          </p>
        ) : sourceOn === true ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={switchBusy}
            onClick={onSwitchSourceOff}
            data-testid="auto-clone-switch-source-off"
          >
            {switchBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
            {tFormat('engine.studio.auto.clone.switchSourceOff', locale, { label: result.sourceLabel })}
          </Button>
        ) : null}
        <Button asChild variant="ghost" size="sm">
          <Link to={openTo} data-testid="auto-clone-open">
            {t('engine.studio.auto.clone.open', locale)}
          </Link>
        </Button>
        {switchRefusal && (
          <p role="alert" data-testid="auto-clone-switch-refusal" className="basis-full text-destructive">
            {switchRefusal}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('engine.studio.auto.clone.dismiss', locale)}
        title={t('engine.studio.auto.clone.dismiss', locale)}
        data-testid="auto-clone-dismiss"
        className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
