// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AddFieldPopover — what the Data pillar's "Add field" opens (objectui#12516).
 *
 * "Add field" used to create a field at once, named "New field" with a
 * `field_<N>` api name and type Text, for the author to rename and retype in
 * the inspector afterwards. The popover asks for the two things first: a Label
 * (required) and a Type (the inspector's searchable `FieldTypePicker`, Text
 * preselected). Create hands both to the host's `onCreate`, which adds the
 * field through the pillar's one add-field path (the object buffer and its
 * autosave) and opens it in the inspector; Cancel, Escape or a click outside
 * creates nothing.
 *
 * The api name is derived from the label, as the field inspector derives it,
 * and shown under the Label before Create. When the label yields none (a
 * label with no Latin letters, a Chinese one say) or yields one another field
 * already holds, the popover asks for the api name instead of letting the
 * host fall back to a positional `field_<N>` the author never saw, which is
 * permanent once published (objectui#13389).
 *
 * Two placements, one form:
 * - **trigger** (the Form toolbar): `children` is the button that opens it;
 * - **controlled** (the Records grid's "+" column, which the grid draws from
 *   its authoring context with no element to hand over): the host passes
 *   `open` / `onOpenChange`, `children` is the element it is placed against,
 *   and `returnFocusTo` names where focus goes back when it closes.
 */

import * as React from 'react';
import {
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@object-ui/components';
import type { FieldTypeId } from '../metadata-admin/previews/field-types.js';
import { FieldTypePicker } from '../metadata-admin/inspectors/FieldTypePicker.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { toFieldNameLoose } from '../metadata-admin/previews/object-fields-io.js';

export interface AddFieldPopoverProps {
  /**
   * Create the field: the label as typed (trimmed), the chosen type, and the
   * api name the author typed when the label derived no usable one
   * (objectui#13389); `undefined` means "derive it from the label".
   */
  onCreate: (label: string, type: FieldTypeId, name?: string) => void;
  /** The object's field names, so a derived name another field holds is caught here. */
  takenNames?: readonly string[];
  /** The element the popover opens from (trigger) or is placed against (controlled). */
  children: React.ReactElement;
  /** Controlled open state; omit both to let `children` open it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Where focus returns on close, when `children` cannot take it. */
  returnFocusTo?: () => HTMLElement | null;
  /** Which edge of `children` the popover lines up with. */
  align?: 'start' | 'end';
}

export function AddFieldPopover({
  onCreate,
  takenNames = [],
  children,
  open: openProp,
  onOpenChange,
  returnFocusTo,
  align = 'end',
}: AddFieldPopoverProps): React.ReactElement {
  const locale = useMetadataLocale();
  const [openState, setOpenState] = React.useState(false);
  const open = openProp ?? openState;
  const [label, setLabel] = React.useState('');
  const [type, setType] = React.useState<FieldTypeId>('text');
  const [apiName, setApiName] = React.useState('');
  const titleId = React.useId();
  const labelId = React.useId();
  const apiNameId = React.useId();
  const apiNameHintId = React.useId();

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
    // Every open starts from an empty label and Text.
    if (!next) {
      setLabel('');
      setType('text');
      setApiName('');
    }
  };

  const trimmed = label.trim();
  const derived = toFieldNameLoose(trimmed).replace(/_+$/, '');
  const derivedTaken = !!derived && takenNames.includes(derived);
  // The label alone cannot name the field: the author types the api name.
  const asksName = !!trimmed && (!derived || derivedTaken);
  const typed = apiName.replace(/_+$/, '');
  const typedTaken = !!typed && takenNames.includes(typed);
  const canCreate = !!trimmed && (!asksName || (!!typed && !typedTaken));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    onCreate(trimmed, type, asksName ? typed : undefined);
    setOpen(false);
  };
  const nameHint = !asksName
    ? null
    : typedTaken || (!typed && derivedTaken)
      ? tFormat('engine.studio.data.addFieldApiNameTaken', locale, { name: typed || derived })
      : !typed
        ? t('engine.studio.data.addFieldApiNameNotDerived', locale)
        : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        aria-labelledby={titleId}
        data-testid="add-field-popover"
        className="w-72 p-3"
        onCloseAutoFocus={(e) => {
          const target = returnFocusTo?.();
          if (target) {
            e.preventDefault();
            target.focus();
          }
        }}
      >
        <form onSubmit={submit} className="space-y-3">
          <p id={titleId} className="text-[13px] font-semibold">
            {t('engine.studio.data.addField', locale)}
          </p>
          <div className="space-y-1">
            <Label htmlFor={labelId} className="text-xs text-muted-foreground">
              {t('designer.field.label', locale)}
            </Label>
            <Input
              id={labelId}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('engine.studio.data.newFieldLabel', locale)}
              required
              aria-required="true"
              autoComplete="off"
              data-testid="add-field-label-input"
              className="h-8 text-sm"
            />
            {trimmed && !asksName && (
              <p className="text-xs text-muted-foreground" data-testid="add-field-api-name-preview">
                {t('designer.field.apiName', locale)}: <span className="font-mono text-foreground">{derived}</span>
              </p>
            )}
          </div>
          {asksName && (
            <div className="space-y-1">
              <Label htmlFor={apiNameId} className="text-xs text-muted-foreground">
                {t('designer.field.apiName', locale)}
              </Label>
              <Input
                id={apiNameId}
                value={apiName}
                onChange={(e) => setApiName(toFieldNameLoose(e.target.value))}
                required
                aria-required="true"
                aria-invalid={!!nameHint || undefined}
                aria-describedby={nameHint ? apiNameHintId : undefined}
                autoComplete="off"
                data-testid="add-field-api-name-input"
                className="h-8 font-mono text-sm"
              />
              {nameHint && (
                <p id={apiNameHintId} className="text-xs text-destructive" data-testid="add-field-api-name-hint">
                  {nameHint}
                </p>
              )}
            </div>
          )}
          <FieldTypePicker label={t('designer.field.type', locale)} value={type} onCommit={setType} locale={locale} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setOpen(false)}>
              {t('engine.studio.cancel', locale)}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!canCreate}
              data-testid="add-field-create"
              className="h-7 px-2.5 text-xs"
            >
              {t('engine.studio.data.addFieldCreate', locale)}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
