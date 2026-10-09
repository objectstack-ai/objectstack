// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `packages` that is present but is not an array is REFUSED by every
 * `@objectstack/cli` reader of it, never read as "no packages" (#19925).
 *
 * The rule is ruling A on #15293: `{}`, `0` and `'x'` are malformed, not
 * absent. It is stated once, beside `AssembledPackageBodySchema`
 * (`@objectstack/spec`), and enforced once, by `resolveArtifactPackageOrder`
 * (`@objectstack/core`), as `INVALID_ARTIFACT_PACKAGES`. The runtime, core and
 * the plugin readers already refused it. The CLI readers answered `[]` or
 * handed the value back unchanged, so `os info` printed `0` objects for such a
 * stack and `os lint` passed it with exit 0. Both were measured from a
 * hand-written config exported as a plain object, which reaches the command
 * without `defineStack`'s parse.
 *
 * Each reader is pinned through the entry its door calls:
 *
 * - `packageBodies` (private) through `resolveStackCollection` and
 *   `authoringRuleUnionStack`, and through the two door functions that reach
 *   it first: `collectMetadataStats` (`os info`) and `lintConfig` (`os lint`).
 * - `docsPackageRefs`, directly and through `collectDocsFromSrc`, the
 *   collection step `os serve` / `os build` / `os lint` run.
 * - `attachPackageDocs`, directly.
 * - `bodyDocsOf` (private) has one caller, and that caller has already handed
 *   the same value to `docsPackageRefs`, so a non-array cannot reach it
 *   through any export. It goes through the same judgment and is not pinned
 *   separately.
 *
 * Every refusal asserts the ADR-0112 envelope (`code` + `status`), never a bare
 * `toThrow()`, which an unnamed `Error` would also satisfy. The lit control is a
 * malformed ENTRY, refused as `INVALID_ARTIFACT_PACKAGE_ENTRY` through the same
 * entries. The other controls are a well-formed array, which reads as before,
 * and an absent `packages`, which still reads as no packages.
 *
 * `packages: null` is pinned in `null-packages-follows-resolver.test.ts`, not
 * here. Ruling A on #19926 (`5805260775`) makes `null` malformed at every
 * reader, and it is refused by core's resolver, never by the CLI. So the pin
 * there asserts that each reader answers `null` the way the resolver does. It
 * does not assert a fixed answer.
 */

import { describe, expect, it } from 'vitest';

import { lintConfig } from '../src/commands/lint';
import { attachPackageDocs, collectDocsFromSrc, docsPackageRefs, type PackageDocSet } from '../src/utils/collect-docs';
import { collectMetadataStats } from '../src/utils/format';
import { authoringRuleUnionStack, resolveStackCollection } from '../src/utils/stack-collections';

const MANIFEST = {
  id: 'com.example.probe',
  name: 'probe',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'probe',
  engines: { protocol: '^18' },
};

const PROBE_OBJECT = {
  name: 'probe_account',
  label: 'Probe Account',
  sharingModel: 'private' as const,
  fields: { name: { name: 'name', type: 'text' as const, label: 'Name' } },
};

/** The three spellings ruling A names. */
const NON_ARRAYS: ReadonlyArray<readonly [string, unknown]> = [
  ['{}', {}],
  ['0', 0],
  ["'x'", 'x'],
];

/** One well-formed entry, as `resolveArtifactPackageOrder` parses it whole. */
const wellFormed = () => [{ manifest: { ...MANIFEST, objects: [PROBE_OBJECT] } }];

/** The lit control: a body inlined onto the array element, not wrapped. */
const inlinedEntry = () => [{ ...MANIFEST, objects: [PROBE_OBJECT] }];

/** A stack whose ONLY answer to "which objects" has to come from `packages`. */
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

/** The ADR-0112 envelope a call raised, or `undefined` when it returned. */
function refusalOf(call: () => unknown): { code?: unknown; status?: unknown } | undefined {
  try {
    call();
  } catch (error) {
    expect(error, 'the refusal is an Error carrying the envelope').toBeInstanceOf(Error);
    return error as { code?: unknown; status?: unknown };
  }
  return undefined;
}

function expectRefused(call: () => unknown, code: string): void {
  const refusal = refusalOf(call);
  expect(refusal, `expected a ${code} refusal, got an answer`).toBeDefined();
  expect(refusal?.code).toBe(code);
  expect(refusal?.status).toBe(422);
}

describe('#19925: a present non-array `packages` is refused by every CLI reader', () => {
  describe.each(NON_ARRAYS)('packages: %s', (_label, packages) => {
    it('packageBodies refuses through resolveStackCollection and authoringRuleUnionStack', () => {
      expectRefused(() => resolveStackCollection(stackWith(packages), 'objects'), 'INVALID_ARTIFACT_PACKAGES');
      expectRefused(() => authoringRuleUnionStack(stackWith(packages)), 'INVALID_ARTIFACT_PACKAGES');
    });

    it('`os info` (collectMetadataStats) and `os lint` (lintConfig) refuse instead of answering', () => {
      expectRefused(() => collectMetadataStats(stackWith(packages)), 'INVALID_ARTIFACT_PACKAGES');
      expectRefused(() => lintConfig(stackWith(packages)), 'INVALID_ARTIFACT_PACKAGES');
    });

    it('docsPackageRefs refuses, directly and through collectDocsFromSrc', () => {
      expectRefused(() => docsPackageRefs(packages), 'INVALID_ARTIFACT_PACKAGES');
      expectRefused(() => collectDocsFromSrc(CONFIG_PATH, packages), 'INVALID_ARTIFACT_PACKAGES');
    });

    it('attachPackageDocs refuses rather than handing the value back', () => {
      expectRefused(() => attachPackageDocs(packages, docSet()), 'INVALID_ARTIFACT_PACKAGES');
    });
  });
});

describe('#19925 controls: the same entries still read the well-formed and absent shapes', () => {
  it('a well-formed array reads as before', () => {
    expect(resolveStackCollection(stackWith(wellFormed()), 'objects')).toEqual([PROBE_OBJECT]);
    expect(collectMetadataStats(stackWith(wellFormed())).objects).toBe(1);
    expect(docsPackageRefs(wellFormed()).map((ref) => ref.id)).toEqual([MANIFEST.id]);
    expect(collectDocsFromSrc(CONFIG_PATH, wellFormed()).packageDocs).toEqual([]);

    const attached = attachPackageDocs(wellFormed(), docSet()) as Array<{ manifest: { docs?: unknown[] } }>;
    expect(attached[0].manifest.docs).toEqual(docSet()[0].docs);
  });

  it('an empty array reads as no packages, and attachPackageDocs hands it back by identity', () => {
    const empty: unknown[] = [];
    expect(resolveStackCollection(stackWith(empty), 'objects')).toEqual([]);
    expect(docsPackageRefs(empty)).toEqual([]);
    expect(attachPackageDocs(empty, docSet())).toBe(empty);
  });

  it('an absent `packages` still reads as no packages', () => {
    const absent = { manifest: MANIFEST };
    expect(resolveStackCollection(absent, 'objects')).toEqual([]);
    expect(authoringRuleUnionStack(absent)).toBe(absent);
    expect(collectMetadataStats(absent).objects).toBe(0);
    expect(docsPackageRefs(undefined)).toEqual([]);
    expect(attachPackageDocs(undefined, docSet())).toBeUndefined();
  });

  it('lit control: a malformed ENTRY is refused through the same entries, with its own code', () => {
    expectRefused(() => resolveStackCollection(stackWith(inlinedEntry()), 'objects'), 'INVALID_ARTIFACT_PACKAGE_ENTRY');
    expectRefused(() => collectMetadataStats(stackWith(inlinedEntry())), 'INVALID_ARTIFACT_PACKAGE_ENTRY');
    expectRefused(() => lintConfig(stackWith(inlinedEntry())), 'INVALID_ARTIFACT_PACKAGE_ENTRY');
  });
});
