// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { EvalUserSchema } from './eval-user.zod';

// `EvalUserSchema.isPlatformAdmin` is the predicate platform-operator gates
// read (ADR-0068 D4), and its published description is what an author — human
// or AI — consults before writing that gate. These pins hold the description to
// the standing it actually reports (ADR-0095 D3) and keep the superseded
// "deprecated, derived alias" mark from coming back: a deprecated mark on the
// one key the gates agree on steers authors onto the positions array, which is
// the read every evaluator refuses.

const PUBLISHED = { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' } as const;

function publishedDescription(): string {
  const json = z.toJSONSchema(EvalUserSchema, PUBLISHED) as {
    properties?: Record<string, { description?: string; deprecated?: boolean }>;
  };
  const prop = json.properties?.isPlatformAdmin;
  expect(prop, 'isPlatformAdmin is missing from the published JSON Schema').toBeDefined();
  expect(prop?.deprecated).toBeUndefined();
  return prop?.description ?? '';
}

describe('EvalUserSchema.isPlatformAdmin — the published description', () => {
  it('names the PLATFORM_ADMIN standing of the posture-ladder decision', () => {
    const doc = publishedDescription();
    expect(doc).toContain('PLATFORM_ADMIN standing');
    expect(doc).toContain('ADR-0095 D3');
    expect(doc).toContain('ADR-0068 D4');
  });

  it('carries no deprecation word and no deprecated flag', () => {
    // `publishedDescription()` also asserts the JSON Schema `deprecated` flag is absent.
    expect(publishedDescription()).not.toMatch(/deprecat/i);
  });

  it('publishes the same text the schema declares at the point of use', () => {
    expect(EvalUserSchema.shape.isPlatformAdmin.description).toBe(publishedDescription());
  });
});
