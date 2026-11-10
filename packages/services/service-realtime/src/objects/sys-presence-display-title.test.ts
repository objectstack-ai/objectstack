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
 * The object now points at `display_title`, a text formula naming the PERSON
 * and the status LABEL — not the raw user id and the stored token. It reads the
 * user's `name` (their `email` where the name is blank) ONE hop through
 * `user_id`, the mechanism `sys_user_permission_set`'s title uses in
 * plugin-security, and the status through `label()`. This file asserts:
 *
 *  1. the designate-only pass the registry runs at registration
 *     (`provisionPrimary(…, { synthesize: false })`, ADR-0079 D7) keeps
 *     `display_title` and no longer lands on `id`;
 *  2. the formula reads `user_id` only through the hop — never bare, which is
 *     the `traversal-bare-and-traversed` refusal — and `status` only through
 *     `label()`, on a field that declares options;
 *  3. each column it reads on this row is required and none is withheld from
 *     a reader of the row.
 *
 * What it does NOT assert, deliberately: the rendered text. That needs the
 * engine to evaluate the formula, and this package's dependency closure has
 * none (`@objectstack/objectql` and `@objectstack/driver-sql` are not among its
 * dependencies). plugin-security's `sys-user-permission-set-person-title.test.ts`
 * and `sys-security-assignment-display-title.test.ts` hold the same hop to the
 * person's name through the real engine, as the reader.
 */

import { describe, it, expect } from 'vitest';
import { provisionPrimary, resolveDisplayField } from '@objectstack/spec/data';
import { SysPresence } from './sys-presence.object.js';

/** The `display_title` expression source. */
function formulaSource(): string {
  const source = (SysPresence.fields as Record<string, any>).display_title?.expression?.source;
  if (typeof source !== 'string') throw new Error('display_title carries no expression source');
  return source;
}

/** Every `record.<path>` the `display_title` expression reads, as written. */
function formulaReads(): string[] {
  return [...new Set([...formulaSource().matchAll(/record\.([A-Za-z_][A-Za-z0-9_.]*)/g)].map((m) => m[1]))].sort();
}

/** The fields the expression reads through `label(record.<field>)`. */
function labelReads(): string[] {
  return [...new Set([...formulaSource().matchAll(/\blabel\s*\(\s*record\.([A-Za-z_][A-Za-z0-9_]*)\s*\)/g)].map((m) => m[1]))].sort();
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

  it('the formula names the person through the user_id hop and the status by its option label', () => {
    const fields = SysPresence.fields as Record<string, any>;
    // `user_id` is read only through the hop, never bare — the raw id the
    // title used to print.
    expect(formulaReads()).toEqual(['status', 'user_id.email', 'user_id.name']);
    expect(fields.user_id?.type).toBe('lookup');
    expect(fields.user_id?.reference).toBe('sys_user');
    // `status` is read only through `label()`, never as the stored token, and
    // `label()` answers only on a field that declares options.
    expect(labelReads()).toEqual(['status']);
    expect(formulaSource()).not.toMatch(/\+\s*record\.status\b/);
    expect(Array.isArray(fields.status?.options) && fields.status.options.length > 0).toBe(true);
  });

  it('each column the formula reads on this row is required and none is withheld', () => {
    const fields = SysPresence.fields as Record<string, any>;
    for (const column of ['user_id', 'status']) {
      expect(fields[column], column).toBeDefined();
      expect(fields[column].required, column).toBe(true);
      expect(fields[column].hidden ?? false, column).toBe(false);
      expect(fields[column].requiredPermissions ?? [], column).toEqual([]);
      expect(fields[column].maskingRule, column).toBeUndefined();
    }
  });
});
