import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494.
import { analyze, globMatcher, normalizePrivatePackages } from '../check-changeset-fixed.mjs';

/**
 * `scripts/check-changeset-fixed.mjs` used to answer one question — is every
 * workspace package in `fixed` or `ignore`? — and that question was complete
 * only while private packages released like public ones.
 *
 * `@changesets/cli@3` ended that. Measured against `@changesets/config@4.0.0`:
 * an omitted `privatePackages` defaulted to `{ version: true, tag: false }`
 * under v2 and defaults to `{ version: false, tag: false }` under v3, and
 * `version: false` marks private packages IGNORED rather than merely unbumped.
 * This repo keeps one private package inside the 40-name `fixed` group —
 * `object-ui` at `packages/vscode-extension`, which ships to the VS Code
 * marketplace instead of npm — so under the new default a changeset naming it
 * next to a published package becomes a "mixed changeset" and both
 * `changeset status` and `changeset version` exit 1.
 *
 * The stock pending during the v3 migration contained exactly one such file,
 * `.changeset/no-console-lint-rule.md` (`object-ui` plus four published
 * packages), so the bump alone would have stopped the release lane on the very
 * next push to `main`. Nothing in PR CI could have reported it: no PR workflow
 * runs `changeset status` or `changeset version`, the only invocation being
 * `.github/workflows/changeset-release.yml`.
 *
 * These tests are the lock on the two rules added for that: the key must be
 * declared, and `fixed` membership must not contradict it.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const pkg = (name: string, isPrivate = false) => ({
  name,
  path: `packages/${name}/package.json`,
  private: isPrivate,
});

describe('normalizePrivatePackages', () => {
  it('reports an absent key as absent rather than defaulting it', () => {
    // The whole point of rule 2: v2 and v3 default the same silence to opposite
    // values, so "not written down" has to be distinguishable from "written
    // down as false".
    expect(normalizePrivatePackages(undefined)).toBeNull();
    expect(normalizePrivatePackages(null)).toBeNull();
  });

  it('expands the boolean shorthand to both fields, as @changesets/config@4 does', () => {
    expect(normalizePrivatePackages(true)).toEqual({ version: true, tag: true });
    expect(normalizePrivatePackages(false)).toEqual({ version: false, tag: false });
  });

  it('defaults each missing field of an object form to false', () => {
    expect(normalizePrivatePackages({ version: true })).toEqual({ version: true, tag: false });
    expect(normalizePrivatePackages({ version: true, tag: false })).toEqual({
      version: true,
      tag: false,
    });
  });
});

describe('globMatcher', () => {
  it('expands a `*` the way changesets expands `ignore` and `fixed` entries', () => {
    const matches = globMatcher(['@object-ui/example-*', '@object-ui/site']);
    expect(matches('@object-ui/example-hello-world')).toBe(true);
    expect(matches('@object-ui/site')).toBe(true);
    expect(matches('@object-ui/core')).toBe(false);
  });

  it('does not let regex metacharacters in a package name match loosely', () => {
    expect(globMatcher(['@object-ui/core'])('@object-uixcore')).toBe(false);
  });
});

describe('analyze', () => {
  const config = {
    fixed: [['@object-ui/core', 'object-ui']],
    ignore: ['@object-ui/example-*'],
  };
  const manifests = [pkg('@object-ui/core'), pkg('object-ui', true)];

  it('passes a private fixed-group member when privatePackages.version is true', () => {
    const result = analyze({ ...config, privatePackages: { version: true, tag: false } }, manifests);
    expect(result.unclassified).toEqual([]);
    expect(result.privateInFixed).toEqual([]);
    expect(result.privatePackages).toEqual({ version: true, tag: false });
  });

  it('flags a private fixed-group member when privatePackages.version is false', () => {
    // The measured failure mode: `fixed` says "version in lockstep", the key
    // says "ignored", and changesets reports neither until a changeset names
    // this package beside a published one.
    const result = analyze(
      { ...config, privatePackages: { version: false, tag: false } },
      manifests
    );
    expect(result.privateInFixed.map((p) => p.name)).toEqual(['object-ui']);
  });

  it('treats an undeclared privatePackages as undeclared, and still flags the contradiction', () => {
    const result = analyze(config, manifests);
    expect(result.privatePackages).toBeNull();
    expect(result.privateInFixed.map((p) => p.name)).toEqual(['object-ui']);
  });

  it('leaves a private package alone when it is ignored rather than fixed', () => {
    const result = analyze(
      { fixed: [['@object-ui/core']], ignore: ['@object-ui/example-*'], privatePackages: false },
      [pkg('@object-ui/core'), pkg('@object-ui/example-hello-world', true)]
    );
    expect(result.unclassified).toEqual([]);
    expect(result.privateInFixed).toEqual([]);
  });

  it('reports a package that is in neither `fixed` nor `ignore`', () => {
    const result = analyze({ ...config, privatePackages: { version: true, tag: false } }, [
      ...manifests,
      pkg('@object-ui/unlisted'),
    ]);
    expect(result.unclassified.map((p) => p.name)).toEqual(['@object-ui/unlisted']);
  });
});

describe('the repository itself', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(repoRoot, '.changeset/config.json'), 'utf8')
  ) as { fixed?: string[][]; ignore?: string[]; privatePackages?: unknown };

  const manifests = ['packages', 'apps'].flatMap((dir) =>
    fs
      .readdirSync(path.join(repoRoot, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name, 'package.json'))
      .filter((rel) => fs.existsSync(path.join(repoRoot, rel)))
      .map((rel) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
        return { name: manifest.name as string, path: rel, private: manifest.private === true };
      })
      .filter((entry) => Boolean(entry.name))
  );

  it('declares `privatePackages` explicitly', () => {
    expect(
      normalizePrivatePackages(config.privatePackages),
      'An omitted key means `{ version: true, tag: false }` under @changesets/cli@2 and ' +
        '`{ version: false, tag: false }` under v3 — opposite answers to "does object-ui ' +
        'release?". Write it down.'
    ).not.toBeNull();
  });

  it('classifies every workspace package, with no fixed/private contradiction', () => {
    const { unclassified, privateInFixed } = analyze(config, manifests);
    expect(unclassified.map((p) => `${p.name} (${p.path})`)).toEqual([]);
    expect(
      privateInFixed.map((p) => `${p.name} (${p.path})`),
      'A private package in the `fixed` group needs `privatePackages.version: true`, or the ' +
        'next changeset that names it beside a published package makes the release plan a ' +
        'mixed changeset and `changeset version` exits 1 on `main`.'
    ).toEqual([]);
  });

  it('still keeps the private VS Code extension inside the fixed group', () => {
    // The shape the two rules above exist for. If this ever stops being true the
    // guard is not wrong, but it is no longer guarding anything real — and the
    // rationale in both files should be re-read before it is trimmed.
    const vscode = manifests.find((m) => m.path === 'packages/vscode-extension/package.json');
    expect(vscode?.name).toBe('object-ui');
    expect(vscode?.private).toBe(true);
    expect((config.fixed ?? []).flat()).toContain('object-ui');
  });
});
