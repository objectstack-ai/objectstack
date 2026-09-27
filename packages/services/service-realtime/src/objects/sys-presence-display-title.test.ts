// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record title of `sys_presence`, which declared a `titleFormat` and no
 * title pointer (#20044).
 *
 * ADR-0079 resolves a record's title as `nameField ?? displayNameField ??
 * derivation`, and an explicit `nameField` takes precedence over the
 * render-only `titleFormat`. With no pointer declared, the registry's
 * designate-only pass stamped `nameField: 'id'` — the first title-eligible
 * field — onto the registered body, and a `/meta` read serves that stamp as if
 * the author had written it. A renderer honouring the order therefore drew the
 * raw id as the record page's H1.
 *
 * The object now points at `display_title`, a text formula over the columns
 * `titleFormat` names. This file asserts:
 *
 *  1. the designate-only pass the registry runs at registration
 *     (`provisionPrimary(…, { synthesize: false })`, ADR-0079 D7) keeps
 *     `display_title` and no longer lands on `id`;
 *  2. the formula reads exactly the columns `titleFormat` names, on this row
 *     only, each required and none withheld from a reader of the row.
 *
 * What it does NOT assert, deliberately: the rendered text. That needs the
 * engine to evaluate the formula, and this package's dependency closure has
 * none (`@objectstack/objectql` and `@objectstack/driver-sql` are not among its
 * dependencies). The sibling objects' suites in plugin-security and
 * service-messaging hold the same formula shape to the `titleFormat` text
 * through the real engine.
 */

import { describe, it, expect } from 'vitest';
import { provisionPrimary, resolveDisplayField } from '@objectstack/spec/data';
import { SysPresence } from './sys-presence.object.js';

/** The `titleFormat` source: the parsed schema carries it as an envelope. */
function titleFormatSource(schema: unknown): string {
  const tf = (schema as { titleFormat?: unknown }).titleFormat;
  const source = typeof tf === 'string' ? tf : (tf as { source?: unknown })?.source;
  if (typeof source !== 'string') throw new Error(`titleFormat carries no template source: ${JSON.stringify(tf)}`);
  return source;
}

/** The columns `titleFormat` names. */
function titleFormatColumns(schema: unknown): string[] {
  return [...titleFormatSource(schema).matchAll(/\{\{?\s*([a-zA-Z0-9_.]+)\s*\}?\}/g)].map((m) => m[1]).sort();
}

/** Every `record.<path>` the `display_title` expression reads, as written. */
function formulaReads(schema: { fields: Record<string, any> }): string[] {
  const source = schema.fields.display_title?.expression?.source;
  if (typeof source !== 'string') throw new Error('display_title carries no expression source');
  return [...source.matchAll(/record\.([A-Za-z_][A-Za-z0-9_.]*)/g)].map((m) => m[1]).sort();
}

describe('[#20044] sys_presence declares a real record title under ADR-0079 order', () => {
  it('the designation pass keeps display_title, a text formula — it no longer stamps the id', () => {
    const designated = provisionPrimary(SysPresence as any, { synthesize: false }) as any;
    expect(designated.nameField).toBe('display_title');
    expect(designated.nameField).not.toBe('id');
    expect(SysPresence.displayNameField).toBe('display_title');
    expect(resolveDisplayField(SysPresence as any)).toBe('display_title');
    const field = (SysPresence.fields as Record<string, any>).display_title;
    expect(field?.type).toBe('formula');
    expect(field?.returnType).toBe('text');
  });

  it('the formula reads exactly the titleFormat columns, on this row, each required and none withheld', () => {
    const fields = SysPresence.fields as Record<string, any>;
    const reads = formulaReads(SysPresence as any);
    // One level deep: a dotted path would read a looked-up record's field.
    expect(reads).toEqual(titleFormatColumns(SysPresence));
    for (const column of reads) {
      expect(fields[column], column).toBeDefined();
      expect(fields[column].required, column).toBe(true);
      expect(fields[column].hidden ?? false, column).toBe(false);
      expect(fields[column].requiredPermissions ?? [], column).toEqual([]);
      expect(fields[column].maskingRule, column).toBeUndefined();
    }
  });
});
