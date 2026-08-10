// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5543 — runtime half of the `registerObject` authored-shape contract.
 *
 * The compile-time half lives in `register-object-authored-shape.pin.ts` (it has
 * to: this file is excluded from every tsc program the `typecheck` script runs,
 * so a `@ts-expect-error` written here would never be evaluated). What this file
 * adds is the other direction — that the literal which now *compiles* also
 * *registers*, unparsed, and comes back out with the authored keys intact and
 * without the `.default(...)` products fabricated on the way through. That is
 * the runtime fact the INPUT annotation is claiming, and it is why `registerObject`
 * must keep its warn-never-throw posture rather than growing a `parse`.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from './registry';
import { AUTHORED_TASK_OBJECT } from './register-object-authored-shape.pin';

describe('registerObject takes the AUTHORED object shape (#5543)', () => {
  it('registers the #5543 literal with no cast and resolves it back', () => {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';

    // No `as any` — this call is the regression guard. If the parameter is ever
    // re-annotated to the POST-parse shape, this line stops compiling.
    const fqn = registry.registerObject(AUTHORED_TASK_OBJECT, 'com.example.app');

    expect(fqn).toBe('task');
    const resolved = registry.getObject('task');
    expect(resolved?.name).toBe('task');
    expect(resolved?.label).toBe('Task');
    expect(resolved?.fields?.title).toMatchObject({ type: 'text', label: 'Title' });
  });

  it('does NOT materialize zod defaults on the register path — the annotation tells the truth', () => {
    // `registerObject` runs no `ObjectSchemaBase.parse`, so the keys that only
    // exist AFTER a parse (`searchable`, `required`, `multiple`, `unique`, …)
    // must be absent on the way out. If a future change adds a parse at this
    // seam it would also add a throw at boot, which registry.ts's
    // warn-never-throw philosophy rules out — this asserts the seam stayed put.
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    registry.registerObject({ name: 'plain', fields: { note: { type: 'text' } } }, 'com.example.app');

    const note = registry.getObject('plain')?.fields?.note as Record<string, unknown> | undefined;
    expect(note).toBeDefined();
    for (const defaulted of ['searchable', 'required', 'multiple', 'unique']) {
      expect(note).not.toHaveProperty(defaulted);
    }
  });

  it('never throws on a sparse authored object (warn-never-throw stands)', () => {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    expect(() => registry.registerObject({ name: 'sparse', fields: {} }, 'com.example.app')).not.toThrow();
  });
});
