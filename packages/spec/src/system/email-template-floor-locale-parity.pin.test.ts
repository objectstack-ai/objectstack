// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17614] `EMAIL_TEMPLATE_FLOOR_LOCALE`'s docblock may say "the two must stay
 * equal" only while something holds them equal. This is that something.
 *
 * `packages/spec/src/system/email-template.zod.ts` publishes, in TSDoc an
 * author reads at the moment they type `locale:`, that
 * `@objectstack/plugin-email` spells the same value as its own
 * `DEFAULT_TEMPLATE_LOCALE` and that the two must stay equal. Both constants
 * are PUBLISHED — `EMAIL_TEMPLATE_FLOOR_LOCALE` from this package, and
 * `DEFAULT_TEMPLATE_LOCALE` from `plugin-email`'s `email-service.ts` via its
 * `index.ts` re-export — so that sentence is a cross-package claim on two
 * published surfaces with, until this file, nothing behind it.
 *
 * `position-delegatable-enforcer.pin.test.ts` in this package exists for the
 * identical shape and states the hazard in general terms: *"prose costs nothing
 * to add and no compiler checks it."* A published "must stay equal" nobody
 * checks reads, to the next author, as an invariant that is being watched.
 *
 * ## Why this reads TEXT instead of importing
 *
 * `packages/spec` does not depend on `@objectstack/plugin-email` (its
 * dependencies are `pg-connection-string` and `zod`), and it must not start —
 * the spec is the contract both ends of that relationship are written against.
 * So the value is read out of the other package's SOURCE, which is what the
 * `repo` vitest project exists for; this file is registered in
 * `packages/spec/vitest.repo-tests.json` so `check:cross-package-test-inputs`
 * and turbo's input hashing both see the escape.
 *
 * ⛔ Scope: the VALUE, not the resolver. This asserts two literals agree. It
 * asserts nothing about the ladder's shape — the exact `(name, locale)` match
 * and its single retry rung are a settled ruling, and changing them is not this
 * pin's business. Renaming either constant turns this red on purpose: the
 * docblock names `DEFAULT_TEMPLATE_LOCALE` specifically, so a rename is an edit
 * to the published claim and has to be made in both places.
 *
 * ⛔ A missing or unreadable declaration is a FAILURE, never a silent pass —
 * that is the whole failure mode a text-reading pin has to defend against.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { EMAIL_TEMPLATE_FLOOR_LOCALE } from './email-template.zod';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/spec/src/system → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');
const EMAIL_SERVICE_SOURCE = join(REPO_ROOT, 'packages', 'plugins', 'plugin-email', 'src', 'email-service.ts');
const EMAIL_INDEX_SOURCE = join(REPO_ROOT, 'packages', 'plugins', 'plugin-email', 'src', 'index.ts');

/** `export const DEFAULT_TEMPLATE_LOCALE = '…';` — how plugin-email declares it. */
const DECLARATION = /^export const DEFAULT_TEMPLATE_LOCALE = '([^']*)';\s*$/m;

describe('#17614 — the published "must stay equal" claim, held', () => {
  it("plugin-email's DEFAULT_TEMPLATE_LOCALE literal equals EMAIL_TEMPLATE_FLOOR_LOCALE", () => {
    const source = readFileSync(EMAIL_SERVICE_SOURCE, 'utf8');
    const match = DECLARATION.exec(source);

    // An absent declaration is the vacuous-pass trap this pin exists to avoid:
    // fail loudly and name what was looked for, rather than skipping.
    expect(
      match,
      `no 'export const DEFAULT_TEMPLATE_LOCALE = ...' declaration found in ${EMAIL_SERVICE_SOURCE}. `
        + 'It was renamed, moved or reshaped — update this pin and the "must stay equal" sentence '
        + 'in packages/spec/src/system/email-template.zod.ts together.',
    ).not.toBeNull();

    expect(match?.[1]).toBe(EMAIL_TEMPLATE_FLOOR_LOCALE);
  });

  it('is a claim about a PUBLISHED constant — plugin-email still re-exports it', () => {
    // If it stopped being published the docblock's framing would be wrong even
    // while the literals still agreed.
    const index = readFileSync(EMAIL_INDEX_SOURCE, 'utf8');
    expect(index).toContain('DEFAULT_TEMPLATE_LOCALE');
  });

  it('the sentence this pin backs is still the one being published', () => {
    // Reworded freely; what may not vanish silently is the claim itself.
    const spec = readFileSync(join(HERE, 'email-template.zod.ts'), 'utf8');
    expect(spec).toContain('DEFAULT_TEMPLATE_LOCALE');
    expect(spec).toContain('must stay equal');
  });
});
