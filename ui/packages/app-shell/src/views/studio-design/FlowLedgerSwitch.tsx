// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The activation-ledger switch on a read-only package's open flow (ADR-0146
 * D4) — the Automations pillar's header slot where a writable package's flow
 * draws its definition switch.
 *
 * Two switches, two words, never one control that means different things by
 * package:
 *   - a writable package's switch writes the flow's own `status` into its
 *     draft and reads "Enabled" / "Disabled", applied on publish;
 *   - this one flips the ADR-0126 §7.2 `sys_metadata_activation` bit through
 *     `POST /automation/<name>/toggle`, applied at once, and reads "On for this
 *     deployment" / "Off for this deployment", with a power glyph and the
 *     primary track instead of the definition switch's green one.
 *
 * `checked` is the ledger flag `GET /automation/_status` reports, never the
 * definition's `status`. When the caller's posture facts say the door refuses
 * them (`walledReason`), the switch draws disabled, described by the console's
 * own sentence, as the read-only definition switch is described by its reason.
 */

import * as React from 'react';
import { Power } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@object-ui/components';
import { t } from '../metadata-admin/i18n.js';

export function FlowLedgerSwitch({ checked, busy, walledReason, locale, onToggle }: {
  checked: boolean;
  /** A toggle is in flight. */
  busy: boolean;
  /** The console's sentence for why the toggle door refuses this caller, or none. */
  walledReason?: string;
  locale: string;
  onToggle: () => void;
}): React.ReactElement {
  const hintId = React.useId();
  const reasonId = React.useId();
  const hint = t('engine.studio.auto.ledger.hint', locale);
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid="auto-ledger-switch"
      onClick={onToggle}
      disabled={busy || !!walledReason}
      aria-describedby={walledReason ? `${hintId} ${reasonId}` : hintId}
      title={walledReason ? undefined : hint}
      className={
        'inline-flex h-7 items-center gap-2 rounded-md px-1 text-[12px] ' +
        (walledReason
          ? 'text-muted-foreground disabled:pointer-events-none'
          : 'text-foreground hover:bg-muted disabled:opacity-50')
      }
    >
      <span
        className={
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ' +
          (walledReason
            ? checked
              ? 'bg-muted-foreground/60'
              : 'bg-muted-foreground/25'
            : checked
              ? 'bg-primary'
              : 'bg-muted-foreground/40')
        }
      >
        <span
          className={
            'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ' +
            (checked ? 'translate-x-[18px]' : 'translate-x-0.5')
          }
        />
      </span>
      <Power className="h-3 w-3 shrink-0" aria-hidden="true" />
      {checked ? t('engine.studio.auto.ledger.on', locale) : t('engine.studio.auto.ledger.off', locale)}
    </button>
  );
  const hintLine = (
    <span id={hintId} className="sr-only">
      {hint}
    </span>
  );
  if (!walledReason)
    return (
      <>
        {toggle}
        {hintLine}
      </>
    );
  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-describedby={reasonId}
              data-disabled-reason=""
              className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {toggle}
              <span id={reasonId} data-testid="auto-ledger-walled-reason" className="sr-only">
                {walledReason}
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{walledReason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {hintLine}
    </>
  );
}
