// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { LIFECYCLE_DURATION_REGEX } from '@objectstack/spec/data';

/**
 * The shape judgement of a `map` specifier's value (#30208; ADR-0007 as amended
 * 2026-11-08): ONE judgement, shared by both doors that produce an effective
 * value, the save door (`SettingsService.validatePatch`) and the env door
 * (`SettingsService.effectiveEnvOverride`), on the precedent of the option and
 * pattern families (#5204, #6580). A comparison living on one door only is how
 * those two defects happened.
 *
 * A `map` stores keyed rows. With one value column the entry IS the value
 * (`{ "sys_audit_log": 1000000 }`); with several it is an object of the
 * declared columns (`{ "sys_job_run": { "maxAge": "1y" } }`). Before this type,
 * the three lifecycle maps were `json` keys that neither door judged: a misspelt
 * object, `"1e6"` or `30 days` was stored, answered "saved", and silently did
 * nothing.
 */

/** The value kinds a column may declare — the spec's closed `kind` set. */
export type MapColumnKind = 'duration' | 'positive_integer';

const COLUMN_KINDS: ReadonlySet<string> = new Set<MapColumnKind>(['duration', 'positive_integer']);

/** One declared value column, as the doors judge it. */
export interface MapColumn {
  name: string;
  kind: MapColumnKind;
}

/** What a `map` specifier declares that a value is judged against. */
export interface DeclaredMapShape {
  columns: ReadonlyArray<MapColumn>;
}

/**
 * The shape a `map` specifier declares, or `null` when it declares none this
 * side can judge. `registerManifest` takes manifests as given (no Zod pass), so
 * a hand-built manifest's malformed columns are dropped rather than trusted, and
 * a map left with no column records nothing to enforce: the same leniency the
 * option table and the pattern take, never a reject-everything hole.
 */
export function declaredMapShape(spec: { type?: unknown; columns?: unknown }): DeclaredMapShape | null {
  if (spec.type !== 'map' || !Array.isArray(spec.columns)) return null;
  const columns: MapColumn[] = [];
  for (const col of spec.columns) {
    if (!col || typeof col !== 'object') continue;
    const { name, kind } = col as { name?: unknown; kind?: unknown };
    if (typeof name !== 'string' || name === '' || typeof kind !== 'string' || !COLUMN_KINDS.has(kind)) continue;
    columns.push({ name, kind: kind as MapColumnKind });
  }
  return columns.length > 0 ? { columns } : null;
}

/** Why a value is not the map its specifier declares — see {@link firstMapShapeMiss}. */
export type MapShapeMiss =
  /** The value is not an object of keyed rows at all (JSON text, a scalar, an array). */
  | { kind: 'not_a_map'; shape: string }
  /** An entry's key is not one the key column admits. */
  | { kind: 'key'; entry: string }
  /** Several columns: an entry is not an object, or names none of the columns. */
  | { kind: 'not_an_entry'; entry: string; shape: string }
  /** Several columns: an entry carries a property no column declares. */
  | { kind: 'unknown_column'; entry: string; column: string }
  /** A cell's value is not of its column's kind. */
  | { kind: 'cell'; entry: string; column: MapColumn; shape: string };

/**
 * The first way `value` is not the map `shape` declares, or `null` when it is.
 *
 * `null` / `undefined` pass: that is a clear, which falls back to the default.
 * Entries are judged in their own order, each key before its value, so the
 * verdict names the first entry a reader would trip over. `admitsKey` is the key
 * column's domain (the option source the settings service registers for the
 * key); absent, every key is admitted.
 *
 * A cell is judged as stored, never coerced: the one reader of these maps
 * (`LifecycleService.loadGovernance`) applies a quota only when it is a number
 * and a window only when it parses as a duration, so `"1000"` and `" 7y"` are
 * exactly the values that are stored and then do nothing.
 */
export function firstMapShapeMiss(
  shape: DeclaredMapShape,
  value: unknown,
  admitsKey?: (key: string) => boolean,
): MapShapeMiss | null {
  if (value === null || typeof value === 'undefined') return null;
  if (!isPlainRecord(value)) return { kind: 'not_a_map', shape: shapeOf(value) };
  const single = shape.columns.length === 1;
  for (const [entry, cell] of Object.entries(value)) {
    if (admitsKey && !admitsKey(entry)) return { kind: 'key', entry };
    if (single) {
      const column = shape.columns[0];
      if (!cellFits(column.kind, cell)) return { kind: 'cell', entry, column, shape: shapeOf(cell) };
      continue;
    }
    if (!isPlainRecord(cell)) return { kind: 'not_an_entry', entry, shape: shapeOf(cell) };
    const declared = new Map(shape.columns.map((c) => [c.name, c]));
    let named = 0;
    for (const [prop, v] of Object.entries(cell)) {
      const column = declared.get(prop);
      if (!column) return { kind: 'unknown_column', entry, column: prop };
      // An absent cell (`null` / `undefined`) is a column left empty.
      if (v === null || typeof v === 'undefined') continue;
      if (!cellFits(column.kind, v)) return { kind: 'cell', entry, column, shape: shapeOf(v) };
      named += 1;
    }
    if (named === 0) return { kind: 'not_an_entry', entry, shape: 'an object that names no column' };
  }
  return null;
}

function cellFits(kind: MapColumnKind, v: unknown): boolean {
  if (kind === 'duration') return typeof v === 'string' && LIFECYCLE_DURATION_REGEX.test(v);
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/** What a column of this kind takes, as a sentence fragment with an example. */
export function columnKindPhrase(kind: MapColumnKind): string {
  return kind === 'duration'
    ? 'a duration such as 7y (a whole number followed by h, d, w or y)'
    : 'a whole number greater than 0, such as 1000000';
}

/**
 * The one sentence a {@link MapShapeMiss} is told in, at both doors. It names
 * the entry (and the column), and the form expected. A string value is
 * described by its length (`a string of 7 characters`), never printed, as the
 * format family does (#24882); a whole number is named, since it is the
 * number an operator typed and carries nothing secret.
 */
export function mapMissSentence(
  label: string,
  shape: DeclaredMapShape,
  miss: MapShapeMiss,
  allowedKeys?: readonly string[],
): string {
  const columnNames = shape.columns.map((c) => c.name).join(', ');
  switch (miss.kind) {
    case 'not_a_map':
      return `${label} must be an object of keyed rows, such as ${exampleOf(shape, allowedKeys)}, not ${miss.shape}. ` +
        'Send the parsed value, not its JSON text.';
    case 'key':
      return `${label}: '${miss.entry}' is not a key this setting admits.` +
        (allowedKeys && allowedKeys.length > 0 ? ` Allowed: ${allowedKeys.join(', ')}.` : '');
    case 'not_an_entry':
      return `${label}: '${miss.entry}' must be an object with at least one of ${columnNames}, ` +
        `such as ${entryExampleOf(shape)}, not ${miss.shape}.`;
    case 'unknown_column':
      return `${label}: '${miss.entry}' has a property '${miss.column}' this setting does not declare. ` +
        `Allowed: ${columnNames}.`;
    case 'cell': {
      const where = shape.columns.length === 1 ? `'${miss.entry}'` : `'${miss.entry}'.${miss.column.name}`;
      return `${label}: ${where} must be ${columnKindPhrase(miss.column.kind)}, not ${miss.shape}.`;
    }
  }
}

function exampleCell(kind: MapColumnKind): string {
  return kind === 'duration' ? '"7y"' : '1000000';
}

function entryExampleOf(shape: DeclaredMapShape): string {
  const first = shape.columns[0];
  return `{ "${first.name}": ${exampleCell(first.kind)} }`;
}

function exampleOf(shape: DeclaredMapShape, allowedKeys?: readonly string[]): string {
  const key = allowedKeys?.[0] ?? 'key';
  const cell = shape.columns.length === 1 ? exampleCell(shape.columns[0].kind) : entryExampleOf(shape);
  return `{ "${key}": ${cell} }`;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** A value's kind and, for a string, its length — never its content. */
export function shapeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'string') return `a string of ${v.length} character${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'number') return Number.isInteger(v) ? `the whole number ${v}` : 'a number with a fraction';
  if (typeof v === 'object') return isPlainRecord(v) ? 'an object' : 'a non-plain object';
  return `a ${typeof v}`;
}
