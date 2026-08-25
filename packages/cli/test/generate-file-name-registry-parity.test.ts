// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#11071) — a generated file's NAME matches the pattern the registry
 * declares for its type.
 *
 * ## Why the property and not six string comparisons
 *
 * The defect this closes was six generators writing `NAME.ts` while
 * `DEFAULT_METADATA_TYPE_REGISTRY` declared `NAME.TYPE.ts` for their types,
 * so `MetadataPlugin._loadFromFileSystem` — which globs EVERY registered type
 * by that type's own `filePatterns` — never saw the scaffolds the CLI had
 * just written. They type-check, they pass `os validate`, they publish, and
 * nothing at any step says they were skipped.
 *
 * ⚠️ THAT LOAD PATH HAS A PRECONDITION, and nothing this repo boots meets it
 * (#12075). `_loadFromFileSystem` is reached only when `bootstrap` is `eager`
 * (the default) AND no `artifactSource` is configured; every non-test
 * `MetadataPlugin` construction site here configures one, so `os dev` /
 * `os serve` / `os start` all load the compiled artifact and the barrel's
 * module specifier is the whole load path. `metadata-file-name.ts` carries
 * the measurement, including the discriminator: a file spelled exactly as the
 * registry declares does not reach the artifact when the barrel omits it.
 * So what this file pins is a CONSISTENCY property — generator spelling
 * equals registry spelling — and NOT the discoverability property the
 * paragraph above reads as on its own. The narrower rationale does not weaken
 * the pin: both halves stay derived, for the reason below.
 *
 * A pin written as `expect(name).toBe('customer.object.ts')` six times is
 * green the day a SEVENTH generator is added with no registry entry and no
 * thought about its filename — which is the same defect arriving by the same
 * route. So both halves here are derived: the generator roster comes from
 * `GENERATOR_SCAFFOLD_TARGETS` (built from `GENERATORS`, not typed out), and
 * the contract comes from `filePatterns` read out of the registry at test
 * time. Nothing in this file decides what a correct filename looks like.
 *
 * `matchesGlob` is `node:path`'s, for the reason `generate-skill.e2e.test.ts`
 * gives: hand-rolling a glob matcher would re-introduce the restatement one
 * layer down.
 *
 * ## The anti-vacuity guard in the middle
 *
 * `metadataFileName` reads the INFIX out of the pattern instead of
 * interpolating the type key, because three registry entries do not spell one
 * from the other (`email_template` declares `*.email-template.ts`). Every
 * generator that exists today happens to be a type whose infix and key are
 * identical, so a `${type}` implementation would satisfy the roster pin above
 * completely. The middle describe block is the assertion that catches that,
 * and it starts by proving the corpus it runs over still contains a
 * discriminating case — a pin that can only pass is not a pin.
 */

import { describe, it, expect } from 'vitest';
import { matchesGlob } from 'node:path';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';
import { metadataFileName } from '../src/utils/metadata-file-name.js';

/** The stem `os g <type> <name>` would normalize `customer` to. */
const STEM = 'customer';

/** Registry entries that declare a recursive TypeScript file pattern. */
const TS_TYPED_ENTRIES = DEFAULT_METADATA_TYPE_REGISTRY.filter(entry =>
  entry.filePatterns.some(pattern => /^\*\*\/\*\.[^/]+\.ts$/.test(pattern)),
);

describe('[#11071] every generator writes a name its own type declares', () => {
  it('has generators to measure at all', () => {
    // Guards the `it.each` below against silently iterating nothing if the
    // export ever stops being derived from `GENERATORS`.
    expect(GENERATOR_SCAFFOLD_TARGETS.length).toBeGreaterThan(0);
  });

  it.each(GENERATOR_SCAFFOLD_TARGETS.map(t => [t.type, t.defaultDir] as const))(
    '`os g %s` writes into a path matched by the registry patterns for that type',
    (type, defaultDir) => {
      const entry = DEFAULT_METADATA_TYPE_REGISTRY.find(candidate => candidate.type === type);

      // A generator for a type the registry does not know cannot be checked
      // against a contract, and shipping one is the defect, not a gap here.
      expect(
        entry,
        `\`os g ${type}\` scaffolds a type absent from DEFAULT_METADATA_TYPE_REGISTRY — `
        + 'no entry declares a pattern for it, so whatever it writes matches no contract '
        + 'anything can check',
      ).toBeDefined();

      const written = metadataFileName(type, STEM);
      expect(
        written,
        `no TypeScript file pattern is declared for \`${type}\`, so \`os g ${type}\` `
        + 'has no discoverable name to write',
      ).not.toBeNull();

      const relPath = `${defaultDir}/${written}`;
      const matched = entry!.filePatterns.filter(pattern => matchesGlob(relPath, pattern));

      expect(
        matched.length,
        `generated "${relPath}" matches none of ${JSON.stringify(entry!.filePatterns)} — `
        + 'the CLI would be teaching a name its own registry entry does not declare '
        + '(and under an eager, artifact-less bootstrap it would never load)',
      ).toBeGreaterThan(0);
    },
  );
});

describe('[#11071] the infix is read from the pattern, not rebuilt from the type key', () => {
  it('the registry still contains a type whose infix differs from its key', () => {
    // Without this, the assertion below is satisfied by an implementation that
    // interpolates `${type}` — and the next generator for a kebab-patterned
    // type would land invisible with every test green.
    const discriminating = TS_TYPED_ENTRIES.filter(
      entry => !entry.filePatterns.includes(`**/*.${entry.type}.ts`),
    );
    expect(
      discriminating.map(entry => entry.type),
      'no registry type spells its pattern differently from its key any more — '
      + 'this pin can no longer distinguish a derived infix from an interpolated one',
    ).not.toHaveLength(0);
  });

  it.each(TS_TYPED_ENTRIES.map(entry => [entry.type] as const))(
    'the name derived for `%s` is matched by that entry\'s own patterns',
    (type) => {
      const entry = DEFAULT_METADATA_TYPE_REGISTRY.find(candidate => candidate.type === type)!;
      const written = metadataFileName(type, STEM);

      expect(written).not.toBeNull();
      const matched = entry.filePatterns.filter(pattern => matchesGlob(`src/probe/${written}`, pattern));

      expect(
        matched.length,
        `derived "${written}" for type \`${type}\` matches none of `
        + `${JSON.stringify(entry.filePatterns)}`,
      ).toBeGreaterThan(0);
    },
  );

  it('answers `null` for a type the registry declares no TypeScript pattern for', () => {
    // `doc` is declared as `**/docs/*.md` alone. There is no `.ts` filename to
    // derive, and guessing one is exactly the failure mode this closes — so
    // the derivation refuses and `runMetadataGeneration` exits non-zero
    // naming the type.
    const mdOnly = DEFAULT_METADATA_TYPE_REGISTRY.filter(
      entry => !entry.filePatterns.some(pattern => /^\*\*\/\*\.[^/]+\.ts$/.test(pattern)),
    );
    expect(mdOnly.length).toBeGreaterThan(0);
    for (const entry of mdOnly) {
      expect(metadataFileName(entry.type, STEM), entry.type).toBeNull();
    }
  });

  it('answers `null` for a type that is not in the registry at all', () => {
    expect(metadataFileName('no_such_metadata_type', STEM)).toBeNull();
  });
});
