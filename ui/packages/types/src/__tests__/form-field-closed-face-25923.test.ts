// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FormField` carries no index signature, so a key no member declares stops
 * type-checking — the same compile-fail pin `base-schema-closed-face-8347`
 * holds for `BaseSchema`, for the form field (objectstack#25923, seat ruling
 * letter A on that card).
 *
 * The signature (`[key: string]: any`) admitted every key, so a misspelled
 * `labell` compiled and a host-written key (`group`, read by plugin-form's
 * field-group derivation) rode it undeclared. The host keys now live on
 * package-local hand-off types where their producer and consumer sit
 * (ui AGENTS.md #0.1), never on this authoring face.
 *
 * TYPE-level rows: `tsc -p tsconfig.test.json`, chained from this package's
 * `type-check` script, is their reader. An `@ts-expect-error` that stops
 * matching an error is itself an error (TS2578), so a signature put back on
 * `FormField` turns both refusal rows red. Every refusal row is a FRESH
 * literal, the only shape TypeScript excess-checks (the bound
 * `base-schema-closed-face-8347` pins). The vitest leg only keeps the
 * bindings alive.
 */

import { describe, it, expect } from 'vitest';
import type { FormField } from '../form';

describe('FormField is a closed authoring face (objectstack#25923)', () => {
  it('refuses a misspelled key and a host-written key; the declared spelling compiles', () => {
    // @ts-expect-error — `labell` is no FormField member
    const misspelt: FormField = { name: 'title', labell: 'Title' };
    // @ts-expect-error — `group` is host-written; plugin-form types it on `FormFieldWithGroup`
    const hostKey: FormField = { name: 'title', group: 'contact_info' };
    const declared: FormField = { name: 'title', label: 'Title', step: 1, className: 'w-full' };

    expect([misspelt.name, hostKey.name, declared.label]).toEqual(['title', 'title', 'Title']);
  });
});
