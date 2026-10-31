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
 * definition's `status`. The word is `reading`, `activationReading`'s answer
 * for the same row, so this switch says what Setup › Packaged automation says:
 * "on", "off", or on but not running here, the muted track and the platform's
 * own sentence for why (`notRunningReason`, rendered verbatim, ⛔ never parsed).
 * When the caller's posture facts say the door refuses them (`walledReason`),
 * the switch draws disabled, described by the console's own sentence.
 */

import * as React from 'react';
import { Power } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@object-ui/components';
import { t } from '../metadata-admin/i18n.js';
import type { ActivationReading } from '../setup/packagedFlows.js';

export function FlowLedgerSwitch({ checked, reading, notRunningReason, busy, walledReason, locale, onToggle }: {
  /** The ledger flag. */
  checked: boolean;
  /** What the flag means on this deployment (`activationReading`). */
  reading: ActivationReading;
  /** The platform's sentence for why an enabled flow is not armed, when it sent one. */
  notRunningReason?: string;
  /** A toggle is in flight. */
  busy: boolean;
  /** The console's sentence for why the toggle door refuses this caller, or none. */
  walledReason?: string;
  locale: string;
  onToggle: () => void;
}): React.ReactElement {
  const hintId = React.useId();
  const reasonId = React.useId();
  const notRunningId = React.useId();
  const hint = t('engine.studio.auto.ledger.hint', locale);
  const notRunning = reading === 'not-running';
  const why = notRunning && notRunningReason ? notRunningReason : undefined;
  const describedBy = [hintId, why ? notRunningId : '', walledReason ? reasonId : ''].filter(Boolean).join(' ');
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid="auto-ledger-switch"
      data-reading={reading}
      onClick={onToggle}
      disabled={busy || !!walledReason}
      aria-describedby={describedBy}
      title={walledReason ? undefined : why ? `${hint}\n${why}` : hint}
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
          // On but not running: the muted track Setup draws for the same
          // reading, since the primary one reads as "running".
          (walledReason || notRunning
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
      {reading === 'on'
        ? t('engine.studio.auto.ledger.on', locale)
        : notRunning
          ? t('engine.studio.auto.ledger.notRunning', locale)
          : t('engine.studio.auto.ledger.off', locale)}
    </button>
  );
  const hintLine = (
    <>
      <span id={hintId} className="sr-only">
        {hint}
      </span>
      {why && (
        <span id={notRunningId} data-testid="auto-ledger-not-running-reason" className="sr-only">
          {why}
        </span>
      )}
    </>
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
