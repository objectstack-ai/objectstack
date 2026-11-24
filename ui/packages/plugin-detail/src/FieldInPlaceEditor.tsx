/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One field of the record page edited in place (objectstack#36475): a click on
 * an editable value turns that value alone into an editor, drawn on a layer
 * over it, so no other field changes and the page does not move.
 *
 * - The editor is the list cell's (`FieldEditWidget` with `inCell`): a typed
 *   value is an input, a single select, a date, a record or a person opens its
 *   panel at once, a multi-select its check list.
 * - Enter or a click elsewhere saves; in a multi-line text Enter is a new line
 *   and Ctrl/Cmd+Enter saves. Esc discards and writes nothing. A pick that ends
 *   a choice saves at once, as in the list cell.
 * - A two-state value (`toggle`) flips and saves on the click itself; its
 *   layer is drawn only to say why a save was refused.
 * - An unchanged value writes nothing.
 *
 * The write is `InlineEditSaveBar`'s (`face="field"`), in a session of this
 * field's own: the same guarded update, the server's refusal shown under the
 * field with the editor left open and the typed value kept, the 409 dialog and
 * the fill-in dialog. The record is read again after a save, so every
 * condition that depends on the field is judged anew.
 */

import * as React from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  isImeKey,
} from '@object-ui/components';
import {
  DISCRETE_EDIT_TYPES,
  FieldEditWidget,
  hasFieldEditWidget,
  hasInCellPanelEditWidget,
} from '@object-ui/fields';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import type { FieldMetadata } from '@object-ui/types';
import { InlineEditSaveBar, type InlineEditSave } from './InlineEditSaveBar';
import { InlineFieldInput } from './InlineFieldInput';

/** Where the field's write goes: the record the page shows. */
export interface FieldInPlaceWriter {
  dataSource: unknown;
  objectName: string;
  recordId: string | number;
  refresh?: () => void | Promise<void>;
}

export interface FieldInPlaceEditorProps {
  /** The field's machine name. */
  name: string;
  /** The field as the row resolved it (type, options, reference, …). */
  field: Record<string, any>;
  /** The saved record: the value's starting point, the version a write is guarded by. */
  record: Record<string, any> | undefined;
  writer: FieldInPlaceWriter;
  /** A two-state value: flipped and saved on the click that opened this. */
  toggle?: boolean;
  /** The session ended: saved, discarded, or nothing to save. */
  onClose: () => void;
}

/** Types whose editor is multi-line: Enter is a new line there. */
const MULTI_LINE_TYPES = new Set(['textarea', 'markdown', 'html', 'richtext']);

/** Whether a field type flips between two states on a click. */
export function isToggleFieldType(type: unknown): boolean {
  return type === 'boolean' || type === 'toggle';
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  if (empty(a) && empty(b)) return true;
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

export const FieldInPlaceEditor: React.FC<FieldInPlaceEditorProps> = (props) => (
  <InlineEditProvider canEdit>
    <FieldInPlaceSession {...props} />
  </InlineEditProvider>
);

const FieldInPlaceSession: React.FC<FieldInPlaceEditorProps> = ({
  name,
  field,
  record,
  writer,
  toggle = false,
  onClose,
}) => {
  const session = useInlineEdit();
  const saveRef = React.useRef<InlineEditSave | null>(null);
  const savedValue = record?.[name];
  const [value, setValue] = React.useState<unknown>(toggle ? savedValue !== true : savedValue);
  // The value last handed over, read by a save that runs before a re-render.
  const stagedRef = React.useRef<{ value: unknown } | null>(toggle ? { value: savedValue !== true } : null);
  const enteredRef = React.useRef(false);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  const enter = session?.enter;
  React.useEffect(() => {
    enter?.(name);
  }, [enter, name]);

  const editing = !!session?.editing;
  React.useEffect(() => {
    if (editing) {
      enteredRef.current = true;
      return;
    }
    if (enteredRef.current) onCloseRef.current();
  }, [editing]);

  const commit = React.useCallback(() => {
    if (!session || session.saving) return;
    const staged = stagedRef.current;
    if (!staged || sameValue(staged.value, savedValue)) {
      session.cancel();
      return;
    }
    void saveRef.current?.({ [name]: staged.value });
  }, [session, savedValue, name]);

  // A two-state value saves on the click that opened the session.
  const toggledRef = React.useRef(false);
  React.useEffect(() => {
    if (!toggle || !editing || toggledRef.current) return;
    toggledRef.current = true;
    commit();
  }, [toggle, editing, commit]);

  const stage = React.useCallback(
    (next: unknown) => {
      stagedRef.current = { value: next };
      setValue(next);
      session?.setField(name, next);
    },
    [session, name],
  );

  const type = typeof field.type === 'string' ? field.type : undefined;
  const discrete = !!type && DISCRETE_EDIT_TYPES.has(type) && !field.multiple;
  const multiLine = !!type && MULTI_LINE_TYPES.has(type);
  const reason = session?.fieldErrors?.[name] ?? session?.error ?? undefined;

  const saveBar = (
    <InlineEditSaveBar
      face="field"
      saveRef={saveRef}
      dataSource={writer.dataSource}
      objectName={writer.objectName}
      recordId={writer.recordId}
      data={record}
      refresh={writer.refresh}
    />
  );

  // A flip draws nothing until a refusal needs saying.
  const layerOpen = editing && (!toggle || !!reason);

  // The layer covers the value it edits: it is moved up by the value's height.
  const anchorRef = React.useRef<HTMLSpanElement | null>(null);
  const [anchorHeight, setAnchorHeight] = React.useState(0);
  React.useLayoutEffect(() => {
    if (layerOpen) setAnchorHeight(anchorRef.current?.getBoundingClientRect().height ?? 0);
  }, [layerOpen]);

  if (!layerOpen) return saveBar;

  const onChange = (next: unknown) => {
    stage(next);
    if (discrete) commit();
  };
  const editor =
    type && (hasFieldEditWidget(type) || hasInCellPanelEditWidget(type)) ? (
      <FieldEditWidget
        field={field as unknown as FieldMetadata}
        value={value}
        onChange={onChange}
        inCell
        onCommit={commit}
        autoFocus
        error={reason}
        dataSource={writer.dataSource}
        dependentValues={record}
      />
    ) : (
      <InlineFieldInput
        field={field}
        value={value}
        onChange={onChange}
        dataSource={writer.dataSource}
        autoFocus
        error={reason}
        dependentValues={record}
      />
    );

  return (
    <Popover open>
      {/* The layer's anchor: the value box this editor covers. */}
      <PopoverTrigger asChild>
        <span ref={anchorRef} aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute inset-0" />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={-anchorHeight}
        data-field-in-place-editor={name}
        data-owns-escape=""
        className={cn(
          'w-max min-w-[max(var(--radix-popper-anchor-width),12rem)] max-w-[min(32rem,var(--radix-popper-available-width))]',
          'max-h-(--radix-popper-available-height) overflow-auto p-1 shadow-lg',
          'has-[[data-in-cell-face=input]]:p-0 has-[[data-in-cell-face=input]]:border-2 has-[[data-in-cell-face=input]]:border-primary',
        )}
        // Esc discards this edit only: an open panel inside the editor is a
        // layer above this one and closes first.
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          if (!session?.saving) session?.cancel();
        }}
        // A click elsewhere saves; a flip's refusal layer discards instead.
        onInteractOutside={(e) => {
          e.preventDefault();
          if (toggle) session?.cancel();
          else commit();
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.defaultPrevented || isImeKey(e) || e.shiftKey) return;
          if (multiLine && !(e.metaKey || e.ctrlKey)) return;
          e.preventDefault();
          if (toggle) session?.cancel();
          else commit();
        }}
      >
        {editor}
        {reason && (
          <p role="alert" data-inline-field-hint={name} className="px-2 py-1 text-xs text-destructive">
            {reason}
          </p>
        )}
        {saveBar}
      </PopoverContent>
    </Popover>
  );
};

export default FieldInPlaceEditor;
