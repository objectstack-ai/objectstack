// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SDUI manifest resolver and the one decision the three authoring commands
 * share about it (#20113). The command-level faces — text and `--json` of `os
 * validate` / `os build` / `os lint`, and their exit statuses — are pinned by
 * `test/jsx-gate-manifest-notice.test.ts`; this file holds the logic those
 * faces all read.
 *
 * ⛔ Anchors, not prose: the notice is found by its `rule` id and asserted on
 * the DATA it must carry (the page count and every place looked), never on the
 * sentence around them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateJsxPages } from '@objectstack/lint';
import {
  CONSOLE_SDUI_MANIFEST_SPECIFIER,
  JSX_PARSE_LEVEL_ONLY_RULE,
  PROJECT_SDUI_MANIFEST_FILE,
  SduiManifestRefusalError,
  countJsxGatePages,
  printJsxGateNotices,
  resolveJsxGateManifest,
  resolveSduiManifest,
  type SduiManifestResolution,
} from './sdui-manifest.js';
import { errorCodeFields, isReportedError } from './format.js';

const MANIFEST = { components: { div: { type: 'div', inputs: [{ name: 'children', type: 'slot' }] } } };
const HTML_STACK = { pages: [{ name: 'landing', kind: 'html', source: '<div>hi</div>' }] };
const NO_PAGES_STACK = { objects: [{ name: 'ticket' }] };

const ABSENT: SduiManifestResolution = {
  status: 'absent',
  lookedAt: ['/proj/sdui.manifest.json', CONSOLE_SDUI_MANIFEST_SPECIFIER],
};
const UNUSABLE: SduiManifestResolution = {
  status: 'unusable',
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

  // Holds in any checkout: `packages/console/dist/` is gitignored and absent
  // unless the console is built, and today the specifier is not in the
  // console's `exports` either. Both legs are named, in order.
  it('absent: names the project path, then the console specifier', () => {
    expect(resolveSduiManifest(dir)).toEqual({
      status: 'absent',
      lookedAt: [join(dir, PROJECT_SDUI_MANIFEST_FILE), CONSOLE_SDUI_MANIFEST_SPECIFIER],
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
    const stderr = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
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
