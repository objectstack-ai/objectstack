// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The generic metadata list's columns from the type's served list layout
 * (`/meta/types` `entries[].list`, the spec's `METADATA_LIST_REGISTRY`).
 *
 * Precedence, read by `ResourceListPage`:
 *
 * 1. the served list, when the type declares one — each column's cell drawn by
 *    its declared renderer, or by the console's `listCells` override for that
 *    key;
 * 2. else the console's own `listColumns`;
 * 3. else the default name / label / description;
 *
 * and after whichever applies, the console's `listExtraColumns`: values the
 * server stamps on a row that are not keys of the type's schema.
 *
 * A served header is already in the reader's locale (the server translates it
 * through the form field slot of the same path), so it is shown as served and
 * never looked up again in the console's `engine.list.col.*` table.
 *
 * A stored row omits a key the author left at its schema default, so an absent
 * value shows the default the served JSON Schema declares at that path: the
 * value the runtime uses.
 */

import * as React from 'react';
import { Badge, EmptyValue } from '@object-ui/components';
import type { MetadataListView } from '@objectstack/spec/ui';

import type { MetadataResourceConfig } from './registry.js';

export type ListColumns = NonNullable<MetadataResourceConfig['listColumns']>;
type ListCell = NonNullable<MetadataResourceConfig['listCells']>[string];

/** The value at a dotted `path` of `item`; `undefined` when any segment is missing. */
export function valueAtPath(item: Record<string, unknown>, path: string): unknown {
  let node: unknown = item;
  for (const segment of path.split('.')) {
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** The JSON Schema node at a dotted `path`, looking through `anyOf` / `oneOf` / `allOf` arms. */
function schemaNodeAt(schema: unknown, path: string): Record<string, unknown> | undefined {
  let node = schema as Record<string, unknown> | undefined;
  for (const segment of path.split('.')) {
    node = propertyNode(node, segment);
    if (!node) return undefined;
  }
  return node;
}

function propertyNode(node: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const props = node.properties as Record<string, Record<string, unknown>> | undefined;
  if (props && typeof props === 'object' && props[key]) return props[key];
  for (const arms of [node.anyOf, node.oneOf, node.allOf]) {
    if (!Array.isArray(arms)) continue;
    for (const arm of arms) {
      const found = propertyNode(arm as Record<string, unknown>, key);
      if (found) return found;
    }
  }
  return undefined;
}

/** The default the type's JSON Schema declares at `path`, or `undefined`. */
export function schemaDefaultAt(schema: unknown, path: string): unknown {
  const node = schemaNodeAt(schema, path);
  return node && 'default' in node ? node.default : undefined;
}

function isEmpty(value: unknown): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  return undefined;
}

/**
 * A summary member as text: a scalar as written, or an expression envelope
 * (`{ dialect, source }`, how the spec serves a cron schedule's `expression`)
 * as its authored `source`. Any other object member is left out.
 */
function memberText(value: unknown): string | undefined {
  const text = scalarText(value);
  if (text !== undefined) return text;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = (value as { source?: unknown }).source;
    if (typeof source === 'string') return source;
  }
  return undefined;
}

/** Draw one cell by the column's declared renderer. */
export function renderListCell(type: string | undefined, value: unknown): React.ReactNode {
  if (type === 'count') {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') return Object.keys(value).length;
    return value == null ? <EmptyValue /> : 0;
  }
  if (isEmpty(value)) return <EmptyValue />;
  switch (type) {
    case 'boolean':
      return value ? '✓' : '✗';
    case 'badge':
      return (
        <Badge variant="outline" className="font-mono text-xs font-normal">
          {scalarText(value) ?? JSON.stringify(value)}
        </Badge>
      );
    case 'list':
      return (Array.isArray(value) ? value : [value]).map((v) => scalarText(v) ?? JSON.stringify(v)).join(', ');
    case 'summary': {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const parts = Object.values(value as Record<string, unknown>)
          .map(memberText)
          .filter((v): v is string => v !== undefined && v !== '');
        if (parts.length > 0) return parts.join(' · ');
      }
      return scalarText(value) ?? JSON.stringify(value);
    }
    default: {
      const text = scalarText(value);
      if (text !== undefined) return text;
      return <code className="font-mono text-xs">{JSON.stringify(value).slice(0, 60)}</code>;
    }
  }
}

/**
 * The list page's columns from a served list layout, or `undefined` when the
 * type serves none (the caller then falls back to the console's own columns).
 */
export function servedListColumns(
  list: MetadataListView | undefined,
  schema: Record<string, unknown> | undefined,
  cells?: Readonly<Record<string, ListCell>>,
): ListColumns | undefined {
  if (!list || !Array.isArray(list.columns) || list.columns.length === 0) return undefined;
  return list.columns.map((column) => {
    const override = cells?.[column.field];
    const fallback = schemaDefaultAt(schema, column.field);
    const valueOf = (item: Record<string, unknown>) => {
      const value = valueAtPath(item, column.field);
      return value === undefined ? fallback : value;
    };
    return {
      key: column.field,
      label: typeof column.label === 'string' && column.label ? column.label : column.field,
      labelLocalized: true,
      ...(override?.width ? { width: override.width } : {}),
      render: (_value: unknown, item: Record<string, unknown>) =>
        override?.render ? override.render(valueOf(item), item) : renderListCell(column.type, valueOf(item)),
    };
  });
}

/** `base`, then each of the console's extra columns whose key `base` does not already show. */
export function withExtraColumns(base: ListColumns, extra: ListColumns | undefined): ListColumns {
  if (!extra || extra.length === 0) return base;
  const shown = new Set(base.map((c) => c.key));
  return [...base, ...extra.filter((c) => !shown.has(c.key))];
}
