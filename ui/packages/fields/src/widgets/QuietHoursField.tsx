/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  EmptyValue,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@object-ui/components';
import type { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { toHostGroupProps } from './toHostGroupProps.js';
import { useFieldTranslation } from './useFieldTranslation.js';
import {
  isEmptyWindow,
  quietHoursZone,
  quietHoursZones,
  readQuietHours,
  runsPastMidnight,
  timeInputValue,
  type QuietHoursValue,
} from './quietHours.js';

/** What the person is holding: each part verbatim until they edit it. */
interface QuietHoursDraft {
  tz?: string;
  start: string;
  end: string;
}

const EMPTY_DRAFT: QuietHoursDraft = { start: '', end: '' };

function draftOf(value: unknown): QuietHoursDraft {
  const reading = readQuietHours(value);
  return reading.kind === 'window' ? { ...reading.window } : EMPTY_DRAFT;
}

/** The stored shape a complete draft writes, keys in the order the service documents. */
function windowOf(draft: QuietHoursDraft): QuietHoursValue {
  return draft.tz === undefined
    ? { start: draft.start, end: draft.end }
    : { tz: draft.tz, start: draft.start, end: draft.end };
}

/** True when the draft already stands for `value`, so an echo keeps the person's draft. */
function draftDenotes(draft: QuietHoursDraft, value: unknown): boolean {
  const reading = readQuietHours(value);
  if (reading.kind === 'empty') return draft.start === '' && draft.end === '';
  if (reading.kind === 'unreadable') return false;
  return JSON.stringify(windowOf(draft)) === JSON.stringify(reading.window);
}

/**
 * QuietHoursField: a daily window when notifications are held, drawn as a
 * time-zone picker and a start and an end time (field `widget: 'quiet-hours'`).
 *
 * It writes exactly `{ tz?, start: 'HH:MM', end: 'HH:MM' }`, or `null` once both
 * times are cleared. A draft with one time and not the other writes nothing and
 * marks the missing time invalid through the browser's constraint validation,
 * so the form refuses to submit while it stands. Choosing a zone alone writes
 * nothing. An absent `tz` reads as UTC and stays absent until a zone is chosen.
 *
 * A stored value that is not that shape is shown as stored with a note, and is
 * replaced only when the person chooses to set a new range.
 */
export function QuietHoursField({ value, onChange, field: _field, readonly, error, ...props }: FieldWidgetComponentProps<any>) {
  const { t } = useFieldTranslation();
  const groupId = useId();
  const subId = (part: 'tz' | 'start' | 'end') => `${groupId}-${part}`;
  const {
    id: _hostId,
    'aria-labelledby': _hostLabelledBy,
    name: _domName,
    ...domProps
  } = toDomProps(props);
  const readonlyHostGroupProps = toHostGroupProps(props, 'instead-of-the-inputs');
  const hostGroupProps = toHostGroupProps(props, 'above-the-inputs');

  const [draft, setDraft] = useState<QuietHoursDraft>(() => draftOf(value));
  const [replacing, setReplacing] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [zoneSearch, setZoneSearch] = useState('');
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  const incomplete = (draft.start === '') !== (draft.end === '');
  const incompleteText = t('fields.quietHours.incomplete');

  // Adopt a value that changed outside the control (a record finishing its
  // load, a form reset). An incomplete draft stands: it is unsaved work.
  const lastSeenValue = useRef(value);
  useEffect(() => {
    if (Object.is(lastSeenValue.current, value)) return;
    lastSeenValue.current = value;
    if (incomplete) return;
    if (draftDenotes(draft, value)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Required for controlled component sync
    setDraft(draftOf(value));
    setReplacing(false);
  }, [value, draft, incomplete]);

  // The missing time carries the refusal, so the browser focuses it on submit.
  useEffect(() => {
    startRef.current?.setCustomValidity(incomplete && draft.start === '' ? incompleteText : '');
    endRef.current?.setCustomValidity(incomplete && draft.end === '' ? incompleteText : '');
  }, [incomplete, draft.start, draft.end, incompleteText]);

  const reading = readQuietHours(value);

  if (readonly) {
    if (reading.kind === 'empty') return <EmptyValue {...readonlyHostGroupProps} />;
    if (reading.kind === 'unreadable') {
      return (
        <pre
          {...readonlyHostGroupProps}
          data-testid="quiet-hours-unreadable"
          className={cn('text-xs bg-muted p-2 rounded border overflow-auto max-h-40', props.className)}
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    }
    const { start, end } = reading.window;
    return (
      <span {...readonlyHostGroupProps} className={cn('text-sm', props.className)} data-testid="quiet-hours-range">
        {t('fields.quietHours.range', { start, end, zone: quietHoursZone(reading.window) })}
      </span>
    );
  }

  if (reading.kind === 'unreadable' && !replacing) {
    return (
      <div className="space-y-2" {...hostGroupProps} data-testid="quiet-hours-unreadable">
        <pre className={cn('text-xs bg-muted p-2 rounded border overflow-auto max-h-40', props.className)}>
          {JSON.stringify(value, null, 2)}
        </pre>
        <p className="text-xs text-muted-foreground">{t('fields.quietHours.unreadable')}</p>
        <Button
          type="button"
          {...domProps}
          variant="outline"
          size="sm"
          disabled={props.disabled}
          aria-invalid={!!error}
          onClick={() => {
            setDraft(EMPTY_DRAFT);
            setReplacing(true);
          }}
          data-testid="quiet-hours-replace"
        >
          {t('fields.quietHours.replace')}
        </Button>
      </div>
    );
  }

  const commit = (next: QuietHoursDraft) => {
    setDraft(next);
    const hasStart = next.start !== '';
    const hasEnd = next.end !== '';
    if (hasStart && hasEnd) {
      onChange(windowOf(next));
    } else if (!hasStart && !hasEnd && reading.kind === 'window') {
      onChange(null);
    }
  };

  const zones = quietHoursZones();
  const currentZone = quietHoursZone(draft);
  const zoneNotInList = draft.tz !== undefined && !zones.includes(draft.tz);
  const zoneOptions = zoneNotInList ? [draft.tz as string, ...zones] : zones;
  const needle = zoneSearch.trim().toLowerCase();
  const filteredZones = needle ? zoneOptions.filter((zone) => zone.toLowerCase().includes(needle)) : zoneOptions;
  const zoneLabel = (zone: string) =>
    zoneNotInList && zone === draft.tz ? t('fields.quietHours.zoneNotInList', { zone }) : zone;

  const complete = draft.start !== '' && draft.end !== '';
  let note: string | null = null;
  if (complete && isEmptyWindow(draft.start, draft.end)) note = t('fields.quietHours.sameTimes');
  else if (complete && runsPastMidnight(draft.start, draft.end)) note = t('fields.quietHours.pastMidnight');

  return (
    <div className="space-y-2" {...hostGroupProps} data-testid="quiet-hours">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={subId('tz')} className="text-xs">{t('fields.quietHours.timeZone')}</Label>
          <Popover
            open={zoneOpen}
            onOpenChange={(open) => {
              setZoneOpen(open);
              if (!open) setZoneSearch('');
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                {...domProps}
                id={subId('tz')}
                variant="outline"
                role="combobox"
                aria-expanded={zoneOpen}
                aria-invalid={!!error}
                disabled={props.disabled}
                data-testid="quiet-hours-zone"
                className={cn('w-full min-w-0 justify-between font-normal', props.className)}
              >
                <span className="truncate">{zoneLabel(currentZone)}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0">
              <Command shouldFilter={false}>
                <CommandInput
                  value={zoneSearch}
                  onValueChange={setZoneSearch}
                  placeholder={t('table.search')}
                  data-testid="quiet-hours-zone-search"
                />
                <CommandList>
                  {filteredZones.length === 0 ? <CommandEmpty>{t('common.noResults')}</CommandEmpty> : null}
                  {filteredZones.length > 0 ? (
                    <CommandGroup>
                      {filteredZones.map((zone) => (
                        <CommandItem
                          key={zone}
                          value={zone}
                          onSelect={() => {
                            setZoneOpen(false);
                            setZoneSearch('');
                            if (zone !== draft.tz) commit({ ...draft, tz: zone });
                          }}
                        >
                          <Check className={cn('mr-2 h-4 w-4', zone === currentZone ? 'opacity-100' : 'opacity-0')} />
                          {zoneLabel(zone)}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={subId('start')} className="text-xs">{t('fields.quietHours.start')}</Label>
          <Input
            ref={startRef}
            id={subId('start')}
            type="time"
            value={timeInputValue(draft.start)}
            onChange={(e) => commit({ ...draft, start: e.target.value.slice(0, 5) })}
            disabled={props.disabled}
            aria-invalid={!!error || (incomplete && draft.start === '')}
            data-testid="quiet-hours-start"
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={subId('end')} className="text-xs">{t('fields.quietHours.end')}</Label>
          <Input
            ref={endRef}
            id={subId('end')}
            type="time"
            value={timeInputValue(draft.end)}
            onChange={(e) => commit({ ...draft, end: e.target.value.slice(0, 5) })}
            disabled={props.disabled}
            aria-invalid={!!error || (incomplete && draft.end === '')}
            data-testid="quiet-hours-end"
          />
        </div>
      </div>
      {incomplete ? (
        <p className="text-xs text-destructive" data-testid="quiet-hours-incomplete">{incompleteText}</p>
      ) : note ? (
        <p className="text-xs text-muted-foreground" data-testid="quiet-hours-note">{note}</p>
      ) : null}
    </div>
  );
}
