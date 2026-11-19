// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `resolveArtifactPackageOrder`'s ABSENT branch is `undefined` only (#19926,
 * ruling A).
 *
 * `ObjectStackDefinitionSchema.packages` is `z.array(ArtifactPackageSchema)
 * .optional()`, and `.optional()` admits `undefined`, not `null`. So `null` is
 * a present, non-array `packages`: malformed, and refused with the same
 * envelope as `{}`, `0` or `'x'`. The rule is stated once, beside
 * `AssembledPackageBodySchema` (`@objectstack/spec`, `stack.zod.ts`).
 *
 * The resolver's wider behaviour (ordering, the entry gate, duplicates) is
 * pinned where its load path is, in `@objectstack/objectql`'s
 * `artifact-load-path.test.ts`. This file pins the one branch every reader of
 * `packages` inherits from here, and what an entry refusal ends on: shape
 * advice for an entry whose shape is wrong, the content refusal itself for an
 * entry wrapped correctly whose content is refused.
 */

import { describe, it, expect } from 'vitest';
import { ArtifactPackageSchema } from '@objectstack/spec';
import { resolveArtifactPackageOrder, type ArtifactPackageError } from './artifact-packages';

const manifest = { id: 'com.example.a', name: 'A', version: '1.0.0', type: 'app' };

function refusalOf(artifact: unknown): ArtifactPackageError | undefined {
  try {
    resolveArtifactPackageOrder(artifact);
    return undefined;
  } catch (err) {
    return err as ArtifactPackageError;
  }
}

describe('resolveArtifactPackageOrder — `packages: null` is malformed, not absent', () => {
  it('refuses `packages: null` with INVALID_ARTIFACT_PACKAGES / 422', () => {
    const refused = refusalOf({ manifest, packages: null });
    expect(refused).toBeInstanceOf(Error);
    expect(refused?.code).toBe('INVALID_ARTIFACT_PACKAGES');
    expect(refused?.status).toBe(422);
  });

  it.each([
    ['{}', {}],
    ['0', 0],
    ["'x'", 'x'],
  ])('refuses `packages: %s` with the same envelope — `null` is one of these, not a fourth case', (_label, packages) => {
    const refused = refusalOf({ manifest, packages });
    expect(refused?.code).toBe('INVALID_ARTIFACT_PACKAGES');
    expect(refused?.status).toBe(422);
  });

  it('control: an ABSENT `packages` (no key, or an explicit `undefined`) is the single-package branch, returned by identity', () => {
    const noKey = { manifest };
    const explicitUndefined = { manifest, packages: undefined };
    for (const artifact of [noKey, explicitUndefined]) {
      expect(refusalOf(artifact)).toBeUndefined();
      const resolved = resolveArtifactPackageOrder(artifact);
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toBe(artifact);
    }
  });

  it('control: an ARRAY `packages` resolves to its bodies, by reference', () => {
    const body = { ...manifest };
    const resolved = resolveArtifactPackageOrder({ packages: [{ manifest: body }] });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toBe(body);
    expect(resolveArtifactPackageOrder({ packages: [] })).toEqual([]);
  });
});

describe('an entry refusal ends on what is wrong with the entry', () => {
  // Anchors on the two pieces of advice, not their whole wording: what is
  // pinned is WHICH entry is given which advice.
  const WRAPPER = 'wrap an inlined body as';
  const GLOBS = 'glob patterns';

  const entryRefusal = (entry: unknown): ArtifactPackageError => {
    const refused = refusalOf({ packages: [entry] });
    expect(refused?.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
    expect(refused?.status).toBe(422);
    return refused!;
  };

  it.each([
    ['an inlined body', { ...manifest }],
    ['an entry that is not an object', 'x'],
    ['an entry with no `manifest`', {}],
    ['a `manifest` that is not an object', { manifest: 'x' }],
  ])('the WRAPPER is wrong — %s — so the refusal ends on the wrapper advice', (_label, entry) => {
    const { message } = entryRefusal(entry);
    expect(message).toContain(WRAPPER);
    expect(message).not.toContain(GLOBS);
  });

  it.each([
    ['`objects` carrying a glob', { manifest: { ...manifest, objects: ['./src/objects/*.object.ts'] } }],
    ['`datasources` carrying a glob', { manifest: { ...manifest, datasources: ['./src/*.datasource.ts'] } }],
    ['`objects` that is one glob string', { manifest: { ...manifest, objects: './src/objects/**' } }],
  ])('the BODY is the authoring stage — %s — so the refusal ends on the assembled-body advice', (_label, entry) => {
    const { message } = entryRefusal(entry);
    expect(message).toContain(GLOBS);
    expect(message).not.toContain(WRAPPER);
  });

  it.each([
    ['an invalid package id', { manifest: { ...manifest, id: '' } }],
    ['an undeclared key in the body (reported AT `manifest`)', { manifest: { ...manifest, bogus: 1 } }],
    ['an object definition that is not a valid definition', { manifest: { ...manifest, objects: [{ label: 'no name' }] } }],
    ['an undeclared `source`', { manifest: { ...manifest }, source: 'nope' }],
  ])('the entry is wrapped correctly and its CONTENT is refused — %s — so the refusal ends on that refusal', (_label, entry) => {
    const { message } = entryRefusal(entry);
    expect(message).not.toContain(WRAPPER);
    expect(message).not.toContain(GLOBS);
    // The last thing said is the schema's own sentence for the last issue,
    // read off the same parse the resolver runs rather than copied here.
    const verdict = ArtifactPackageSchema.safeParse(entry);
    expect(verdict.success).toBe(false);
    const issues = verdict.success ? [] : verdict.error.issues;
    expect(issues.length).toBeLessThanOrEqual(5);
    const last = issues[issues.length - 1].message.trimEnd().replace(/[.!?]$/, '');
    expect(message.trimEnd().replace(/[.!?]$/, '').endsWith(last)).toBe(true);
  });

  it('a content refusal with issues withheld ends on the count, with no advice after it', () => {
    const objects = Array.from({ length: 7 }, () => ({ label: 'no name' }));
    const { message } = entryRefusal({ manifest: { ...manifest, objects } });
    expect(message).toMatch(/\(\+\d+ more\)\.$/);
    expect(message).not.toContain(WRAPPER);
    expect(message).not.toContain(GLOBS);
  });
});

describe('packages that depend on each other in a cycle are refused with CYCLIC_ARTIFACT_PACKAGES', () => {
  const pkg = (id: string, dependencies?: Record<string, string>) => ({
    manifest: { id, name: id, version: '1.0.0', type: 'module', ...(dependencies ? { dependencies } : {}) },
  });

  it('a two-package cycle answers 422 CYCLIC_ARTIFACT_PACKAGES, naming the cycle in the message and in `details.cycle`', () => {
    const refused = refusalOf({
      packages: [pkg('com.example.a', { 'com.example.b': '^1.0.0' }), pkg('com.example.b', { 'com.example.a': '^1.0.0' })],
    });
    expect(refused).toBeInstanceOf(Error);
    expect(refused?.code).toBe('CYCLIC_ARTIFACT_PACKAGES');
    expect(refused?.status).toBe(422);
    expect(refused?.details).toEqual({ cycle: ['com.example.a', 'com.example.b', 'com.example.a'] });
    expect(refused?.message).toContain('"com.example.a" -> "com.example.b" -> "com.example.a"');
  });

  it('the cycle path skips packages outside it, and ignores a dependency on a package the artifact does not carry', () => {
    const refused = refusalOf({
      packages: [
        pkg('com.example.base', { '@external/auth': '^2.0.0' }),
        pkg('com.example.a', { 'com.example.base': '*', 'com.example.c': '*' }),
        pkg('com.example.b', { 'com.example.a': '*' }),
        pkg('com.example.c', { 'com.example.b': '*' }),
      ],
    });
    expect(refused?.code).toBe('CYCLIC_ARTIFACT_PACKAGES');
    expect(refused?.details).toEqual({ cycle: ['com.example.a', 'com.example.c', 'com.example.b', 'com.example.a'] });
  });

  it('control: the same packages without the closing edge resolve in dependency order', () => {
    const resolved = resolveArtifactPackageOrder({
      packages: [pkg('com.example.a', { 'com.example.b': '^1.0.0' }), pkg('com.example.b')],
    }) as Array<{ id: string }>;
    expect(resolved.map((body) => body.id)).toEqual(['com.example.b', 'com.example.a']);
  });
});
