// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0046 §6.7] Every doc this package registers is claimed by its manual,
 * and gated as the manual is.
 *
 * The Setup manual claims its pages by the package's doc namespace
 * (`include: 'setup_*'`), and nothing else holds the package's docs to that
 * prefix: `docs/namespace-prefix` runs in `os build`, and this package is built
 * by tsup. So this pin reads what the plugin really registers, the shipped
 * constants and nothing copied, and resolves the audiences the docs doors
 * resolve. A doc named outside the prefix is claimed by no book and falls back
 * to `org`; the constant put back to `'*'` also claims the control doc bound to
 * no package. Either turns this red.
 */

import { describe, expect, it } from 'vitest';
import { resolveDocAudiences, type AudienceBook, type ResolverDoc } from '@objectstack/spec/system';
import { createSetupAppPlugin, SETUP_APP_PACKAGE_ID, SETUP_MANUAL_BOOK } from './index.js';

interface Registered {
  id: string;
  docs: Array<{ name: string; label?: string }>;
  books: AudienceBook[];
}

async function registeredManifest(): Promise<Registered> {
  const registered: Registered[] = [];
  const manifest = { register: (m: Registered) => registered.push(m) };
  await createSetupAppPlugin().start({ getService: (name: string) => (name === 'manifest' ? manifest : undefined) });
  expect(registered, 'start() registers one manifest').toHaveLength(1);
  return registered[0]!;
}

describe('setup_manual claims every doc @objectstack/setup registers', () => {
  it('registers the manual beside its docs', async () => {
    const m = await registeredManifest();
    expect(m.id).toBe(SETUP_APP_PACKAGE_ID);
    expect(m.books).toEqual([SETUP_MANUAL_BOOK]);
    expect(m.docs.length, 'a package with no docs pins nothing').toBeGreaterThan(0);
  });

  it('gives every registered doc the manual\'s audience, and leaves a doc bound to no package alone', async () => {
    const m = await registeredManifest();
    // The metadata layer stamps each registered item with its package.
    const books: AudienceBook[] = m.books.map((b) => ({ ...b, packageId: m.id }));
    const docs: ResolverDoc[] = [
      ...m.docs.map((d) => ({ name: d.name, label: d.label, packageId: m.id })),
      // Control: a stored doc bound to no package is in every package scope.
      { name: 'unbound_page', label: 'Unbound' },
    ];
    const audiences = resolveDocAudiences(books, docs);
    for (const doc of m.docs) {
      expect(audiences.get(doc.name), `${doc.name} is not claimed by setup_manual`).toEqual([SETUP_MANUAL_BOOK.audience]);
    }
    expect(audiences.get('unbound_page'), 'the manual claims a doc bound to no package').toEqual(['org']);
  });
});
