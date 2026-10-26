// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PackageDependenciesEditor — the package dialog's editor for the manifest's
 * `dependencies` row, a `package name → version range` map (objectui#13278).
 *
 * The spec form has no renderer for a string map: `ManifestSchema`'s
 * `dependencies` serialises as `{ type: 'object', additionalProperties: {
 * type: 'string' } }`, SchemaForm infers the `object-fields` widget for it,
 * and with no `properties` to recurse into it fell back to a raw JSON
 * textarea under a developer hint. `PackageFormDialog` now hides that row from
 * the spec form and hosts this editor instead, the same way it hosts
 * `PackageIdInput` for the id.
 *
 * Why not the flow inspectors' `FlowKeyValueField`: it smart-parses each value
 * (`1` becomes a number, which `ManifestSchema` refuses for a version range),
 * commits `undefined` for an emptied map where the edit door clears the row
 * only on `{}` (objectui#13121), and silently skips an empty or duplicate key
 * where this row must say so.
 *
 * What it does and does not judge:
 *  - It emits the same flat map the dialog already sends: every row with a
 *    non-empty, not-yet-seen package name, its range kept as typed text.
 *  - An empty or duplicate package name is flagged under its row and reported
 *    through `onChange`'s `valid` flag, which keeps the dialog's save
 *    disabled; nothing with such a row is sent.
 *  - The ranges themselves are the server's to judge (`400 VALIDATION_ERROR`
 *    from the package doors, rendered by the dialog as before).
 */

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Input, Label } from '@object-ui/components';
import { t } from './i18n.js';

export type DependencyMap = Record<string, string>;

interface Row {
  /** Stable id, so renaming a package never remounts its row (caret survives). */
  id: number;
  name: string;
  range: string;
}

type RowProblem = 'empty' | 'duplicate' | null;

/** Row ids only need to be unique among one editor's rows; one sequence serves all. */
let rowSeq = 0;
const nextId = (): number => ++rowSeq;

/** Read the stored row into editable rows; a non-string range shows as its JSON. */
function toRows(value: unknown): Row[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([name, range]) => ({
    id: nextId(),
    name,
    range: typeof range === 'string' ? range : JSON.stringify(range) ?? '',
  }));
}

/** Each row's problem, in row order: the first row with a name keeps it. */
function rowProblems(rows: Row[]): RowProblem[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    const name = r.name.trim();
    if (!name) return 'empty';
    if (seen.has(name)) return 'duplicate';
    seen.add(name);
    return null;
  });
}

/** The flat map the rows stand for, leaving out every row with a problem. */
function rowsToMap(rows: Row[], problems: RowProblem[]): DependencyMap {
  const out: DependencyMap = {};
  rows.forEach((r, i) => {
    if (problems[i] === null) out[r.name.trim()] = r.range;
  });
  return out;
}

/** Order-insensitive signature of a stored map, to tell an outside change from our own. */
function signature(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '{}';
  const obj = value as Record<string, unknown>;
  return JSON.stringify(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

export interface PackageDependenciesEditorProps {
  /** The row's label, from the spec form's `dependencies` row. */
  label: string;
  /** The row's help line, from the spec form's row or the schema's description. */
  help?: string;
  /** The draft's `dependencies` value. */
  value: unknown;
  /**
   * Called with the next flat map after every edit, and whether every row has
   * a unique, non-empty package name. The map leaves out the rows that do not.
   */
  onChange: (next: DependencyMap, valid: boolean) => void;
  readOnly?: boolean;
  locale?: string;
}

export function PackageDependenciesEditor({
  label,
  help,
  value,
  onChange,
  readOnly = false,
  locale,
}: PackageDependenciesEditorProps) {
  const labelId = React.useId();
  const [rows, setRows] = React.useState<Row[]>(() => toRows(value));

  // Resync only on a change that did not come from this editor (the dialog
  // reseeding its draft on open). Decided by the value's signature string,
  // never by an object identity (AGENTS.md #10).
  const external = signature(value);
  const lastEmitted = React.useRef(external);
  React.useEffect(() => {
    if (external !== lastEmitted.current) {
      lastEmitted.current = external;
      setRows(toRows(value));
    }
  }, [external, value]);

  const problems = rowProblems(rows);

  const commit = (next: Row[]) => {
    setRows(next);
    const nextProblems = rowProblems(next);
    const map = rowsToMap(next, nextProblems);
    lastEmitted.current = signature(map);
    onChange(map, nextProblems.every((p) => p === null));
  };

  const update = (id: number, patch: Partial<Row>) =>
    commit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const nameLabel = t('engine.packages.dependencies.package', locale);
  const rangeLabel = t('engine.packages.dependencies.range', locale);
  const removeLabel = t('engine.packages.dependencies.remove', locale);

  return (
    <div className="space-y-2" data-testid="package-form-dependencies">
      <Label id={labelId} className="text-sm font-medium">
        {label}
      </Label>
      <div role="group" aria-labelledby={labelId} className="space-y-2">
        {rows.length === 0 && (
          <p className="text-xs italic text-muted-foreground" data-testid="package-dependencies-empty">
            {t('engine.packages.dependencies.empty', locale)}
          </p>
        )}
        {rows.map((row, i) => {
          const problem = problems[i];
          return (
            <div key={row.id} className="space-y-1" data-testid="package-dependency-row">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={nameLabel}
                  aria-invalid={problem ? true : undefined}
                  value={row.name}
                  onChange={(e) => update(row.id, { name: e.target.value })}
                  placeholder="@acme/core"
                  readOnly={readOnly}
                  className="h-9 flex-1 font-mono text-xs"
                />
                <Input
                  aria-label={rangeLabel}
                  value={row.range}
                  onChange={(e) => update(row.id, { range: e.target.value })}
                  placeholder="^1.0.0"
                  readOnly={readOnly}
                  className="h-9 w-32 shrink-0 font-mono text-xs"
                />
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 shrink-0 p-0 text-muted-foreground"
                    onClick={() => commit(rows.filter((r) => r.id !== row.id))}
                    aria-label={removeLabel}
                    title={removeLabel}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {problem && (
                <p className="text-xs text-destructive" role="alert" data-testid="package-dependency-problem">
                  {t(
                    problem === 'empty'
                      ? 'engine.packages.dependencies.nameRequired'
                      : 'engine.packages.dependencies.duplicate',
                    locale,
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => commit([...rows, { id: nextId(), name: '', range: '' }])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('engine.packages.dependencies.add', locale)}
        </Button>
      )}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
