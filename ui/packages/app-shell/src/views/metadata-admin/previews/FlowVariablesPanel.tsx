// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34818 item 7 — the flow's Variables, editable.
 *
 * The Studio's Variables section (objectui#12454) and the designer's side
 * panel used to list `variables` read-only, with "No variables declared." and
 * no way to add one. This panel lists them and, where the flow is editable:
 *
 * - **Add variable** appends a uniquely named `text` variable;
 * - each row edits its name, type, default value, input and output flags;
 * - a name the spec refuses (blank, `$`-led — the engine's own namespace, see
 *   `flowBoundVariableNameSchema('variableName')` — or one another variable
 *   already holds) is held on screen with a note and not written;
 * - renaming or removing a variable a step still reads is refused with a note
 *   naming those steps. References are not rewritten here: the author edits
 *   the steps first. The read is deliberately wide (a whole-word mention in
 *   any string of the step, `{{ name }}` holes and bare CEL alike, or a
 *   binding key that names it), so a refusal can be stricter than the
 *   engine, never looser.
 *
 * Every write is one `onPatch({ variables })` with the whole array, the shape
 * `FlowVariableSchema` parses. A key this panel does not edit (`objectName`)
 * rides along untouched. Without `onPatch` the panel is the
 * read-only list it replaced, with no add button.
 */

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, EmptyDescription, Input, cn } from '@object-ui/components';
import { t as tr, tFormat, tOptional } from '../i18n.js';
import { flowNodeDisplayName } from './flow-canvas-parts.js';

export interface FlowVariableRow {
  name: string;
  type?: string;
  defaultValue?: unknown;
  isInput?: boolean;
  isOutput?: boolean;
  objectName?: string;
}

interface FlowStepLike {
  id: string;
  type?: unknown;
  label?: unknown;
  [key: string]: unknown;
}

export interface FlowVariablesPanelProps {
  variables: FlowVariableRow[];
  /** The flow's steps and connections, read for the reference guard. */
  nodes: ReadonlyArray<FlowStepLike>;
  edges?: ReadonlyArray<{ condition?: unknown }>;
  /** Flow-level text that reads variables (`successMessage`, `errorMessage`). */
  flowText?: ReadonlyArray<unknown>;
  /** Absent: the read-only list. */
  onPatch?: (patch: { variables: FlowVariableRow[] }) => void;
  locale?: string;
}

/** The data types the spec names (`FlowVariableSchema.type`'s description). */
export const FLOW_VARIABLE_TYPES = ['text', 'number', 'boolean', 'object', 'list'] as const;

const IDENT = /[A-Za-z0-9_$]/;

/** Whether `text` mentions `name` as a whole word (not `record.name`, not `names`). */
function mentions(text: string, name: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(name, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : text[at - 1];
    const after = text[at + name.length] ?? '';
    if (!(before && (IDENT.test(before) || before === '.')) && !(after && IDENT.test(after))) return true;
    from = at + 1;
  }
}

/** Whether any string (or object key) in `value` mentions `name`. */
function readsName(value: unknown, name: string, depth = 0): boolean {
  if (depth > 32 || value === null || value === undefined) return false;
  if (typeof value === 'string') return mentions(value, name);
  if (Array.isArray(value)) return value.some((v) => readsName(v, name, depth + 1));
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => mentions(k, name) || readsName(v, name, depth + 1),
    );
  }
  return false;
}

/**
 * The steps (by display name) that read `name`, plus "the flow's messages"
 * and connection conditions. A step's own id, type and label are its
 * identity, not a read, and are skipped.
 */
export function flowVariableReaders(
  name: string,
  nodes: ReadonlyArray<FlowStepLike>,
  edges: ReadonlyArray<{ condition?: unknown }> = [],
  flowText: ReadonlyArray<unknown> = [],
  locale?: string,
): string[] {
  if (!name.trim()) return [];
  const out: string[] = [];
  for (const node of nodes) {
    const { id: _id, type: _type, label: _label, position: _position, description: _d, ...rest } = node;
    if (readsName(rest, name)) out.push(flowNodeDisplayName(node, locale));
  }
  if (edges.some((e) => readsName(e.condition, name))) out.push(tr('engine.flowPreview.vars.readerConnection', locale));
  if (flowText.some((v) => readsName(v, name))) out.push(tr('engine.flowPreview.vars.readerMessages', locale));
  return out;
}

/** The first `variable_N` no variable holds. */
export function nextFlowVariableName(variables: ReadonlyArray<{ name?: unknown }>): string {
  const taken = new Set(variables.map((v) => (typeof v.name === 'string' ? v.name.trim() : '')));
  for (let n = 1; ; n++) {
    const name = `variable_${n}`;
    if (!taken.has(name)) return name;
  }
}

/** Why `name` cannot be variable `index`'s name, or null. */
function nameRefusal(name: string, index: number, variables: ReadonlyArray<FlowVariableRow>, locale?: string): string | null {
  if (!name) return tr('engine.flowPreview.vars.nameBlank', locale);
  if (name.startsWith('$')) return tr('engine.flowPreview.vars.nameDollar', locale);
  if (variables.some((v, i) => i !== index && v.name === name)) return tFormat('engine.flowPreview.vars.nameTaken', locale, { name });
  return null;
}

function formatDefault(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** The default value `text` reads as for `type`, `undefined` to clear it, or a refusal. */
function parseDefault(text: string, type: string | undefined): { value: unknown } | { refusal: string } {
  if (text === '') return { value: undefined };
  switch (type) {
    case 'number': {
      const n = Number(text);
      return Number.isFinite(n) ? { value: n } : { refusal: 'engine.flowPreview.vars.defaultNumber' };
    }
    case 'boolean':
      if (text === 'true') return { value: true };
      if (text === 'false') return { value: false };
      return { refusal: 'engine.flowPreview.vars.defaultBoolean' };
    case 'object':
    case 'list': {
      try {
        const v = JSON.parse(text) as unknown;
        if (type === 'list' ? Array.isArray(v) : v !== null && typeof v === 'object' && !Array.isArray(v)) return { value: v };
      } catch {
        /* refused below */
      }
      return { refusal: type === 'list' ? 'engine.flowPreview.vars.defaultList' : 'engine.flowPreview.vars.defaultObject' };
    }
    default:
      return { value: text };
  }
}

export function FlowVariablesPanel({ variables, nodes, edges, flowText, onPatch, locale }: FlowVariablesPanelProps) {
  const editable = !!onPatch;
  const write = React.useCallback((next: FlowVariableRow[]) => onPatch?.({ variables: next }), [onPatch]);

  const add = () => {
    write([...variables, { name: nextFlowVariableName(variables), type: 'text' }]);
  };

  return (
    <div className="space-y-2" data-testid="flow-variables-panel">
      {variables.length === 0 ? (
        <EmptyDescription className="text-xs" data-testid="flow-variables-empty">
          {tr('engine.flowPreview.noVars', locale)}
        </EmptyDescription>
      ) : (
        <ul className="space-y-1.5">
          {variables.map((v, i) =>
            editable ? (
              <VariableRow
                // The index keys the row: a rename must keep the row (and its focus).
                key={i}
                index={i}
                variable={v}
                variables={variables}
                nodes={nodes}
                edges={edges}
                flowText={flowText}
                write={write}
                locale={locale}
              />
            ) : (
              <ReadOnlyRow key={v.name || i} variable={v} locale={locale} />
            ),
          )}
        </ul>
      )}
      {editable && (
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={add} data-testid="flow-variable-add">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {tr('engine.flowPreview.addVariable', locale)}
        </Button>
      )}
    </div>
  );
}

function Badges({ variable, locale }: { variable: FlowVariableRow; locale?: string }) {
  return (
    <>
      {variable.isInput && (
        <span className="text-[9px] font-semibold uppercase px-1 rounded bg-sky-100 text-sky-700">{tr('engine.flowPreview.varIn', locale)}</span>
      )}
      {variable.isOutput && (
        <span className="text-[9px] font-semibold uppercase px-1 rounded bg-emerald-100 text-emerald-700">{tr('engine.flowPreview.varOut', locale)}</span>
      )}
    </>
  );
}

function ReadOnlyRow({ variable: v, locale }: { variable: FlowVariableRow; locale?: string }) {
  return (
    <li className="rounded border bg-background p-1.5" data-testid="flow-variable-row">
      <div className="flex items-baseline gap-1 flex-wrap">
        <span className="font-mono">{v.name}</span>
        {v.type && <span className="text-[10px] uppercase text-muted-foreground">{v.type}</span>}
        <Badges variable={v} locale={locale} />
      </div>
      {v.defaultValue !== undefined && (
        <div className="text-[10px] text-muted-foreground font-mono truncate">= {formatDefault(v.defaultValue)}</div>
      )}
    </li>
  );
}

interface VariableRowProps {
  index: number;
  variable: FlowVariableRow;
  variables: FlowVariableRow[];
  nodes: ReadonlyArray<FlowStepLike>;
  edges?: ReadonlyArray<{ condition?: unknown }>;
  flowText?: ReadonlyArray<unknown>;
  write: (next: FlowVariableRow[]) => void;
  locale?: string;
}

function VariableRow({ index, variable: v, variables, nodes, edges, flowText, write, locale }: VariableRowProps) {
  const [nameText, setNameText] = React.useState(v.name ?? '');
  const [defaultText, setDefaultText] = React.useState(formatDefault(v.defaultValue));
  const [note, setNote] = React.useState<string | null>(null);
  const label = (key: string) => tr(key, locale);
  const typeLabel = (type: string) => tOptional(`engine.flowPreview.vars.type.${type}`, locale) ?? type;
  // A write from elsewhere (undo, a reload) re-seeds the row's text.
  React.useEffect(() => setNameText(v.name ?? ''), [v.name]);
  React.useEffect(() => setDefaultText(formatDefault(v.defaultValue)), [v.defaultValue]);

  const put = (patch: Partial<FlowVariableRow>, drop: ReadonlyArray<keyof FlowVariableRow> = []) => {
    const row: FlowVariableRow = { ...v, ...patch };
    for (const k of drop) delete (row as unknown as Record<string, unknown>)[k];
    write(variables.map((x, i) => (i === index ? row : x)));
  };
  const readers = () => flowVariableReaders(v.name ?? '', nodes, edges, flowText, locale);
  const readersNote = (key: string) => tFormat(key, locale, { name: v.name ?? '', steps: readers().join(tr('engine.flowPreview.vars.listSep', locale)) });

  const commitName = () => {
    const name = nameText.trim();
    if (name === v.name) {
      setNameText(name);
      setNote(null);
      return;
    }
    const refusal = nameRefusal(name, index, variables, locale);
    if (refusal) {
      setNote(refusal);
      return;
    }
    if (readers().length > 0) {
      setNote(readersNote('engine.flowPreview.vars.renameRead'));
      return;
    }
    setNote(null);
    put({ name });
  };

  const commitDefault = () => {
    const parsed = parseDefault(defaultText, v.type);
    if ('refusal' in parsed) {
      setNote(tr(parsed.refusal, locale));
      return;
    }
    setNote(null);
    if (parsed.value === undefined) {
      if (v.defaultValue !== undefined) put({}, ['defaultValue']);
    } else if (formatDefault(parsed.value) !== formatDefault(v.defaultValue)) {
      put({ defaultValue: parsed.value });
    }
  };

  const changeType = (type: string) => {
    if (defaultText === '') {
      setNote(null);
      put({ type });
      return;
    }
    // A default the new type cannot hold refuses the change: the author
    // clears or rewrites the default first, and nothing is dropped silently.
    const parsed = parseDefault(defaultText, type);
    if ('refusal' in parsed) {
      setNote(tFormat('engine.flowPreview.vars.typeHeld', locale, { type: typeLabel(type) }));
      return;
    }
    setNote(null);
    put({ type, defaultValue: parsed.value });
  };

  const remove = () => {
    if (readers().length > 0) {
      setNote(readersNote('engine.flowPreview.vars.removeRead'));
      return;
    }
    write(variables.filter((_, i) => i !== index));
  };

  const toggleInput = (on: boolean) => {
    // `objectName` declares an INPUT a record reference; the spec refuses it
    // on a variable that is not one, so it cannot be unticked under it.
    if (!on && v.objectName !== undefined) {
      setNote(tFormat('engine.flowPreview.vars.inputRecord', locale, { object: String(v.objectName) }));
      return;
    }
    setNote(null);
    put({ isInput: on });
  };

  const types: string[] = [...FLOW_VARIABLE_TYPES];
  if (v.type && !types.includes(v.type)) types.push(v.type);

  return (
    <li className="space-y-1.5 rounded border bg-background p-2" data-testid="flow-variable-row" data-variable={v.name}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          aria-label={label('engine.flowPreview.vars.name')}
          value={nameText}
          onChange={(e) => setNameText(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
          }}
          className={cn('h-7 min-w-0 flex-1 basis-32 font-mono text-xs', note && 'border-destructive')}
        />
        <select
          aria-label={label('engine.flowPreview.vars.type')}
          value={v.type ?? ''}
          onChange={(e) => changeType(e.target.value)}
          className="h-7 rounded-md border bg-background px-1.5 text-xs"
        >
          {!v.type && <option value="">—</option>}
          {types.map((type) => (
            <option key={type} value={type}>
              {typeLabel(type)}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground"
          aria-label={tFormat('engine.flowPreview.vars.remove', locale, { name: v.name ?? '' })}
          onClick={remove}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Input
          aria-label={label('engine.flowPreview.vars.default')}
          placeholder={label('engine.flowPreview.vars.defaultPlaceholder')}
          value={defaultText}
          onChange={(e) => setDefaultText(e.target.value)}
          onBlur={commitDefault}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDefault();
          }}
          className="h-7 min-w-0 flex-1 basis-32 font-mono text-xs"
        />
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={!!v.isInput} onChange={(e) => toggleInput(e.target.checked)} />
          {label('engine.flowPreview.vars.input')}
        </label>
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={!!v.isOutput} onChange={(e) => put({ isOutput: e.target.checked })} />
          {label('engine.flowPreview.vars.output')}
        </label>
      </div>
      {note && (
        <p role="alert" className="text-[11px] text-destructive" data-testid="flow-variable-note">
          {note}
        </p>
      )}
    </li>
  );
}
