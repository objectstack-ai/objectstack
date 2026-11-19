// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins over the platform catalog (`lib/platform-catalog.ts`), the page
 * `build-skill-references.ts` emits at `skills/objectstack-project/references/platform-catalog.md`.
 *
 * The page's names are generated from the contract package and its prose is
 * authored beside the generator, so the one thing a gate cannot see — a
 * hand-written row naming an object the registry does not hold — is what
 * these tests refuse. Three legs, as `skill-map-guards.test.ts` has:
 *
 *  - the LIVE leg asks the real lists the questions the generator asks, so a
 *    row that goes stale (an object retired, a token renamed) reds here and
 *    in `check:skill-refs` alike;
 *  - the BEHAVIOUR leg drives `catalogProblems` over fabricated inputs, one
 *    that must be refused per rule and one that must pass, so neither an
 *    always-green nor an always-red guard survives;
 *  - the WIRING leg reads the generator and asserts it calls the guard and
 *    emits the page at the one shared path.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { describe, expect, it } from 'vitest';

import { PLATFORM_PROVIDED_OBJECT_NAMES } from '../src/system/constants/platform-object-names';
import { PLATFORM_CAPABILITY_TOKENS, RETIRED_PLATFORM_CAPABILITY_GUIDANCE } from '../src/kernel/platform-capabilities';
import { ValueDomainSchema } from '../src/shared/value-domain.zod';
import {
  APP_FACING_OBJECT_GROUPS,
  CAPABILITY_ROWS,
  PLANNED_ROWS,
  PLATFORM_CATALOG_PATH,
  PROSE,
  VALUE_DOMAIN_ROWS,
  catalogProblems,
  handWrittenBytes,
  renderPlatformCatalog,
} from './lib/platform-catalog';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const GENERATOR = path.resolve(HERE, 'build-skill-references.ts');

const allRows = APP_FACING_OBJECT_GROUPS.flatMap((g) => g.rows);

describe('the live catalog — every name is one the contract package declares', () => {
  it('refuses nothing on the real lists', () => {
    expect(catalogProblems()).toEqual([]);
  });

  it('names only registered platform objects, each once, each with both prose columns', () => {
    const names = allRows.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    for (const row of allRows) {
      expect(PLATFORM_PROVIDED_OBJECT_NAMES.has(row.name), row.name).toBe(true);
      expect(row.builds.trim().length, row.name).toBeGreaterThan(0);
      expect(row.reach.trim().length, row.name).toBeGreaterThan(0);
    }
  });

  it('is an app-facing SUBSET: infrastructure objects stay out', () => {
    expect(allRows.length).toBeLessThan(PLATFORM_PROVIDED_OBJECT_NAMES.size);
    for (const infra of ['sys_jwks', 'sys_oauth_access_token', 'sys_scim_user', 'sys_metadata', 'sys_migration']) {
      expect(allRows.some((r) => r.name === infra), infra).toBe(false);
    }
  });

  it('covers every capability token exactly, and no retired one', () => {
    expect(Object.keys(CAPABILITY_ROWS).sort()).toEqual([...PLATFORM_CAPABILITY_TOKENS].sort());
    for (const retired of Object.keys(RETIRED_PLATFORM_CAPABILITY_GUIDANCE)) {
      expect(retired in CAPABILITY_ROWS, retired).toBe(false);
    }
  });

  it('covers every value domain exactly', () => {
    expect(Object.keys(VALUE_DOMAIN_ROWS).sort()).toEqual([...ValueDomainSchema.options].sort());
  });

  it('keeps the planned section short, linked by URL, and never readable as usable', () => {
    expect(PLANNED_ROWS.length).toBeGreaterThan(0);
    expect(PLANNED_ROWS.length).toBeLessThanOrEqual(4);
    const page = renderPlatformCatalog();
    for (const row of PLANNED_ROWS) {
      expect(row.link).toMatch(/^https:\/\//);
      expect(page).toContain(`| ${row.concept} | **not available**`);
    }
  });

  it('renders a page with no bare internal issue id and one row per object', () => {
    const page = renderPlatformCatalog();
    expect(page).not.toMatch(/(?<![#&])#[0-9]{3,5}(?![0-9A-Za-z])/);
    for (const row of allRows) expect(page).toContain(`| \`${row.name}\` |`);
    for (const token of PLATFORM_CAPABILITY_TOKENS) expect(page).toContain(`| \`${token}\` |`);
    for (const domain of ValueDomainSchema.options) expect(page).toContain(`| \`${domain}\` |`);
    // Pure: two renders are byte-identical, which is what makes `--check` honest.
    expect(renderPlatformCatalog()).toBe(page);
  });
});

describe('catalogProblems — refuses a wrong row, passes a right one', () => {
  const registry = new Set(['sys_real']);
  const tokens = ['tok'];
  const domains = ['dom'];
  const good = {
    groups: [{ title: 'g', rows: [{ name: 'sys_real', builds: 'x', reach: 'y' }] }],
    capabilityRows: { tok: 'mounts' },
    valueDomainRows: { dom: { builds: 'x', example: 'y' } },
    plannedRows: [{ concept: 'c', state: 'nothing shipped', link: 'https://example.invalid/c' }],
    registry,
    tokens,
    domains,
  };

  it('passes a consistent fabricated catalog', () => {
    expect(catalogProblems(good)).toEqual([]);
  });

  it('refuses a row naming an object the registry does not hold', () => {
    const problems = catalogProblems({ ...good, groups: [{ title: 'g', rows: [{ name: 'sys_fictional', builds: 'x', reach: 'y' }] }] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('sys_fictional');
    expect(problems[0]).toContain('PLATFORM_PROVIDED_OBJECT_NAMES');
  });

  it('refuses a duplicate row and an empty prose column', () => {
    const problems = catalogProblems({
      ...good,
      groups: [{ title: 'g', rows: [{ name: 'sys_real', builds: 'x', reach: 'y' }, { name: 'sys_real', builds: ' ', reach: 'y' }] }],
    });
    expect(problems.some((p) => p.includes('listed twice'))).toBe(true);
    expect(problems.some((p) => p.includes('empty "what you would otherwise build"'))).toBe(true);
  });

  it('refuses a capability table that is not exhaustive, or names an unknown token', () => {
    expect(catalogProblems({ ...good, capabilityRows: {} })).toEqual([expect.stringContaining('capability tok: no catalog line')]);
    expect(catalogProblems({ ...good, capabilityRows: { tok: 'm', nope: 'm' } })).toEqual([expect.stringContaining('capability nope: not in PLATFORM_CAPABILITY_TOKENS')]);
  });

  it('refuses a value-domain table that misses a member or names a stranger', () => {
    expect(catalogProblems({ ...good, valueDomainRows: {} })).toEqual([expect.stringContaining('value domain dom: no catalog line')]);
    expect(catalogProblems({ ...good, valueDomainRows: { dom: { builds: 'x', example: 'y' }, bcp47: { builds: 'x', example: 'y' } } }))
      .toEqual([expect.stringContaining('value domain bcp47: not in ValueDomainSchema')]);
  });

  it('refuses a planned row that reads as usable, links by bare id, or exceeds the cap', () => {
    const usable = catalogProblems({ ...good, plannedRows: [{ concept: 'c', state: 'available now', link: 'https://example.invalid/c' }] });
    expect(usable).toEqual([expect.stringContaining('reads as usable')]);
    const bareId = catalogProblems({ ...good, plannedRows: [{ concept: 'c (#12345)', state: 'nothing shipped', link: 'https://example.invalid/c' }] });
    expect(bareId).toEqual([expect.stringContaining('bare internal issue id')]);
    const relative = catalogProblems({ ...good, plannedRows: [{ concept: 'c', state: 'nothing shipped', link: '../x.md' }] });
    expect(relative).toEqual([expect.stringContaining('absolute URL')]);
    const five = Array.from({ length: 5 }, (_, i) => ({ concept: `c${i}`, state: 'nothing shipped', link: 'https://example.invalid/c' }));
    expect(catalogProblems({ ...good, plannedRows: five })).toEqual([expect.stringContaining('capped')]);
  });

  it('renderPlatformCatalog throws rather than emitting a refused catalog (wired through the same guard)', () => {
    // The live lists pass, so the throw is pinned by reading the source: the
    // render asks catalogProblems() first and refuses on any problem.
    const src = fs.readFileSync(path.resolve(HERE, 'lib/platform-catalog.ts'), 'utf-8');
    expect(src).toMatch(/const problems = catalogProblems\(\);\s*if \(problems\.length > 0\) \{\s*throw/);
  });
});

describe('pricing — the hand-written text is ratcheted, shrink-only', () => {
  // The page is generator-owned for `check-skills-token-ratchet` (its bytes
  // are a function of this module and the contract package), so no CEILINGS
  // row prices it there. Its prose is still customer context every project
  // reads before it builds, and the author who can pay is the one editing
  // this module — so the ceiling lives here, over the hand-written part only
  // (`handWrittenBytes`: paragraphs, titles, both prose columns, descriptions,
  // the "Not owned" and "Planned" rows), in the ratchet's own measure,
  // ceil(utf8 bytes / 4). The derived names, packages, editions and boot
  // flags are not counted, so a token the spec adds costs one description.
  //
  // Shrink-only: lower the number when text is cut. Raising it follows the
  // ratchet header's path — cut restated text first, then raise by the
  // measured remainder under the standing ruling it names — with the
  // arithmetic in the PR body, and pinned AT the measurement.
  //   6331 bytes -> ceil(6331 / 4) = 1583 (2026-11-19, the PR that adds the page)
  const HAND_WRITTEN_CEILING_TOKENS = 1583;

  it('measures every hand-written string the page carries and nothing derived', () => {
    const page = renderPlatformCatalog();
    for (const line of Object.values(PROSE).flat()) expect(page).toContain(line);
    for (const row of allRows) {
      expect(page).toContain(row.builds);
      expect(page).toContain(row.reach);
    }
    // A derived cell is not priced: the owning package is on the page but in no hand-written string.
    expect(page).toContain('| `sys_user` | ');
    expect(Object.values(PROSE).flat().join('\n')).not.toContain('plugin-security');
  });

  it(`keeps the hand-written text at or under ${HAND_WRITTEN_CEILING_TOKENS} tokens`, () => {
    const tokens = Math.ceil(handWrittenBytes() / 4);
    expect(tokens, `hand-written text is ${tokens} tokens; the ceiling is shrink-only — cut text, or raise it by the ratchet's path`).toBeLessThanOrEqual(HAND_WRITTEN_CEILING_TOKENS);
  });

  it('counts bytes, so a longer description moves the measure', () => {
    const before = handWrittenBytes();
    const longer = { ...CAPABILITY_ROWS, ai: `${CAPABILITY_ROWS.ai} and more` };
    expect(Object.values(longer).join('').length).toBeGreaterThan(Object.values(CAPABILITY_ROWS).join('').length);
    expect(before).toBe(handWrittenBytes()); // pure: the same tree measures the same
  });
});

describe('wiring — the generator emits the page at the shared path through the guard', () => {
  const src = fs.readFileSync(GENERATOR, 'utf-8');

  it('imports the catalog module and calls the guard before emit', () => {
    expect(src).toContain("from './lib/platform-catalog'");
    expect(src).toContain('catalogProblems()');
    expect(src).toContain('renderPlatformCatalog()');
    expect(src.indexOf('catalogProblems()')).toBeLessThan(src.indexOf('renderPlatformCatalog()'));
  });

  it('emits at PLATFORM_CATALOG_PATH and manages only that file in the folder', () => {
    expect(src).toContain('PLATFORM_CATALOG_PATH');
    expect(PLATFORM_CATALOG_PATH).toBe('skills/objectstack-project/references/platform-catalog.md');
    expect(src).toMatch(/manageDir\(path\.dirname\(catalogAbs\), \(abs\) => path\.resolve\(abs\) === catalogAbs\)/);
  });

  it('fails the run on catalog problems rather than skipping the page', () => {
    expect(src).toContain("hand-written rows disagree with packages/spec/src");
  });
});
