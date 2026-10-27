// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack, ObjectStackDefinitionSchema } from '@objectstack/spec';
import { checkDeclaredDependencies } from '@objectstack/metadata-core';
import { checkDependencyRanges, deliveredPackages } from './dependency-range-check.js';

/** One package of an artifact, built the way an author writes it. */
function pkg(id: string, version: string, dependencies?: Record<string, string>) {
  return defineStack({
    manifest: {
      id,
      name: id,
      namespace: 'crm',
      version,
      type: id.endsWith('.core') ? 'app' : 'module',
      engines: { protocol: '^18' },
      ...(dependencies ? { dependencies } : {}),
    },
  });
}

/** An ADR-0130 artifact of `packages`, through the parse every door runs. */
function artifact(...packages: ReturnType<typeof pkg>[]): Record<string, unknown> {
  return ObjectStackDefinitionSchema.parse(composeStacks(packages, { manifest: 'preserve' })) as Record<string, unknown>;
}

const codes = (stack: unknown) => checkDependencyRanges(stack).map((d) => [d.code, d.severity]);

describe('checkDependencyRanges — arm 1: an unreadable range', () => {
  it('is an ERROR on an out-of-artifact entry, naming the entry, the range and the grammar', () => {
    const stack = artifact(
      pkg('com.acme.core', '1.0.0'),
      pkg('com.acme.orders', '1.0.0', { 'com.acme.core': '^1.0.0', 'com.vendor.billing': 'latest' }),
    );
    const found = checkDependencyRanges(stack);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: 'dependency_range_unreadable',
      severity: 'error',
      packageId: 'com.acme.orders',
      dependency: 'com.vendor.billing',
      range: 'latest',
      inArtifact: false,
      path: 'packages[1].manifest.dependencies["com.vendor.billing"]',
    });
    expect(found[0]!.fix).toContain('`||` between alternatives');
  });

  it('is an ERROR on a single-package stack, at `manifest.dependencies`', () => {
    const stack = ObjectStackDefinitionSchema.parse(
      pkg('com.acme.orders', '1.0.0', { 'com.vendor.billing': 'one point two' }),
    );
    const found = checkDependencyRanges(stack);
    expect(found.map((d) => [d.code, d.severity, d.path])).toEqual([
      ['dependency_range_unreadable', 'error', 'manifest.dependencies["com.vendor.billing"]'],
    ]);
  });

  it('is a WARNING on a co-delivered entry — the install judges it for presence only', () => {
    const stack = artifact(
      pkg('com.acme.core', '1.0.0'),
      pkg('com.acme.orders', '1.0.0', { 'com.acme.core': 'v-one' }),
    );
    expect(codes(stack)).toEqual([['dependency_range_unreadable', 'warning']]);
    expect(checkDependencyRanges(stack)[0]!.inArtifact).toBe(true);
  });

  it('reads every form of the stated grammar as readable', () => {
    for (const range of ['^1.2.0', '~1.2', '>=1.0.0', '1.x', '*', '1.0.0 - 1.4', '>=1.0.0 <3', '^0.9 || ^1']) {
      const stack = ObjectStackDefinitionSchema.parse(pkg('com.acme.orders', '1.0.0', { 'com.vendor.billing': range }));
      expect(checkDependencyRanges(stack), range).toEqual([]);
    }
  });
});

describe('checkDependencyRanges — arm 2: an in-artifact range the sibling version does not meet', () => {
  it('reports core bumped to 2.0.0 while a module still declares ^1.0.0, as a WARNING naming both sides', () => {
    const stack = artifact(
      pkg('com.acme.core', '2.0.0'),
      pkg('com.acme.orders', '1.0.0', { 'com.acme.core': '^1.0.0' }),
    );
    const found = checkDependencyRanges(stack);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: 'dependency_range_unmet_in_artifact',
      severity: 'warning',
      packageId: 'com.acme.orders',
      dependency: 'com.acme.core',
      range: '^1.0.0',
      siblingVersion: '2.0.0',
      inArtifact: true,
      path: 'packages[1].manifest.dependencies["com.acme.core"]',
    });
  });

  it('is silent when the sibling version is inside the range, whatever the package order', () => {
    expect(codes(artifact(
      pkg('com.acme.orders', '1.0.0', { 'com.acme.core': '^1.0.0' }),
      pkg('com.acme.core', '1.4.2'),
    ))).toEqual([]);
  });

  it('reports a sibling whose version is outside the version grammar, as a WARNING on the version side', () => {
    const stack = artifact(
      pkg('com.acme.core', '2.0.0-beta.1'),
      pkg('com.acme.orders', '1.0.0', { 'com.acme.core': '^2.0.0' }),
    );
    expect(codes(stack)).toEqual([['dependency_version_unreadable_in_artifact', 'warning']]);
  });

  it('does not judge an out-of-artifact entry it can read — the target environment decides that', () => {
    expect(codes(artifact(
      pkg('com.acme.core', '1.0.0'),
      pkg('com.acme.orders', '1.0.0', { 'com.vendor.billing': '^3.0.0' }),
    ))).toEqual([]);
  });
});

describe('checkDependencyRanges — the errors are exactly what the install door refuses', () => {
  // The install door's own call, spelled as `marketplace-install-local-plugin.ts`
  // makes it, against an EMPTY environment: its environment-independent
  // refusals (an unreadable range, an unreadable declaration) are the set this
  // check may refuse at build. `absent` depends on the environment and is the
  // install's alone. If the two sets ever differ, `os build` refuses what the
  // platform installs, or emits what it refuses.
  const installDoorRefusals = (stack: Record<string, unknown>) =>
    checkDeclaredDependencies({
      delivered: Array.isArray(stack.packages)
        ? (stack.packages as Array<{ manifest: Record<string, unknown> }>).map((entry) => entry.manifest)
        : [stack.manifest as Record<string, unknown>],
      getInstalled: () => undefined,
    })
      .filter((u) => u.found === 'unreadable-range' || u.found === 'unreadable-declaration')
      .map((u) => [u.packageId, 'dependency' in u ? u.dependency : null]);

  const cases: Array<[string, Record<string, unknown>]> = [
    ['an unreadable out-of-artifact range', artifact(
      pkg('com.acme.core', '1.0.0'),
      pkg('com.acme.orders', '1.0.0', { 'com.acme.core': '^1.0.0', 'com.vendor.billing': 'latest' }),
    )],
    ['an unreadable co-delivered range', artifact(
      pkg('com.acme.core', '1.0.0'),
      pkg('com.acme.orders', '1.0.0', { 'com.acme.core': 'v-one' }),
    )],
    ['an in-artifact mismatch', artifact(
      pkg('com.acme.core', '2.0.0'),
      pkg('com.acme.orders', '1.0.0', { 'com.acme.core': '^1.0.0' }),
    )],
    ['a single package', ObjectStackDefinitionSchema.parse(
      pkg('com.acme.orders', '1.0.0', { 'com.vendor.billing': '>=x', 'com.vendor.crm': '^2' }),
    ) as Record<string, unknown>],
  ];

  for (const [name, stack] of cases) {
    it(`agrees on ${name}`, () => {
      const errors = checkDependencyRanges(stack)
        .filter((d) => d.severity === 'error')
        .map((d) => [d.packageId, d.dependency ?? null]);
      expect(errors).toEqual(installDoorRefusals(stack));
    });
  }
});

describe('deliveredPackages', () => {
  it('reads `packages[]` bodies and never the artifact wrapper manifest', () => {
    const stack = artifact(pkg('com.acme.core', '1.0.0'), pkg('com.acme.orders', '1.0.0'));
    expect(deliveredPackages(stack).map((p) => [p.manifest.id, p.at])).toEqual([
      ['com.acme.core', 'packages[0].manifest'],
      ['com.acme.orders', 'packages[1].manifest'],
    ]);
  });

  it('reads the top-level manifest when there is no `packages[]`, and nothing from a non-stack', () => {
    expect(deliveredPackages({ manifest: { id: 'a' } }).map((p) => p.at)).toEqual(['manifest']);
    expect(deliveredPackages(null)).toEqual([]);
    expect(deliveredPackages({})).toEqual([]);
  });

  it('reports a `dependencies` that is not a record as an ERROR (the normalized tier `os lint` reads)', () => {
    expect(codes({ manifest: { id: 'com.acme.orders', dependencies: ['com.acme.core'] } }))
      .toEqual([['dependency_declaration_unreadable', 'error']]);
  });
});
