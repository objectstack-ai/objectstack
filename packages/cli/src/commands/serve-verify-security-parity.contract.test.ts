// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `objectstack serve` ↔ `@objectstack/verify`'s `bootStack`: the two boot paths
// must construct their `SecurityPlugin` from the SAME resolution — #7001.
//
// The defect this file mechanises: two boot paths disagreed about whether an
// application's declared default permission profile exists.
//
//   • `serve.ts` read `appDefaultPermissionSetName(config.permissions)` and
//     passed it as `fallbackPermissionSet`.
//   • `bootStack` constructed a vanilla `new SecurityPlugin()` and never read
//     `config.permissions` at all.
//
// So the profile an app declared was in force when a human ran the CLI and
// silently absent when the app's own dogfood suite booted it — a
// `declared ≠ enforced` split inside the harness that exists to catch that
// split. Green tests, different production behaviour. It stayed invisible until
// #5491 removed `member_default`'s `'*'` wildcard, because until then the floor
// underneath granted everything anyway and the fallback was never load-bearing.
//
// The runtime halves are pinned where they run: the harness's wiring and its
// behavioural consequence in `packages/verify/src/harness.app-default-profile.test.ts`,
// the helper's own contract in
// `packages/plugins/plugin-security/src/app-default-permission-set.test.ts`.
// Neither can see THIS file's failure mode, which is the one that actually
// happened: nothing in the repo pins `serve.ts`'s side, so re-open-coding the
// wiring here — or dropping it — would be green everywhere while the paths
// separate again. Hence a source scan, in the shape of this package's
// `serve-email-config-parity.contract.test.ts`: the grep that would have caught
// it, mechanised, so the second divergence fails a build instead of waiting for
// someone to run it.
//
// It is deliberately a scan of BOTH files rather than an assertion about one.
// A one-sided pin is satisfiable by editing the other side, which is exactly
// how two mirrored literals drift.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appSecurityPluginOptions, appDefaultPermissionSetName } from '@objectstack/plugin-security';
// The repo's one comment/code separator (#9367). Typed by the hand-written
// `scripts/js-comment-mask.d.mts` next to it, so this import needs no
// suppression and `maskComments` arrives as `(source: string) => string`
// rather than `any` — which is what makes the `source: string` annotation on
// BOOT_PATHS below a real check instead of a formality.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * `packages/cli/src/commands/` → `packages/`. The sibling read is what makes
 * this a PARITY assertion instead of a single-file lint; `@objectstack/verify`
 * is a real dependency of this package, and the comparison is test-only, so no
 * runtime edge is added. Tests never ship (`files: ["dist"]`).
 */
const PACKAGES_DIR = path.resolve(HERE, '../../..');

/**
 * Absence must be loud (AGENTS.md, Route & surface ownership §3). A scan that
 * silently reports success because it could not find the file it scans is worse
 * than no scan — it is this very gate's failure mode, one level up.
 */
function readBootPath(relative: string): string {
  const full = path.join(PACKAGES_DIR, relative);
  try {
    return readFileSync(full, 'utf8');
  } catch (e) {
    throw new Error(
      `serve↔verify parity scan cannot read its subject '${relative}' (looked at ${full}). ` +
        'The file moved or was renamed — repoint this scan; do NOT delete it, the two boot ' +
        `paths still have to agree. (${(e as Error).message})`,
    );
  }
}

/**
 * Comments masked, because this scan is about what the two files DO.
 *
 * Both boot sites are heavily commented — with the very construction shapes
 * being asserted about, since each explains what it replaced — so a scan over
 * raw text measures the prose and reports on it. (It did: the first run of this
 * file counted six constructions where the code has two.) Worse, the
 * comment-inclusive form would forbid the next author from ever *describing*
 * the old wiring, which is the opposite of what these files need.
 *
 * This was a private two-regex `stripComments`, block pass first, and this
 * paragraph used to call it “approximate by design, and safe here”. It was
 * neither. #9367 converted six `scripts/check-*.mjs` gates off that exact
 * spelling onto the shared `maskComments`; these scans were outside that
 * population only because they are tests, and `serve.ts` is the conversion's
 * textbook subject. Its `5d.` header names the route wildcard
 * `/api/v1/auth/*`, whose opener starts a PHANTOM block comment running to the
 * next real terminator — the `webpackIgnore` pragma ten lines below — which
 * deletes the `hasAuthPlugin` computation and the
 * `if (!hasAuthPlugin && tierEnabled('auth'))` gate in between. Measured on
 * this pair at `5c3faa70d`: the naive strip keeps 1895 code-bearing lines of
 * `serve.ts`, `maskComments` keeps 2141.
 *
 * No verdict below moved on the swap. Every construction this file measures
 * already sat outside the swallowed span, which is what made the divergence
 * latent rather than live — and is exactly why it had to be closed by hand
 * rather than by a red build. What the swap buys is that it stays closed: an
 * assertion added about anything inside that span, or a measured construction
 * that moves into it, would otherwise go wrong in silence. The separator's own
 * behaviour is pinned at the bottom of this file, so reverting it is red.
 *
 * `maskComments` also BLANKS rather than deletes — every byte offset and line
 * number survives — which the offset-walking `securityPluginConstructions`
 * below depends on.
 *
 * Named rather than inlined into the `.map()` so that the pin at the bottom of
 * this file exercises THIS binding. A pin that called `maskComments` directly
 * would stay green through the one edit it exists to catch — someone restoring
 * a private strip here — which is the same shape of hole as the mention-is-not-
 * a-call ablation recorded below.
 */
function separateCodeFromProse(source: string): string {
  return maskComments(source);
}

const BOOT_PATHS: Array<{ label: string; relative: string; source: string }> = [
  { label: 'objectstack serve', relative: 'cli/src/commands/serve.ts' },
  { label: 'verify bootStack', relative: 'verify/src/harness.ts' },
].map((p) => ({ ...p, source: separateCodeFromProse(readBootPath(p.relative)) }));

/**
 * Every `new SecurityPlugin(...)` construction in a file, with its argument.
 *
 * Walks parentheses rather than matching `\(([^)]*)\)` — the argument is itself
 * a call (`appSecurityPluginOptions(config)`), so a non-nesting match stops at
 * the INNER `)` and silently reports `appSecurityPluginOptions(config`. That
 * truncation compares equal across both files, so the naive form would have
 * passed while measuring something that is not the argument.
 */
function securityPluginConstructions(source: string): string[] {
  const NEW = 'new SecurityPlugin(';
  const found: string[] = [];
  for (let i = source.indexOf(NEW); i !== -1; i = source.indexOf(NEW, i + 1)) {
    let depth = 1;
    let j = i + NEW.length;
    for (; j < source.length && depth > 0; j++) {
      if (source[j] === '(') depth++;
      else if (source[j] === ')') depth--;
    }
    if (depth !== 0) throw new Error(`unbalanced \`${NEW}…\` at offset ${i} — the scan cannot read this file`);
    found.push(source.slice(i + NEW.length, j - 1).trim());
  }
  return found;
}

describe('serve ↔ bootStack construct SecurityPlugin from one resolution (#7001)', () => {
  // Asserting on the CONSTRUCTION rather than on the file's text, because the
  // text form does not go red on the defect. Reverting `harness.ts` to its
  // pre-#7001 `new SecurityPlugin()` left the `appSecurityPluginOptions` import
  // standing, so a `expect(source).toContain('appSecurityPluginOptions')` check
  // stayed GREEN over a boot path that had stopped calling it — a mention is
  // not a call. Measured, not reasoned: that ablation was run, and this is the
  // shape that failed correctly.
  it.each(BOOT_PATHS)('$label constructs SecurityPlugin exactly once, via the helper', ({ source }) => {
    expect(securityPluginConstructions(source)).toEqual(['appSecurityPluginOptions(config)']);
  });

  it.each(BOOT_PATHS)('$label does not re-open-code the resolution', ({ source }) => {
    // The open-coded shape #7001 replaced, in either spelling. Reaching for the
    // NAME helper at a boot site means rebuilding `name ? {...} : undefined` by
    // hand — the half that was a decision, not formatting, and the half the
    // other path never grew.
    expect(source).not.toContain('appDefaultPermissionSetName');
    expect(source).not.toMatch(/fallbackPermissionSet\s*:/);
  });

  it('and the two paths agree with EACH OTHER, not merely with a literal', () => {
    // The parity claim proper. The per-path assertions above both compare to
    // the same hard-coded string, which a single careless edit could "fix" on
    // both sides at once; this one compares the paths to one another, so
    // divergence is red however the argument is spelled.
    const [serve, verify] = BOOT_PATHS.map(({ source }) => securityPluginConstructions(source));
    // A path that stopped constructing one at all would otherwise satisfy any
    // "the two agree" claim over two empty sets.
    expect(serve.length, 'serve constructs a SecurityPlugin').toBeGreaterThan(0);
    expect(verify).toEqual(serve);
  });
});

describe('the shared resolution, exercised (#7001)', () => {
  // The scan above proves both paths call one helper; these prove the helper
  // they call answers correctly. Neither claim implies the other, and a source
  // scan alone would be green over a helper that returned nonsense.
  const declared = {
    permissions: [
      { name: 'ignored_not_default', isDefault: false },
      { name: 'app_member_default', isDefault: true },
    ],
  };

  it('carries an app-declared isDefault profile into the constructor options', () => {
    expect(appSecurityPluginOptions(declared)).toEqual({ fallbackPermissionSet: 'app_member_default' });
    expect(appDefaultPermissionSetName(declared.permissions)).toBe('app_member_default');
  });

  it('yields undefined when nothing is declared, so the plugin keeps its own derivation', () => {
    // Deliberately NOT `{ fallbackPermissionSet: undefined }`: the constructor
    // reads an explicit `undefined` as "derive from the built-in sets" only
    // because the KEY is absent — `fallbackPermissionSet: null` means "no
    // baseline at all". Passing the object shape would work today and is one
    // refactor away from silently disabling the platform baseline.
    expect(appSecurityPluginOptions({ permissions: [{ name: 'plain' }] })).toBeUndefined();
    expect(appSecurityPluginOptions({})).toBeUndefined();
    expect(appSecurityPluginOptions(undefined)).toBeUndefined();
  });
});

/**
 * The separator beneath the parity scan, pinned — #9367's conversion, arriving
 * here (#10453).
 *
 * ⚠️ The naive strip below is a SPECIMEN of what was replaced, never an
 * instrument. A future re-derivation grepping this directory for that regex
 * will land on this block: it is the pin that the file no longer USES it.
 *
 * Each case is an ordinary shape carrying a comment opener that is not a
 * comment, followed by the construction this file measures and a real docblock
 * for a phantom span to close against. The naive strip's block pass runs first,
 * so the phantom opens at the opener and closes at the docblock's terminator,
 * deleting the construction in between: the scan then reports a boot path that
 * constructs no `SecurityPlugin` at all, and reports it as a clean read. The
 * masker resolves all four correctly, and the two implementations were checked
 * byte-for-byte against `@typescript-eslint/parser`'s comment ranges on both
 * real subjects (0 bytes of disagreement either way), which is what rules out
 * #10427's open `scanSource` desync for this pair.
 */
describe("the parity scan's comment separator is string-aware (#9367)", () => {
  /** The private two-regex strip this file carried until #10453. Specimen only. */
  const naiveStrip = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const CONSTRUCTION = 'new SecurityPlugin(appSecurityPluginOptions(config));';
  const DOCBLOCK = '/** a docblock far below, for a phantom span to close against */';

  const DISAGREEMENTS: Array<{ label: string; source: string }> = [
    {
      // `serve.ts` carries exactly this today, at its `5d.` header.
      label: 'a route wildcard in a line comment',
      source: ['// The Console expects /api/v1/auth/* to be served by better-auth.', CONSTRUCTION, DOCBLOCK].join('\n'),
    },
    {
      label: 'a route wildcard in a string literal',
      source: ["const authRoutes = '/api/v1/auth/*';", CONSTRUCTION, DOCBLOCK].join('\n'),
    },
    {
      label: 'a comment opener in a template literal',
      source: ['const route = `${base}/api/v1/auth/*`;', CONSTRUCTION, DOCBLOCK].join('\n'),
    },
    {
      // The nested-template family #10427 measures `scanSource` against. The
      // masker answers this one correctly; the case it does NOT is a nested
      // template carrying an ESCAPED backtick, which neither subject of this
      // scan contains and which is that issue's to close, not this file's.
      label: 'a comment opener in a template nested inside an interpolation',
      source: ['const msg = `${globs.map((g) => `<${g}>`).join(", ")} /api/v1/auth/*`;', CONSTRUCTION, DOCBLOCK].join('\n'),
    },
  ];

  it.each(DISAGREEMENTS)('$label — the masker keeps the construction', ({ source }) => {
    expect(securityPluginConstructions(separateCodeFromProse(source))).toEqual(['appSecurityPluginOptions(config)']);
  });

  it.each(DISAGREEMENTS)('$label — the naive strip loses it', ({ source }) => {
    // The direction that matters: not a mangled argument, but a boot path that
    // reads as constructing nothing. Two such paths agree with each other
    // vacuously, which is the parity claim above passing over no evidence.
    expect(securityPluginConstructions(naiveStrip(source))).toEqual([]);
  });

  it('blanks rather than deletes, so the paren walk reads real offsets', () => {
    // `securityPluginConstructions` slices by offset into the masked text and
    // the failure it throws names one, so a separator that shortens the file
    // reports positions that do not exist in it. On the first case the naive
    // strip does not merely shift offsets — it collapses 185 bytes to nothing.
    const { source } = DISAGREEMENTS[0];
    expect(separateCodeFromProse(source)).toHaveLength(source.length);
    expect(separateCodeFromProse(source).split('\n')).toHaveLength(source.split('\n').length);
    expect(naiveStrip(source).length).toBeLessThan(source.length);
  });
});
