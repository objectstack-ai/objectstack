/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6285 — `CURATED_CAPABILITY_LABELS` equals `@objectstack/spec/security`'s
 * `PLATFORM_CAPABILITIES`, and every member of it reaches the screen as a
 * localized label.
 *
 * ## What went wrong, and why nothing caught it
 *
 * The declaration was a seven-member list under a doc comment claiming it
 * mirrored `PLATFORM_CAPABILITIES`. The spec grew an eighth member
 * (`manage_sharing`) and the list did not follow, so that capability fell
 * through to `byName.get(name)?.label` — the English label the capability
 * registry serves — and rendered untranslated in all ten packs, beside seven
 * siblings that localize. Every gate stayed green, and the reason is exact:
 * `scripts/check-i18n-call-site-keys.mjs` reads this declaration as the
 * `capability.label.` family's vocabulary and checks that each member it names
 * has an `en` key. All seven did. No instrument compared the vocabulary to the
 * array it was named after, so the member the list never mentioned was invisible
 * to the entire toolchain.
 *
 * This file is that missing comparison. It is the reason the list is allowed to
 * stay a repo-local literal (see the declaration's own comment for why a runtime
 * derivation was measured and declined), and it is deliberately the same shape
 * as `packages/app-shell/src/hooks/__tests__/tenancyPostureWall.parity.test.ts`:
 * a local restatement, held to the protocol by a test that imports the protocol.
 * Tests are not bundled, so the assertion is free.
 *
 * ## Two layers, and both are needed
 *
 *   - SOURCE parity — the member set equals the spec's names, in both
 *     directions. Read with the i18n gate's OWN `readVocabulary`, so what this
 *     file pins is precisely what that gate consumes; a rewrite that made the
 *     declaration unreadable to the gate would fail here first, instead of
 *     silently downgrading the gate to a prefix check.
 *   - RENDERED parity — each member resolves to a real localized string on
 *     screen. Source parity alone would pass with the label table empty, and the
 *     `en` table alone says nothing about `useFieldTranslation`'s provider-less
 *     defaults map, which is what actually renders when no I18nProvider is
 *     mounted.
 *
 * Every registry row fed in below carries a label deliberately UNLIKE the
 * localized one (`REGISTRY …`). "The picker renders" passes in both worlds; each
 * assertion here is written to fail in exactly one. If the list regressed — or
 * if `labelFor`'s `defaultValue` fallback were doing the rendering instead of a
 * real translation — `REGISTRY …` is what would appear, and the equality reports
 * it by name.
 *
 * The dotted members are their own case. The spec spells `setup.access`,
 * `setup.write` and `studio.access` with a dot; the keys spell them with an
 * underscore, and `labelFor` bridges that with `name.replace(/\./g, '_')`. The
 * transform is restated in this file ON PURPOSE rather than imported from the
 * widget: a pin that shares the implementation's own helper moves when the
 * implementation moves and pins nothing.
 *
 * ## PREDICTIONS, written before the run
 *
 * On this branch: all green. Against the pre-fix declaration (seven members, no
 * `capability.label.manage_sharing` key), expected RED on source parity, on the
 * `en`-coverage assertion, and on the two rendering assertions that name
 * `manage_sharing`; expected GREEN on the dotted-member, orphan and non-vacuity
 * assertions, which describe behaviour the seven-member list already had.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import '@testing-library/jest-dom';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import { builtInLocales } from '@object-ui/i18n/locales';
// The i18n gate's own source reader (objectui#4964). Importing it — rather than
// re-implementing a regex — is what makes "the vocabulary that gate consumes"
// and "the thing this file pins" the same object. Plain JS, untyped here, the
// same arrangement `packages/layout/src/__tests__/readme-registration-keys.test.ts`
// uses for `scripts/component-registrations.mjs`.
// @ts-expect-error — plain-JS shared helper, intentionally untyped
import { readVocabulary } from '../../../../scripts/check-i18n-call-site-keys.mjs';
import { CapabilityMultiSelectField } from './CapabilityMultiSelectField';

/**
 * The root `readVocabulary` resolves `module` against, derived from THIS FILE's
 * own location — never from the process cwd (objectui#7791).
 *
 * It was `'.'` until then, on the reasoning that cwd IS the repo root because
 * `scripts/vitest-invocation-guard.mjs` refuses any invocation whose vitest root
 * is not the repo root. That guard is real, but it is a DIFFERENT invariant:
 * `--root` moves VITEST's root and moves nothing about `process.cwd()`. This
 * package's own `test` script — `vitest run --root ../.. packages/fields/`,
 * which is what `pnpm --filter @object-ui/fields test` and `turbo run test` both
 * run — leaves cwd at `packages/fields/`, so the read resolved against the
 * package directory, missed, and `declaredMembers()` threw. Two of that
 * message's three disjuncts read as a regression in
 * `CapabilityMultiSelectField.tsx`, so the false RED actively sent its reader
 * hunting a defect that was not there. Measured on one tree with cwd as the only
 * variable: 7 passed from the repo root, 2 failed / 5 passed from the package
 * directory.
 *
 * `SELF_DEPTH_BELOW_REPO_ROOT` is the same walk the `readVocabulary` import above
 * already spells as `../../../../`, and what both ends of that gate already do:
 * `scriptDir` in `scripts/check-i18n-call-site-keys.mjs`, `repoRoot` in
 * `scripts/__tests__/check-i18n-call-site-keys.test.ts`. The pin now reaches one
 * verdict under every cwd, which is the property it always wanted.
 *
 * ## Why the derivation is spelled in string operations
 *
 * Both of the shorter spellings were MEASURED here and both are traps in this
 * package's `dom` project:
 *
 *   - `dirname(fileURLToPath(import.meta.url))` — the form the two files above
 *     use — does not type-check here. They are `.test.ts` in the `unit` project;
 *     this is a `.test.tsx`, and `tsconfig.test.json` names no `types` (see its
 *     header for why that is deliberate), so `node:path`/`node:url` are TS2591.
 *     A test file is not the place to change that program.
 *   - `new URL('../../../..', import.meta.url)` is a form VITE REWRITES. In this
 *     very file it evaluates to `http://localhost:3000/@fs/…`, a dev-server URL,
 *     under BOTH cwds — a false red would have become a suite that does not load
 *     at all. Bare `import.meta.url` is left alone by that transform, which is
 *     why it is read on its own and taken apart by hand.
 *
 * Skipping the case when the file cannot be read was never an option: a
 * conditional skip is how a case stops running on precisely the machines where
 * it would have fired.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / fields / src / widgets / this file
const VOCABULARY_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');

/** The registry entry `check-i18n-call-site-keys.mjs` declares for this family. */
const VOCABULARY = {
  module: 'packages/fields/src/widgets/CapabilityMultiSelectField.tsx',
  name: 'CURATED_CAPABILITY_LABELS',
  kind: 'set',
} as const;

/**
 * The dot -> underscore transform `labelFor` applies before building the key.
 * Deliberately a second statement of it (see the header).
 */
const keyPart = (specName: string) => specName.replace(/\./g, '_');

/** Spec member names in the alphabet the i18n keys are written in. */
const specKeyParts = () => PLATFORM_CAPABILITIES.map((c) => keyPart(c.name)).sort();

/** The declaration, read exactly as the i18n gate reads it. */
const declaredMembers = (): string[] => {
  const members = readVocabulary(VOCABULARY_ROOT, VOCABULARY) as string[] | null;
  if (members === null) {
    throw new Error(
      `${VOCABULARY.name} is unreadable as a \`${VOCABULARY.kind}\` in ${VOCABULARY.module} — ` +
        'either the declaration moved, was renamed, or was rewritten into a shape the i18n ' +
        'gate cannot parse (which would silently downgrade `capability.label.` to a prefix ' +
        `check), or THIS file moved and \`${VOCABULARY_ROOT}\` is no longer the repo root. ` +
        'It is NOT the cwd: this root is derived from `import.meta.url` (objectui#7791).',
    );
  }
  return [...members].sort();
};

/** The `en` pack's `capability.label` table, or a loud failure if it moved. */
const enLabels = (): Record<string, unknown> => {
  const capability = (builtInLocales.en as Record<string, unknown>).capability as
    | { label?: unknown }
    | undefined;
  const node = capability?.label;
  if (!node || typeof node !== 'object') {
    throw new Error('en.capability.label is missing — the label table moved or was renamed');
  }
  return node as Record<string, unknown>;
};

/**
 * One capability registry item per declared platform capability (objectui#7611:
 * the picker lists the registry), each carrying a label that is NOT the
 * localized one. Any assertion that reads `REGISTRY …`
 * back has caught the widget falling through to the registry.
 */
const registryRows = () =>
  PLATFORM_CAPABILITIES.map((c) => ({
    name: c.name,
    label: `REGISTRY ${c.label}`,
    description: c.description,
    scope: c.scope,
  }));

/** The console metadata store, serving `items` as the `capability` registry. */
const metadataStore = (items: unknown[]) =>
  ({
    apps: [], objects: [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: vi.fn(async (type: string) => (type === 'capability' ? items : [])),
    getItem: async () => null,
    getItemsByType: () => [],
  }) as unknown as MetadataContextValue;

const renderPicker = (items: unknown[]) =>
  render(
    <MetadataCtx.Provider value={metadataStore(items)}>
      <CapabilityMultiSelectField
        value={'[]'}
        onChange={vi.fn()}
        field={{ name: 'system_permissions' } as any}
      />
    </MetadataCtx.Provider>,
  );

describe('the curated capability set is PLATFORM_CAPABILITIES (objectui#6285)', () => {
  it('reads a non-empty vocabulary, spec array and label table', () => {
    // The positive control for every set-difference and every loop below. Each
    // of them passes vacuously if its side resolved to nothing, and a vacuous
    // pass reads exactly like a real one. Counts are floors, not pins: pinning
    // today's 8 would re-create the hand-maintained copy this file exists to
    // hold in check.
    expect(PLATFORM_CAPABILITIES.length).toBeGreaterThan(5);
    expect(declaredMembers().length).toBeGreaterThan(5);
    expect(Object.keys(enLabels()).length).toBeGreaterThan(5);
  });

  it('declares exactly the spec\'s capability names, in both directions', () => {
    // The assertion the `Mirrors` comment used to make in prose. `toEqual` on
    // two sorted arrays fails on a member the spec added and this list lacks
    // (the defect this card is) AND on one this list kept after the spec dropped
    // it, which no rendering assertion can see.
    expect(declaredMembers()).toEqual(specKeyParts());
  });

  it('`en` carries a label for every declared platform capability', () => {
    // Membership alone is not enough: a member with no key renders the registry
    // label through `labelFor`'s `defaultValue` — quietly, and in every locale
    // at once. This is the half that fails when the spec grows a member and
    // nobody authors the translation.
    const labels = enLabels();
    const missing = specKeyParts().filter(
      (k) => typeof labels[k] !== 'string' || !(labels[k] as string).trim(),
    );
    expect(missing).toEqual([]);
  });

  it('has no orphan label left behind by a capability the spec removed', () => {
    const declared = new Set(specKeyParts());
    expect(Object.keys(enLabels()).filter((k) => !declared.has(k))).toEqual([]);
  });

  it('renders `manage_sharing` as its localized label, not the registry English', async () => {
    // The member the seven-name list was missing. Red before the fix: the picker
    // rendered `REGISTRY Manage Sharing`.
    renderPicker(registryRows());
    const expected = enLabels()[keyPart('manage_sharing')] as string;
    expect(await screen.findByRole('button', { name: expected })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'REGISTRY Manage Sharing' }),
    ).not.toBeInTheDocument();
  });

  it('still resolves the three dotted spec names through the underscore keys', async () => {
    renderPicker(registryRows());
    const dotted = PLATFORM_CAPABILITIES.filter((c) => c.name.includes('.'));
    // Not pinned to exactly 3: a count is the hand-maintained copy this file
    // exists to retire. The floor is only here so the loop cannot pass vacuously.
    expect(dotted.length).toBeGreaterThanOrEqual(3);
    for (const cap of dotted) {
      const expected = enLabels()[keyPart(cap.name)] as string;
      expect(await screen.findByRole('button', { name: expected })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: `REGISTRY ${cap.label}` }),
      ).not.toBeInTheDocument();
    }
  });

  it('renders every declared platform capability as its localized label', async () => {
    // The whole vocabulary in one sweep, and the assertion that ties the
    // provider-less defaults map to the `en` pack: this render mounts no
    // I18nProvider, so the string on screen comes from `FIELD_DEFAULTS`, while
    // the expectation is read out of `en`. They must agree member by member.
    renderPicker(registryRows());
    const expectedNames = PLATFORM_CAPABILITIES.map((c) => enLabels()[keyPart(c.name)] as string);
    await screen.findByRole('button', { name: expectedNames[0] });
    for (const name of expectedNames) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // And nothing fell through to the registry.
    expect(screen.queryAllByRole('button', { name: /^REGISTRY / })).toEqual([]);
  });
});
