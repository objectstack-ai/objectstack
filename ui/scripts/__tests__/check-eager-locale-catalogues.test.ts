import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper; its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`) — same arrangement as
// `check-eager-closure-budget.test.ts` next door.
import {
  ACTIVE_CATALOGUE,
  BUILT_IN_LANGUAGE_CODES,
  CATALOGUE_CHUNK_PREFIX,
  catalogueCodeOfChunkName,
  catalogueCodeOfFileName,
  evaluateEagerCatalogues,
} from '../check-eager-locale-catalogues.mjs';

// Rooted on THIS FILE, never on `process.cwd()`: the same assertion reads a
// different tree under a package-scoped vitest invocation than under the
// repo-root one (AGENTS.md, objectui#7791 / objectui#7799).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registrySource = fs.readFileSync(
  path.join(repoRoot, 'packages/i18n/src/locales/registry.ts'),
  'utf8',
);

/** A v2 report whose eager `files[]` carry exactly these chunk names. */
function reportWith(names: readonly string[]) {
  return {
    reportVersion: 2,
    entryChunks: ['assets/index-A.js'],
    eagerChunkCount: names.length,
    totalChunkCount: names.length + 400,
    eagerGzipBytes: 1_000,
    eagerRawBytes: 4_000,
    files: names.map((name) => ({
      fileName: `assets/${name}-hash.js`,
      name,
      bytes: 100,
      gzipBytes: 40,
    })),
  };
}

/** The ten emitted catalogue chunk files a healthy build writes. */
const ALL_EMITTED = BUILT_IN_LANGUAGE_CODES.map(
  (code: string) => `${CATALOGUE_CHUNK_PREFIX}${code}-Hash1.js`,
);

describe('the population this gate looks for', () => {
  /**
   * The gate states its own ten codes rather than importing them, so that a
   * code deleted from the registry cannot silently leave it with nothing to
   * look for. That duplication is only safe while something reds when the two
   * disagree, and this is that something.
   */
  it('matches `BUILT_IN_LANGUAGE_CODES` in the i18n registry, code for code', () => {
    const declared = /export const BUILT_IN_LANGUAGE_CODES[\s\S]*?\]\);/.exec(registrySource);
    expect(declared).not.toBeNull();

    // The registry spells the resident one as `DEFAULT_BUILT_IN_LANGUAGE` and
    // spreads the other nine out of the loader table, so the codes are read
    // from the two places they are actually written.
    const resident = /export const DEFAULT_BUILT_IN_LANGUAGE = '([a-z-]+)';/.exec(registrySource);
    expect(resident?.[1]).toBe(ACTIVE_CATALOGUE);

    const loaderTable = /const LAZY_LOCALE_LOADERS[\s\S]*?\n {2}\}\);/.exec(registrySource);
    expect(loaderTable).not.toBeNull();
    const lazyCodes = [...(loaderTable?.[0] ?? '').matchAll(/^\s{4}([a-z-]+): \(\) => import\(/gm)].map(
      (m) => m[1],
    );
    // Counter-probe: a regex that stopped matching would make the comparison
    // below `[resident] === [resident]` and agree with any registry at all.
    expect(lazyCodes.length).toBeGreaterThan(0);

    expect([ACTIVE_CATALOGUE, ...lazyCodes]).toEqual([...BUILT_IN_LANGUAGE_CODES]);
  });

  it('reads a chunk name and a file name back to the same code', () => {
    expect(catalogueCodeOfChunkName(`${CATALOGUE_CHUNK_PREFIX}zh`)).toBe('zh');
    expect(catalogueCodeOfFileName(`assets/${CATALOGUE_CHUNK_PREFIX}zh-Bx9f1.js`)).toBe('zh');
  });

  it('reads a hash that CONTAINS a hyphen — rolldown names chunks in base64url', () => {
    // ⛔ Not invented fixtures. These three file names were emitted by one
    // console build (objectui#9078's head) alongside seven siblings whose
    // hashes drew no `-`, and the previous matcher read exactly these three as
    // null — so the gate announced that zh, de and fr "were emitted under no
    // `i18n-locale-<code>` chunk at all" while all three sat in `assets/`.
    // Every fixture above this line is hyphen-free, which is why the defect
    // shipped: the suite could not tell the two spellings apart.
    expect(catalogueCodeOfFileName('assets/i18n-locale-de-cTrdGXD-.js')).toBe('de');
    expect(catalogueCodeOfFileName('assets/i18n-locale-fr-CH3jagZ-.js')).toBe('fr');
    expect(catalogueCodeOfFileName('assets/i18n-locale-zh-Ixe-DTac.js')).toBe('zh');
    // An underscore is in the same alphabet and was never exercised either.
    expect(catalogueCodeOfFileName('assets/i18n-locale-ja-Ab_c-1D2.js')).toBe('ja');
  });

  it('still refuses to read one code as another, which is what the old matcher bought', () => {
    // The retired spelling constrained the hash in order to keep
    // `i18n-locale-en-*.js` from being read as some other code's chunk. That
    // ambiguity is about the CODE, not the hash, so it is answered by matching
    // the declared codes longest-first — and it must keep being answered.
    for (const code of BUILT_IN_LANGUAGE_CODES) {
      expect(catalogueCodeOfFileName(`assets/${CATALOGUE_CHUNK_PREFIX}${code}-Ab-cD.js`)).toBe(code);
    }
    // A hash has to actually follow the code.
    expect(catalogueCodeOfFileName(`assets/${CATALOGUE_CHUNK_PREFIX}zh.js`)).toBeNull();
    expect(catalogueCodeOfFileName(`assets/${CATALOGUE_CHUNK_PREFIX}zh-.js`)).toBeNull();
  });

  it('claims nothing it should not — the matcher must be able to say no', () => {
    // Without these the verdicts below are statements about a matcher that
    // matches everything, which agrees with every bundle.
    expect(catalogueCodeOfChunkName('i18n-runtime')).toBeNull();
    expect(catalogueCodeOfChunkName('framework')).toBeNull();
    expect(catalogueCodeOfChunkName(`${CATALOGUE_CHUNK_PREFIX}xx`)).toBeNull();
    expect(catalogueCodeOfFileName('assets/i18n-runtime-Hash1.js')).toBeNull();
    expect(catalogueCodeOfFileName('assets/vendor-react-Hash1.js')).toBeNull();
  });
});

describe('the verdict', () => {
  it('passes when only the resident catalogue is eager', () => {
    const verdict = evaluateEagerCatalogues(
      reportWith([`${CATALOGUE_CHUNK_PREFIX}${ACTIVE_CATALOGUE}`, 'i18n-runtime', 'framework']),
      ALL_EMITTED,
    );
    expect(verdict.status).toBe('pass');
    expect(verdict.eager).toEqual([]);
    expect(verdict.lazy).toHaveLength(BUILT_IN_LANGUAGE_CODES.length - 1);
  });

  it('fails, and names them, when a non-resident catalogue is eager', () => {
    const verdict = evaluateEagerCatalogues(
      reportWith([
        `${CATALOGUE_CHUNK_PREFIX}${ACTIVE_CATALOGUE}`,
        `${CATALOGUE_CHUNK_PREFIX}zh`,
        `${CATALOGUE_CHUNK_PREFIX}ru`,
      ]),
      ALL_EMITTED,
    );
    expect(verdict.status).toBe('fail');
    expect(verdict.eager).toEqual(['ru', 'zh']);
    expect(verdict.message).toContain('ru, zh');
    // ⛔ The remedy must never read as "raise a ceiling": this failure is about
    // composition, and a byte ceiling cannot fix it.
    expect(verdict.message).toContain('Raising a byte ceiling does not address this');
  });

  /**
   * The regression this whole card removed, replayed: ten catalogues eager.
   * A gate that only knew how to spot ONE stray would have been green through
   * the state that motivated it.
   */
  it('fails on the pre-objectui#7479 shape — all ten eager', () => {
    const verdict = evaluateEagerCatalogues(
      reportWith(BUILT_IN_LANGUAGE_CODES.map((c: string) => `${CATALOGUE_CHUNK_PREFIX}${c}`)),
      ALL_EMITTED,
    );
    expect(verdict.status).toBe('fail');
    expect(verdict.eager).toHaveLength(BUILT_IN_LANGUAGE_CODES.length - 1);
  });
});

describe('the counter-probes — a gate that cannot run must be LOUDER than one that fails', () => {
  it('errors, never passes, without a built report', () => {
    const verdict = evaluateEagerCatalogues(null, []);
    expect(verdict.status).toBe('error');
    expect(verdict.message).toContain('PREREQUISITE NOT MET');
  });

  it('errors on a report version it does not understand', () => {
    const verdict = evaluateEagerCatalogues(
      { ...reportWith(['framework']), reportVersion: 3 },
      ALL_EMITTED,
    );
    expect(verdict.status).toBe('error');
  });

  /**
   * The failure this probe is for: a chunk-group rename, or ten catalogues
   * merged back into one group, leaves the matcher with nothing to find — and
   * "no catalogue is eager" is exactly what a healthy bundle prints. Without
   * this probe the most broken configuration available scores the best verdict.
   */
  it('errors when a catalogue was emitted under no chunk of its own', () => {
    const verdict = evaluateEagerCatalogues(
      reportWith([`${CATALOGUE_CHUNK_PREFIX}${ACTIVE_CATALOGUE}`]),
      ALL_EMITTED.filter((f: string) => !f.includes(`${CATALOGUE_CHUNK_PREFIX}zh-`)),
    );
    expect(verdict.status).toBe('error');
    expect(verdict.message).toContain('zh');
    expect(verdict.message).toContain('matching nothing agrees with everything');
  });

  /**
   * The other direction. `en` is statically imported by the registry and
   * re-exported by the package entry, so it is eager by construction; a walk
   * that cannot see it is a broken walk, and a broken walk reports an empty
   * eager set — which is this gate's pass condition.
   */
  it('errors when the RESIDENT catalogue is not eager', () => {
    const verdict = evaluateEagerCatalogues(reportWith(['framework', 'i18n-runtime']), ALL_EMITTED);
    expect(verdict.status).toBe('error');
    expect(verdict.message).toContain('counter-probe failed');
    expect(verdict.message).toContain(ACTIVE_CATALOGUE);
  });
});
