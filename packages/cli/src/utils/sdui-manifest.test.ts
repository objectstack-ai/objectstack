// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SDUI manifest resolver and the one decision the three authoring commands
 * share about it (#20113). The command-level faces — text and `--json` of `os
 * validate` / `os build` / `os lint`, and their exit statuses — are pinned by
 * `test/jsx-gate-manifest-notice.e2e.test.ts`, which runs NIGHTLY (it spawns
 * the CLI). This file is the per-PR guard, so every rule those faces read is
 * pinned HERE too — the package-carried layout included.
 *
 * ⛔ Anchors, not prose: the notice is found by its `rule` id and asserted on
 * the DATA it must carry (the page count and every place looked), never on the
 * sentence around them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateJsxPages } from '@objectstack/lint';
import {
  CONSOLE_SDUI_MANIFEST,
  JSX_PARSE_LEVEL_ONLY_RULE,
  PROJECT_SDUI_MANIFEST_FILE,
  SduiManifestRefusalError,
  consoleSduiManifestPath,
  countJsxGatePages,
  jsxGateStacks,
  printJsxGateNotices,
  resolveJsxGateManifest,
  resolveSduiManifest,
  type SduiManifestResolution,
} from './sdui-manifest.js';
import { artifactPackages, packageBodyAsStack, runPerPackageAuthoringRules } from './artifact-packages.js';
import { authoringRuleUnionStack } from './stack-collections.js';
import { errorCodeFields, isReportedError } from './format.js';

const MANIFEST = { components: { div: { type: 'div', inputs: [{ name: 'children', type: 'slot' }] } } };
const HTML_STACK = { pages: [{ name: 'landing', kind: 'html', source: '<div>hi</div>' }] };
const NO_PAGES_STACK = { objects: [{ name: 'ticket' }] };

/** A `kind: 'html'` page the gate checks against a manifest. */
const html = (name: string) => ({ name, label: name, kind: 'html', source: '<div>hi</div>' });
/** An ADR-0130 D4 package entry, complete enough for the fold to resolve it. */
const pkg = (id: string, pages: unknown[]) => ({
  manifest: { id, name: id.replace(/\W/g, '_'), version: '1.0.0', type: 'app', pages },
});
/**
 * The round-1 layout: the top level carries a `pages` key — so the union fold
 * keeps it and folds nothing in — while the html pages live only inside
 * `packages[]`, where the per-package pass still hands them to the gate.
 */
const PACKAGE_CARRIED: Record<string, Record<string, unknown>> = {
  'top-level `pages: []`': { pages: [], packages: [pkg('com.x.site', [html('site_landing')])] },
  'a top-level kind:full page': {
    pages: [{ name: 'home', label: 'Home', kind: 'full', regions: [] }],
    packages: [pkg('com.x.site', [html('site_landing')])],
  },
};

const ABSENT: SduiManifestResolution = {
  status: 'absent',
  lookedAt: ['/proj/sdui.manifest.json', CONSOLE_SDUI_MANIFEST],
};
const UNUSABLE: SduiManifestResolution = {
  status: 'unusable',
  source: 'project',
  path: '/proj/sdui.manifest.json',
  reason: 'it is not valid JSON (x)',
};

describe('resolveSduiManifest — says WHY it has no manifest', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-sdui-manifest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolved: a project manifest with a `components` map', () => {
    writeFileSync(join(dir, PROJECT_SDUI_MANIFEST_FILE), JSON.stringify(MANIFEST));
    const r = resolveSduiManifest(dir);
    expect(r).toEqual({ status: 'resolved', manifest: MANIFEST, path: join(dir, PROJECT_SDUI_MANIFEST_FILE) });
  });

  // Hermetic: the console is located from an origin nothing resolves from
  // (`createRequire` refuses a relative one), so the answer does not depend on
  // whether this checkout has built the console. ⚠️ An absolute origin in an
  // empty directory is NOT that: a runner started through pnpm's `.bin` shim
  // inherits a NODE_PATH carrying the virtual store's hoisted packages, and
  // `@objectstack/console` resolves from anywhere through it. Both legs are
  // named, in order; the console-leg block below pins the absolute spelling.
  it('absent: names the project path, then the console copy', () => {
    expect(resolveSduiManifest(dir, 'not-an-absolute-origin.mjs')).toEqual({
      status: 'absent',
      lookedAt: [join(dir, PROJECT_SDUI_MANIFEST_FILE), CONSOLE_SDUI_MANIFEST],
    });
  });

  it.each([
    ['invalid JSON', '{ "components": [ oops', /not valid JSON/],
    ['JSON null (used to fall through to the console leg in silence)', 'null', /`components` map/],
    ['an empty object (used to crash the gate with a bare TypeError)', '{}', /`components` map/],
    ['an array', '[]', /`components` map/],
    ['a `components` that is not a map', '{"components":[]}', /`components` map/],
  ])('unusable: %s', (_label, body, reason) => {
    writeFileSync(join(dir, PROJECT_SDUI_MANIFEST_FILE), body);
    const r = resolveSduiManifest(dir);
    expect(r.status).toBe('unusable');
    if (r.status !== 'unusable') return;
    expect(r.source).toBe('project');
    expect(r.path).toBe(join(dir, PROJECT_SDUI_MANIFEST_FILE));
    expect(r.reason).toMatch(reason);
  });

  it('unusable: a directory where the file should be', () => {
    mkdirSync(join(dir, PROJECT_SDUI_MANIFEST_FILE));
    const r = resolveSduiManifest(dir);
    expect(r.status).toBe('unusable');
    if (r.status === 'unusable') expect(r.reason).toMatch(/could not be read/);
  });
});

/**
 * The `package.json` of the REAL `@objectstack/console` this package depends
 * on, resolved the way any installed dependency is — through `node_modules` —
 * so the layouts below carry the console's actual `exports` map, which is what
 * decides whether a subpath resolves at all.
 */
const REAL_CONSOLE_PACKAGE_JSON = createRequire(import.meta.url).resolve('@objectstack/console/package.json');

/**
 * An installed-package layout under `root`: `node_modules/@objectstack/console`
 * carrying the real console `package.json`, plus a `dist/sdui.manifest.json`
 * with `body` (`null` for a console that ships none, as 17.0.0 to 17.4.0 did).
 * Returns the origin a CLI installed beside it resolves from.
 */
function installConsole(root: string, body: string | null): URL {
  const pkgDir = join(root, 'node_modules', '@objectstack', 'console');
  mkdirSync(join(pkgDir, 'dist'), { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), readFileSync(REAL_CONSOLE_PACKAGE_JSON, 'utf8'));
  if (body !== null) writeFileSync(join(pkgDir, 'dist', 'sdui.manifest.json'), body);
  return pathToFileURL(join(root, 'node_modules', '@objectstack', 'cli', 'dist', 'index.js'));
}

describe('the console leg — the copy @objectstack/console ships is reached, through its package.json', () => {
  let root = '';
  let project = '';
  beforeEach(() => {
    // Real path: module resolution answers with one (`/var` is `/private/var` on macOS).
    root = realpathSync(mkdtempSync(join(tmpdir(), 'os-sdui-console-')));
    project = join(root, 'project');
    mkdirSync(project);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // The production default: from the CLI's OWN location, where its declared
  // dependency lives. Asking for the file by its own subpath resolves nothing
  // (the console's `exports` publishes `./package.json` alone), so this reds
  // the moment the leg goes back to that spelling.
  it("locates the CLI's own @objectstack/console dependency, whether or not it is built", () => {
    const path = consoleSduiManifestPath();
    expect(path).toBeDefined();
    expect(path!.endsWith(join('dist', 'sdui.manifest.json'))).toBe(true);
    const owner = JSON.parse(readFileSync(join(dirname(dirname(path!)), 'package.json'), 'utf8'));
    expect(owner.name).toBe('@objectstack/console');
  });

  it('resolved: a project with no manifest of its own is checked against the shipped copy', () => {
    const origin = installConsole(root, JSON.stringify(MANIFEST));
    expect(resolveSduiManifest(project, origin)).toEqual({
      status: 'resolved',
      manifest: MANIFEST,
      path: join(root, 'node_modules', '@objectstack', 'console', 'dist', 'sdui.manifest.json'),
    });
  });

  it("resolved: the project's own manifest is read first", () => {
    const origin = installConsole(root, JSON.stringify({ components: {} }));
    writeFileSync(join(project, PROJECT_SDUI_MANIFEST_FILE), JSON.stringify(MANIFEST));
    expect(resolveSduiManifest(project, origin)).toEqual({
      status: 'resolved',
      manifest: MANIFEST,
      path: join(project, PROJECT_SDUI_MANIFEST_FILE),
    });
  });

  it('absent: a console that ships no manifest is named by the absolute path looked at', () => {
    const origin = installConsole(root, null);
    expect(resolveSduiManifest(project, origin)).toEqual({
      status: 'absent',
      lookedAt: [
        join(project, PROJECT_SDUI_MANIFEST_FILE),
        join(root, 'node_modules', '@objectstack', 'console', 'dist', 'sdui.manifest.json'),
      ],
    });
  });

  it('unusable: a damaged shipped copy is refused with its own remedy, never read as "not found"', () => {
    const origin = installConsole(root, '{ "components": [ oops');
    const r = resolveSduiManifest(project, origin);
    expect(r).toMatchObject({
      status: 'unusable',
      source: 'console',
      path: join(root, 'node_modules', '@objectstack', 'console', 'dist', 'sdui.manifest.json'),
    });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let thrown: unknown;
      try {
        resolveJsxGateManifest(HTML_STACK, r);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SduiManifestRefusalError);
      const e = thrown as SduiManifestRefusalError;
      expect(e.message).toContain(join('@objectstack', 'console', 'dist', 'sdui.manifest.json'));
      // The remedy names the package to reinstall, not the file to edit.
      const remedy = e.hints[e.hints.length - 1];
      expect(remedy).toContain('@objectstack/console');
      expect(remedy).not.toContain(PROJECT_SDUI_MANIFEST_FILE);
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('countJsxGatePages — the pages the JSX gate checks against a manifest', () => {
  // The kind set is `validateJsxPages`'s own, read by DRIVING it: with a
  // manifest that declares no components, every page the gate compiles against
  // a manifest yields a diagnostic for `<div>`, and every page it skips yields
  // none. So a kind the gate starts or stops checking reds here.
  const EMPTY_MANIFEST = { components: {} };
  const KINDS: unknown[] = ['html', 'jsx', 'react', 'full', 'slotted', 'dashboard', undefined, 42];
  const verdicts = KINDS.map((kind) => {
    const stack = { pages: [{ name: 'p', kind, source: '<div>hi</div>' }] };
    return {
      kind,
      gateChecks: validateJsxPages(stack, { manifest: EMPTY_MANIFEST as never }).length > 0,
      counted: countJsxGatePages(stack) > 0,
    };
  });

  it.each(verdicts)('kind $kind: counted exactly when the gate checks it', ({ gateChecks, counted }) => {
    expect(counted).toBe(gateChecks);
  });

  it('the parity above is not vacuous: both verdicts occur', () => {
    expect(verdicts.some((v) => v.gateChecks)).toBe(true);
    expect(verdicts.some((v) => !v.gateChecks)).toBe(true);
  });

  it('an empty source is refused before any manifest is read, so it is not counted', () => {
    const stack = { pages: [{ name: 'p', kind: 'html', source: '   ' }] };
    const rules = (m?: unknown) => validateJsxPages(stack, m ? { manifest: m as never } : {}).map((f) => f.rule);
    expect(rules()).toEqual(['jsx-page-empty-source']);
    expect(rules(EMPTY_MANIFEST)).toEqual(rules());
    expect(countJsxGatePages(stack)).toBe(0);
  });

  it('counts the name-keyed map shape too, and ignores non-records', () => {
    expect(
      countJsxGatePages({
        pages: { a: { kind: 'html', source: '<div />' }, b: { kind: 'jsx', source: '<div />' }, c: 'x', d: null },
      }),
    ).toBe(2);
    expect(countJsxGatePages({ pages: 'nope' })).toBe(0);
    expect(countJsxGatePages({})).toBe(0);
  });
});

describe('countJsxGatePages — every stack the gate is handed, not the union fold alone', () => {
  const EMPTY_MANIFEST = { components: {} };

  it.each(Object.entries(PACKAGE_CARRIED))(
    '%s beside package-carried html pages: the per-package pass judges them, the fold alone judges none',
    (_label, stack) => {
      // WHY the fold alone undercounts: it keeps the top-level `pages` key, so
      // the union run's gate sees no html page at all…
      expect(validateJsxPages(authoringRuleUnionStack(stack), { manifest: EMPTY_MANIFEST as never })).toEqual([]);
      // …while the REAL per-package pass hands the package body to the gate —
      // with a manifest declaring nothing, the page's `div` is flagged there.
      const perPackage = runPerPackageAuthoringRules({
        command: 'validate',
        parsed: stack,
        unionFindings: [],
        sduiManifest: EMPTY_MANIFEST,
      }).findings.filter((f) => f.rule.startsWith('jsx-'));
      expect(perPackage.length).toBeGreaterThan(0);
      expect(perPackage.every((f) => f.where.includes('site_landing'))).toBe(true);
      // So the count follows what is judged: one page.
      expect(countJsxGatePages(stack)).toBe(1);
    },
  );

  it('jsxGateStacks is the fold plus the per-package pass’s OWN enumeration of the bodies', () => {
    const stack = PACKAGE_CARRIED['top-level `pages: []`'];
    expect(jsxGateStacks(stack)).toEqual([
      authoringRuleUnionStack(stack),
      ...artifactPackages(stack).map((p) => packageBodyAsStack(p.body, stack.packages)),
    ]);
    expect(jsxGateStacks(HTML_STACK)).toEqual([HTML_STACK]);
  });

  it('no double count where both runs see a page: option B (the fold copies the bodies in)', () => {
    const optionB = { packages: [pkg('com.x.a', [html('a_one')]), pkg('com.x.b', [html('b_one'), html('b_two')])] };
    expect(jsxGateStacks(optionB)).toHaveLength(3);
    expect(countJsxGatePages(optionB)).toBe(3);
  });

  it('no double count where both runs see a page: additive (the top level already IS the union)', () => {
    const additive = {
      pages: [html('a_one'), html('b_one')],
      packages: [pkg('com.x.a', [html('a_one')]), pkg('com.x.b', [html('b_one')])],
    };
    expect(countJsxGatePages(additive)).toBe(2);
  });

  it('an already-folded stack answers the same as the stack it was folded from', () => {
    const optionB = { packages: [pkg('com.x.a', [html('a_one')])] };
    expect(countJsxGatePages(authoringRuleUnionStack(optionB))).toBe(countJsxGatePages(optionB));
  });
});

describe('resolveJsxGateManifest — one decision, three commands', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it('resolved: arms the gate and says nothing', () => {
    const r = resolveJsxGateManifest(HTML_STACK, { status: 'resolved', manifest: MANIFEST, path: '/p' });
    expect(r).toEqual({ sduiManifest: MANIFEST, notices: [] });
  });

  it('absent with a page to check: parse level, and ONE notice carrying the count and every place looked', () => {
    const r = resolveJsxGateManifest(
      { pages: [...HTML_STACK.pages, { name: 'b', kind: 'jsx', source: '<div />' }] },
      ABSENT,
    );
    expect(r.sduiManifest).toBeUndefined();
    expect(r.notices).toHaveLength(1);
    const [n] = r.notices;
    // The AuthoringFinding shape, exactly — an existing record shape with an
    // existing severity, so no consumer meets a new one.
    expect(Object.keys(n).sort()).toEqual(['hint', 'message', 'path', 'rule', 'severity', 'where']);
    expect(n).toMatchObject({ severity: 'info', rule: JSX_PARSE_LEVEL_ONLY_RULE, path: 'pages' });
    expect(n.message).toContain('2 ');
    for (const place of (ABSENT as { lookedAt: readonly string[] }).lookedAt) expect(n.message).toContain(place);
    expect(n.hint).toContain('/proj/sdui.manifest.json');
  });

  it.each(Object.entries(PACKAGE_CARRIED))(
    'absent, %s beside package-carried html pages: the notice, counting the package page',
    (_label, stack) => {
      const r = resolveJsxGateManifest(stack, ABSENT);
      expect(r.sduiManifest).toBeUndefined();
      expect(r.notices).toHaveLength(1);
      expect(r.notices[0]).toMatchObject({ severity: 'info', rule: JSX_PARSE_LEVEL_ONLY_RULE });
      expect(r.notices[0].message).toMatch(/^1 /);
    },
  );

  it.each(Object.entries(PACKAGE_CARRIED))(
    'unusable, %s beside package-carried html pages: refused, not waved through',
    (_label, stack) => {
      expect(() => resolveJsxGateManifest(stack, UNUSABLE)).toThrow(SduiManifestRefusalError);
    },
  );

  it('absent with nothing to check: silence is the true answer', () => {
    expect(resolveJsxGateManifest(NO_PAGES_STACK, ABSENT)).toEqual({ sduiManifest: undefined, notices: [] });
    expect(
      resolveJsxGateManifest({ pages: [{ name: 'r', kind: 'react', source: 'export default () => null' }] }, ABSENT),
    ).toEqual({ sduiManifest: undefined, notices: [] });
  });

  it('unusable with nothing to check: not read by anything, so not refused', () => {
    expect(resolveJsxGateManifest(NO_PAGES_STACK, UNUSABLE)).toEqual({ sduiManifest: undefined, notices: [] });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('unusable with a page to check: refused, reported once on stderr, no minted code', () => {
    let thrown: unknown;
    try {
      resolveJsxGateManifest(HTML_STACK, UNUSABLE);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SduiManifestRefusalError);
    const e = thrown as SduiManifestRefusalError;
    expect(e.message).toContain('/proj/sdui.manifest.json');
    expect(e.message).toContain('it is not valid JSON (x)');
    // The catch-alls read this marker: exit 1, no second rendering on stdout.
    expect(isReportedError(e)).toBe(true);
    // ⛔ No ADR-0112 code through the back door.
    expect(errorCodeFields(e)).toEqual({});
    const stderr = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(stderr).toContain(e.message);
  });
});

describe('printJsxGateNotices — the text face of `os validate` / `os build`', () => {
  it('prints the rule tag and the hint, and nothing for an empty list', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      printJsxGateNotices([]);
      expect(log).not.toHaveBeenCalled();
      printJsxGateNotices(resolveJsxGateManifest(HTML_STACK, ABSENT).notices);
      const out = log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(out).toContain(`[${JSX_PARSE_LEVEL_ONLY_RULE}]`);
      expect(out).toContain('/proj/sdui.manifest.json');
    } finally {
      log.mockRestore();
    }
  });
});
