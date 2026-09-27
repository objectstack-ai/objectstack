// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `packages: null` is answered by core's resolver, never by the CLI (#19925).
 *
 * Ruling A on #19926 (`5805260775`) makes `null` malformed at every reader:
 * `resolveArtifactPackageOrder` (`@objectstack/core`) drops its `null` branch
 * and refuses `null` the way it refuses any other non-array. That core change
 * lands separately (#19926). The CLI's four package readers must pick it up
 * with no CLI edit, so none of them may answer `null` on its own. They all go
 * through `declaredPackageEntries`, which hands `null` to the resolver and
 * reads the resolver's answer.
 *
 * Two legs, because one of them alone proves nothing today:
 *
 * 1. THE REAL RESOLVER. Each reader's answer for `null` is whatever the
 *    resolver answers for `{ packages: null }`. Before the core change that is
 *    the resolver's absent answer, so each reader answers as for an absent key.
 *    After it, that is a refusal, so each reader raises the same envelope. The
 *    leg is written against the resolver's live verdict, so it holds on both
 *    sides of the core change. But today a private `null`-as-absent branch in
 *    the CLI gives the same answers, so this leg cannot see one.
 * 2. A RESOLVER THAT REFUSES `null`, standing in for the core change. The
 *    double wraps the real resolver and changes one thing: it refuses `null`
 *    with the non-array envelope. Every reader must then refuse. A private
 *    `null` branch in the CLI never asks the resolver, so this leg goes red on
 *    one.
 *
 * Every other call reaches the real resolver unchanged. The double is armed
 * inside leg 2 only and restored after each test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveArtifactPackageOrder } from '@objectstack/core';

import { lintConfig } from '../src/commands/lint';
import { attachPackageDocs, collectDocsFromSrc, docsPackageRefs, type PackageDocSet } from '../src/utils/collect-docs';
import { collectMetadataStats } from '../src/utils/format';
import { authoringRuleUnionStack, resolveStackCollection } from '../src/utils/stack-collections';

vi.mock('@objectstack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@objectstack/core')>();
  return { ...actual, resolveArtifactPackageOrder: vi.fn(actual.resolveArtifactPackageOrder) };
});

/** The resolver as core ships it, captured before any test arms the double. */
const realResolver = vi.mocked(resolveArtifactPackageOrder).getMockImplementation()!;

const MANIFEST = {
  id: 'com.example.probe',
  name: 'probe',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'probe',
  engines: { protocol: '^17' },
};

const stackWith = (packages: unknown) => ({ manifest: MANIFEST, packages });

const docSet = (): PackageDocSet[] => [{
  index: 0,
  id: MANIFEST.id,
  namespace: MANIFEST.namespace,
  dir: 'src/probe/docs',
  docs: [{ name: 'probe_guide', label: 'Guide', content: '# Guide' }],
}];

/** A config path whose `src/` does not exist: nothing on disk is read. */
const CONFIG_PATH = '/nonexistent-19925/objectstack.config.ts';

/** How a call ended: the value it returned, or the envelope it raised. */
type Outcome =
  | { kind: 'answered'; value: unknown }
  | { kind: 'refused'; code: unknown; status: unknown };

function outcomeOf(call: () => unknown): Outcome {
  try {
    return { kind: 'answered', value: call() };
  } catch (error) {
    expect(error, 'a refusal is an Error carrying the envelope').toBeInstanceOf(Error);
    const { code, status } = error as { code?: unknown; status?: unknown };
    return { kind: 'refused', code, status };
  }
}

/**
 * Each reader, called on `null`, reduced to a value that compares by
 * equality. `absent` is the same reduction for the key left out.
 */
const READERS: ReadonlyArray<{ name: string; onNull: () => unknown; absent: () => unknown }> = [
  {
    name: 'packageBodies via resolveStackCollection',
    onNull: () => resolveStackCollection(stackWith(null), 'objects'),
    absent: () => resolveStackCollection({ manifest: MANIFEST }, 'objects'),
  },
  {
    name: 'packageBodies via authoringRuleUnionStack (returns the stack by identity when nothing folds)',
    onNull: () => { const s = stackWith(null); return authoringRuleUnionStack(s) === s; },
    absent: () => { const s = { manifest: MANIFEST }; return authoringRuleUnionStack(s) === s; },
  },
  {
    name: '`os info` collectMetadataStats',
    onNull: () => collectMetadataStats(stackWith(null)).objects,
    absent: () => collectMetadataStats({ manifest: MANIFEST }).objects,
  },
  {
    name: '`os lint` lintConfig',
    onNull: () => lintConfig(stackWith(null)).map((issue) => issue.rule),
    absent: () => lintConfig({ manifest: MANIFEST }).map((issue) => issue.rule),
  },
  {
    name: 'docsPackageRefs',
    onNull: () => docsPackageRefs(null),
    absent: () => docsPackageRefs(undefined),
  },
  {
    name: 'docsPackageRefs via collectDocsFromSrc',
    onNull: () => collectDocsFromSrc(CONFIG_PATH, null).packageDocs,
    absent: () => collectDocsFromSrc(CONFIG_PATH, undefined).packageDocs,
  },
  {
    name: 'attachPackageDocs (hands an absent argument back by identity)',
    onNull: () => attachPackageDocs(null, docSet()) === null,
    absent: () => attachPackageDocs(undefined, docSet()) === undefined,
  },
];

afterEach(() => {
  vi.mocked(resolveArtifactPackageOrder).mockReset();
  vi.mocked(resolveArtifactPackageOrder).mockImplementation(realResolver);
});

describe('#19925 leg 1: each reader answers `packages: null` the way the real resolver does', () => {
  // The live verdict, taken once. Its absent answer holds the probe itself.
  const probe = { packages: null };
  const verdict = outcomeOf(() => realResolver(probe));

  it('the resolver answers `null` either as absent or with the non-array refusal', () => {
    if (verdict.kind === 'answered') {
      expect(verdict.value).toEqual([probe]);
      expect((verdict.value as unknown[])[0]).toBe(probe);
    } else {
      expect(verdict.code).toBe('INVALID_ARTIFACT_PACKAGES');
      expect(verdict.status).toBe(422);
    }
  });

  it.each(READERS)('$name', ({ onNull, absent }) => {
    const got = outcomeOf(onNull);
    if (verdict.kind === 'refused') {
      expect(got).toEqual({ kind: 'refused', code: verdict.code, status: verdict.status });
    } else {
      expect(got).toEqual({ kind: 'answered', value: absent() });
    }
  });
});

describe('#19925 leg 2: with a resolver that refuses `null`, every reader refuses it', () => {
  it.each(READERS)('$name', ({ onNull }) => {
    vi.mocked(resolveArtifactPackageOrder).mockImplementation((artifact: unknown) => {
      if ((artifact as { packages?: unknown } | null | undefined)?.packages === null) {
        throw Object.assign(new Error('packages is null (the resolver double)'), {
          code: 'INVALID_ARTIFACT_PACKAGES',
          status: 422,
        });
      }
      return realResolver(artifact);
    });

    expect(outcomeOf(onNull)).toEqual({ kind: 'refused', code: 'INVALID_ARTIFACT_PACKAGES', status: 422 });
  });

  it('control: an absent key never reaches the double, and still reads as no packages', () => {
    vi.mocked(resolveArtifactPackageOrder).mockImplementation(() => {
      throw new Error('the double must not be reached for an absent key');
    });

    expect(docsPackageRefs(undefined)).toEqual([]);
    expect(resolveStackCollection({ manifest: MANIFEST }, 'objects')).toEqual([]);
  });
});
