// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The docs-viewer keys are RETIRED (#25159) — ADR-0049 enforce-or-remove;
 * triage route A (retire with tombstones and an ADR-0087 entry, no staged
 * window), which follows the maintainer's ruling to take the docs viewer page
 * offline.
 *
 * Three keys declared an HTML documentation viewer and nothing read any of
 * them:
 *
 *   - `ApiDocumentationConfig.ui` — a viewer type (`swagger-ui`, `redoc`,
 *     `scalar`, …) at `ui.path`, typed by `ApiTestingUiConfigSchema` /
 *     `ApiTestingUiType`;
 *   - `RestApiPluginConfig.openApi.uiPath` — "URL path to serve documentation
 *     UI", default `/api/docs`;
 *   - `RestApiPluginConfig.openApi.uiFramework` — its viewer selector, default
 *     `swagger-ui` (not named on the card; the same viewer declaration one line
 *     below `uiPath`, retired with it).
 *
 * Since the viewer page `GET {basePath}/docs` was retired, the API origin
 * serves no viewer at all — only the OpenAPI document at
 * `GET {basePath}/openapi.json` — so none of the three could be honoured.
 *
 * Bookkeeping shapes, pinned below:
 *   1. Three `retiredKey()` tombstones: both objects are non-strict
 *      `z.object()`s, so a bare deletion would strip the key in silence
 *      (ADR-0104). `uiPath` / `uiFramework` carried Zod defaults, but nothing
 *      parses the REST API plugin config into a stored or built artifact, so
 *      the old defaults are refused like any other value.
 *   2. The value defs `api/ApiTestingUiConfig` and `api/ApiTestingUiType` leave
 *      whole — orphans once `ui` is gone (RETIRED_DEFS_BY_MAJOR[18]).
 *   3. No D2 conversion: neither config is a stack collection member or a
 *      stored row. `RETIRED_KEYS_BY_MAJOR[18]` carries the three keys; the D3
 *      entry `api-docs-viewer-keys-retired` carries the prescription to
 *      `os migrate meta` and the upgrade guide.
 *
 * On the assertion set (the #13823 precedent): a schema refusal raises a
 * `ZodError` whose issues carry `code` and `path` but no ADR-0112 `status` —
 * that envelope belongs to the API error surface. So these pins assert the
 * strongest set this surface has: refusal, the issue `code`, the `path` naming
 * the key, and the prescription text (where the wording is the contract, pin
 * the wording).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';
import { listRepoWalkFiles } from '../../scripts/lib/repo-walk-testkit';
import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ApiDocumentationConfigSchema, type ApiDocumentationConfig } from './documentation.zod';
import {
  OpenApiGenerationConfigSchema,
  RestApiPluginConfigSchema,
  type OpenApiGenerationConfig,
} from './plugin-rest-api.zod';

/** The live mechanism every prescription names, so an author can act on it. */
const NAMES_THE_DOCUMENT =
  /Delete the key\. The OpenAPI document is served at `GET \/api\/v1\/openapi\.json` under the REST server's default `api\.basePath` and `api\.version` \(the path follows both\) while `api\.enableOpenApi` is on/s;

const UI_PRESCRIPTION =
  /`ApiDocumentationConfig\.ui` was removed in @objectstack\/spec 18\.1\.0 \(ADR-0049 enforce-or-remove\) — nothing ever read it.*serves no HTML API documentation viewer at all/s;
const UI_PATH_PRESCRIPTION =
  /`RestApiPluginConfig\.openApi\.uiPath` was removed in @objectstack\/spec 18\.1\.0 \(ADR-0049 enforce-or-remove\) — nothing ever read it.*the `\/api\/docs` default included.*serves no HTML API documentation viewer at all/s;
const UI_FRAMEWORK_PRESCRIPTION =
  /`RestApiPluginConfig\.openApi\.uiFramework` was removed in @objectstack\/spec 18\.1\.0 \(ADR-0049 enforce-or-remove\) — nothing ever read it.*serves no HTML API documentation viewer at all/s;

/** Customer-facing text carries the ADR, never a tracker number (`check:doc-authoring`). */
const expectNoTrackerNumber = (message: string) => expect(message).not.toMatch(/#\d{3,}/);

describe('docs-viewer retirement — `ApiDocumentationConfig.ui`', () => {
  // The old spellings: a full viewer block, the minimal one, and the empty block.
  const FORMER_VALUES = [
    { type: 'swagger-ui', path: '/api-docs', theme: 'light', enableTryItOut: true },
    { type: 'scalar' },
    {},
  ];

  for (const ui of FORMER_VALUES) {
    it(`refuses \`ui: ${JSON.stringify(ui)}\` at path \`ui\`, with the prescription`, () => {
      const r = ApiDocumentationConfigSchema.safeParse({ version: '1.0.0', ui });
      expect(r.success).toBe(false);
      if (r.success) return;
      const issue = r.error.issues.find((i) => i.path[0] === 'ui');
      expect(issue, 'the refusal must name `ui`').toBeDefined();
      // A `retiredKey()` tombstone raises `invalid_type` from its `z.never()`.
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.path).toEqual(['ui']);
      expect(issue!.message).toMatch(UI_PRESCRIPTION);
      expect(issue!.message).toMatch(NAMES_THE_DOCUMENT);
      // House convention 1: the fully-qualified key, in backticks, opens it.
      expect(issue!.message.startsWith('`ApiDocumentationConfig.ui` was removed')).toBe(true);
      expectNoTrackerNumber(issue!.message);
      // Only the retired key is diagnosed.
      expect(r.error.issues.map((i) => i.path.join('.'))).toEqual(['ui']);
    });
  }

  it('fails tsc at the authoring site: the input type of the key is `never`', () => {
    const authored: ApiDocumentationConfig = {
      version: '1.0.0',
      // @ts-expect-error — `ui` is a retiredKey() tombstone: its input type is `never` (#25159).
      ui: { type: 'swagger-ui' },
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => ApiDocumentationConfigSchema.parse(authored)).toThrow(UI_PRESCRIPTION);
  });

  it('CONTROL: a config without `ui` parses, keeps its live keys and grows no `ui` property', () => {
    const parsed = ApiDocumentationConfigSchema.parse({
      version: '1.0.0',
      title: 'Acme API',
      generateOpenApi: false,
    });
    expect(parsed.title).toBe('Acme API');
    expect(parsed.generateOpenApi).toBe(false);
    expect(parsed.enabled, 'a live default still applies').toBe(true);
    // The non-strict strip path: absence must stay absence.
    expect(parsed).not.toHaveProperty('ui');
  });
});

describe('docs-viewer retirement — `RestApiPluginConfig.openApi.uiPath` / `uiFramework`', () => {
  // Every former value of each, the old defaults included.
  const CASES = [
    ...['/api/docs', '/docs', ''].map((value) => ({ key: 'uiPath', value, prescription: UI_PATH_PRESCRIPTION })),
    ...['swagger-ui', 'redoc', 'rapidoc', 'elements'].map((value) => ({
      key: 'uiFramework',
      value,
      prescription: UI_FRAMEWORK_PRESCRIPTION,
    })),
  ];

  for (const { key, value, prescription } of CASES) {
    it(`OpenApiGenerationConfigSchema refuses \`${key}: ${JSON.stringify(value)}\` at its path, with the prescription`, () => {
      const r = OpenApiGenerationConfigSchema.safeParse({ title: 'Acme API', [key]: value });
      expect(r.success).toBe(false);
      if (r.success) return;
      const issue = r.error.issues.find((i) => i.path[0] === key);
      expect(issue, `the refusal must name \`${key}\``).toBeDefined();
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.path).toEqual([key]);
      expect(issue!.message).toMatch(prescription);
      expect(issue!.message).toMatch(NAMES_THE_DOCUMENT);
      expect(issue!.message.startsWith(`\`RestApiPluginConfig.openApi.${key}\` was removed`)).toBe(true);
      expectNoTrackerNumber(issue!.message);
      expect(r.error.issues.map((i) => i.path.join('.'))).toEqual([key]);
    });
  }

  it('the whole-config door refuses both THROUGH `openApi`, located at `openApi.<key>`', () => {
    const r = RestApiPluginConfigSchema.safeParse({
      routes: [],
      openApi: { enabled: true, uiPath: '/api/docs', uiFramework: 'swagger-ui' },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const byPath = new Map(r.error.issues.map((i) => [i.path.join('.'), i]));
    expect([...byPath.keys()].sort()).toEqual(['openApi.uiFramework', 'openApi.uiPath']);
    expect(byPath.get('openApi.uiPath')!.code).toBe('invalid_type');
    expect(byPath.get('openApi.uiPath')!.message).toMatch(UI_PATH_PRESCRIPTION);
    expect(byPath.get('openApi.uiFramework')!.code).toBe('invalid_type');
    expect(byPath.get('openApi.uiFramework')!.message).toMatch(UI_FRAMEWORK_PRESCRIPTION);
  });

  it('fails tsc at the authoring site: the input type of both keys is `never`', () => {
    const authored: OpenApiGenerationConfig = {
      title: 'Acme API',
      // @ts-expect-error — `uiPath` is a retiredKey() tombstone: its input type is `never` (#25159).
      uiPath: '/api/docs',
    };
    expect(() => OpenApiGenerationConfigSchema.parse(authored)).toThrow(UI_PATH_PRESCRIPTION);
    const authoredFramework: OpenApiGenerationConfig = {
      title: 'Acme API',
      // @ts-expect-error — `uiFramework` is a retiredKey() tombstone: its input type is `never` (#25159).
      uiFramework: 'redoc',
    };
    expect(() => OpenApiGenerationConfigSchema.parse(authoredFramework)).toThrow(UI_FRAMEWORK_PRESCRIPTION);
  });

  it('CONTROL: the live keys keep their values and defaults; nothing re-defaults either retired key', () => {
    const empty = OpenApiGenerationConfigSchema.parse({});
    // The two retired defaults are no longer materialised…
    expect(empty).not.toHaveProperty('uiPath');
    expect(empty).not.toHaveProperty('uiFramework');
    // …while the live siblings' defaults still apply, byte-identically to before.
    expect(empty.enabled).toBe(true);
    expect(empty.version).toBe('3.0.3');
    expect(empty.title).toBe('ObjectStack API');
    expect(empty.apiVersion).toBe('1.0.0');
    expect(empty.outputPath).toBe('/api/docs/openapi.json');
    expect(empty.includeInternal).toBe(false);
    const viaPlugin = RestApiPluginConfigSchema.parse({ routes: [], openApi: { title: 'Acme API' } });
    expect(viaPlugin.openApi?.title).toBe('Acme API');
    expect(viaPlugin.openApi).not.toHaveProperty('uiPath');
    expect(viaPlugin.openApi).not.toHaveProperty('uiFramework');
  });
});

/** The four names the two retired defs exported (2 schema consts + their types; `ApiTestingUiType` is both). */
const RETIRED_NAMES = [
  'ApiTestingUiConfigSchema',
  'ApiTestingUiConfigParsed',
  'ApiTestingUiConfig',
  'ApiTestingUiType',
] as const;
const RETIRED_DEFS = ['api/ApiTestingUiConfig', 'api/ApiTestingUiType'] as const;

describe('docs-viewer retirement — the orphan value defs leave whole', () => {
  it('every retired name has ZERO holders on any public entry; the carriers survive', () => {
    // Anti-vacuity: the baseline must cover the real surface.
    for (const needed of ['.', './api']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(exportNamesOf('./api').length, './api must export a non-trivial surface').toBeGreaterThan(50);

    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders after its retirement`).toEqual([]);
    }

    // SURVIVAL: the carrier defs and their neighbours stay — a narrowing, not a module sweep.
    const apiNames = exportNamesOf('./api');
    for (const name of [
      'ApiDocumentationConfigSchema',
      'ApiTestCollectionSchema',
      'OpenApiSpecSchema',
      'OpenApiGenerationConfigSchema',
      'RestApiPluginConfigSchema',
    ]) {
      expect(apiNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('the api barrel resolves without the retired schemas and keeps the survivors', async () => {
    const api = await import('./index');
    expect(api).not.toHaveProperty('ApiTestingUiConfigSchema');
    expect(api).not.toHaveProperty('ApiTestingUiType');
    expect(api).toHaveProperty('ApiDocumentationConfigSchema');
    expect(api).toHaveProperty('OpenApiGenerationConfigSchema');
  });
});

describe('docs-viewer retirement — ADR-0087 registration', () => {
  it('declares the three keys and the two defs under major 18, with one family D3 entry and no D2 conversion', () => {
    for (const key of [
      'api/ApiDocumentationConfig:ui',
      'api/OpenApiGenerationConfig:uiPath',
      'api/OpenApiGenerationConfig:uiFramework',
    ]) {
      expect(RETIRED_KEYS_BY_MAJOR[18], `${key} must be declared`).toContain(key);
    }
    for (const def of RETIRED_DEFS) {
      expect(RETIRED_DEFS_BY_MAJOR[18], `${def} must be declared`).toContain(def);
    }
    const step = MIGRATIONS_BY_MAJOR[18]!;
    const entry = step.semantic.find((e) => e.id === 'api-docs-viewer-keys-retired');
    expect(entry, 'the family D3 entry must be registered in the step-18 chain').toBeDefined();
    expect(entry!.surface).toBe(
      'ApiDocumentationConfig.ui / RestApiPluginConfig.openApi.uiPath / RestApiPluginConfig.openApi.uiFramework',
    );
    expect(entry!.replacement).toContain('`GET /api/v1/openapi.json`');
    expect(entry!.replacement).toContain('`api.enableOpenApi`');
    // The step's rationale names the family too (its STEP18_RATIONALE fragment).
    expect(step.rationale).toContain('`api-docs-viewer-keys-retired`');
    // Plugin TS configuration has no stored or stack source for a conversion to
    // rewrite — a conversion id naming these keys would be a strip with nothing to strip.
    expect(step.conversionIds.filter((id) => /ui-path|ui-framework|testing-ui|docs-viewer/.test(id))).toEqual([]);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — the tombstones type the three keys `never`
// and the retired names no longer resolve, so every typed authoring site fails
// to compile. The residue is what `tsc` does not judge: JSON, YAML, MD/MDX
// code fences, untyped `.js`, and TS literals cast through `as any` /
// `as never`. This walk covers that residue across five roots, each already
// declared for `@objectstack/spec#test` in `scripts/cross-package-test-inputs.mjs`
// and mirrored in `turbo.json` — the same roots and per-extension rule the
// compliance-families and rest_api retirement pins walk.
//
// Two legs:
//   1. REFERENCE — a retired NAME in an import/export specifier, a type
//      position, a method call, or the def's registry/manifest spelling
//      (`"api/ApiTestingUiConfig"`). A prose mention is not a reference.
//   2. STRUCTURAL — `uiPath` is not a unique name (`packages/rest/src/ui-routes.ts`
//      holds a local variable of that name for the unrelated `/ui/view` route)
//      and `ui` is an ordinary word, so an offender is an object literal (or
//      YAML mapping) whose OWN keys include `uiPath` or `uiFramework`, or that
//      is the VALUE of a `ui` key and carries a viewer-only member or a viewer
//      `type`. The schema declaration frame itself — the argument of a
//      `z.object(` / `strictObject(` call — is not an authoring.
//
// The bound, stated: a block assembled by SPREAD or computed keys, and a YAML
// flow mapping on one line, are invisible to the structural leg;
// `docs/**`, `.claude/**`, `.github/**` and the repo-root files are outside
// the radius.
describe('tree-scoped absence: nothing inside the declared radius still authors the docs-viewer surface', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` only the non-code extensions are scanned AND declared. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4).
   */
  const EXCLUDED = new Set([
    // This pin authors the retired surface to assert the schemas refuse it.
    THIS_FILE,
    // The upstream anchor: the PUBLISHED authorable surface the retirement is
    // measured against, written only by `gen:authorable-surface-base` and never
    // by hand. It records what 18.0.0 shipped, so it must still name the
    // retired def's keys until the anchor next moves.
    'packages/spec/authorable-surface.base.json',
  ]);
  const EXCLUDED_PREFIXES = [
    // Registers the retirement by key / def (entries, the template, the generated registry).
    'packages/spec/src/migrations/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  // ── Leg 1: references to a retired name ──────────────────────────────────
  const NAME = new RegExp('\\b(' + RETIRED_NAMES.join('|') + ')\\b');
  const REFERENCE = new RegExp(
    '(?:' +
      '[{,]\\s*(?:type\\s+)?' + NAME.source + '\\s*[,}]' +
      '|' +
      '(?:typeof\\s+|:\\s*|<)' + NAME.source + '\\b' +
      '|' +
      NAME.source + '\\.\\w+\\(' +
      '|' +
      '"(?:' + RETIRED_DEFS.join('|') + ')[":]' +
    ')',
  );

  // ── Leg 2: structural authorings ─────────────────────────────────────────
  const RETIRED_KEYS = ['uiPath', 'uiFramework'];
  /** Members only `ApiTestingUiConfigSchema` declared — an ordinary `ui` block carries none. */
  const VIEWER_MEMBERS = ['enableTryItOut', 'defaultModelsExpandDepth', 'displayRequestDuration', 'syntaxHighlighting', 'customCssUrl', 'customJsUrl'];
  /** The viewer `type` values the two retired enums offered (`custom` is too generic to judge). */
  const VIEWER_TYPES = new Set(['swagger-ui', 'redoc', 'rapidoc', 'stoplight', 'scalar', 'graphiql', 'postman', 'elements']);
  /** Callees whose `{` argument is a schema declaration, not an authoring. */
  const SCHEMA_CTORS = new Set(['object', 'strictObject', 'looseObject', 'extend']);

  interface Frame { kind: string; keys: Set<string>; values: Map<string, string>; parentKey?: string; schemaArg?: boolean; callee?: string }

  const isOffender = (f: Frame): boolean => {
    if (f.schemaArg) return false;
    if (RETIRED_KEYS.some((k) => f.keys.has(k))) return true;
    if (f.parentKey !== 'ui') return false;
    if (VIEWER_MEMBERS.some((k) => f.keys.has(k))) return true;
    const type = f.values.get('type');
    return type !== undefined && VIEWER_TYPES.has(type);
  };

  /**
   * One pass over JS/TS/JSON text: a stack of bracket frames, each `{` frame
   * collecting its OWN keys (an identifier or quoted string in key position,
   * after `{` or `,`, followed by `:`), the string value of each key, and the
   * key it is the VALUE of. Strings and comments are skipped; a single- or
   * double-quoted string never spans a line. Returns the 1-based line of each
   * closing brace whose frame offends.
   */
  const lexOffenders = (text: string): number[] => {
    const out: number[] = [];
    const stack: Frame[] = [];
    let lastSig = '';
    let lastIdent = '';
    let justKey: string | undefined;
    let colonKey: string | undefined;
    let line = 1;
    let i = 0;
    const n = text.length;
    const sawToken = (token: string, j: number) => {
      const top = stack[stack.length - 1];
      const isKey = text[j] === ':' && top?.kind === '{' && (lastSig === '{' || lastSig === ',');
      if (isKey) top!.keys.add(token);
      justKey = isKey ? token : undefined;
    };
    while (i < n) {
      const c = text[i]!;
      if (c === '\n') { line += 1; i += 1; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i += 1; continue; }
      if (c === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') line += 1; i += 1; }
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const start = i;
        i += 1;
        while (i < n && text[i] !== c) {
          if (text[i] === '\\') i += 1;
          else if (text[i] === '\n') { if (c !== '`') break; line += 1; }
          i += 1;
        }
        const token = text.slice(start + 1, i);
        i += 1;
        let j = i;
        while (j < n && (text[j] === ' ' || text[j] === '\t')) j += 1;
        const top = stack[stack.length - 1];
        if (lastSig === ':' && colonKey !== undefined && top?.kind === '{' && c !== '`') top.values.set(colonKey, token);
        if (c === '`') justKey = undefined;
        else sawToken(token, j);
        lastSig = 'str';
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        const start = i;
        while (i < n && /[\w$]/.test(text[i]!)) i += 1;
        const token = text.slice(start, i);
        let j = i;
        while (j < n && (text[j] === ' ' || text[j] === '\t')) j += 1;
        sawToken(token, j);
        lastSig = 'id';
        lastIdent = token;
        continue;
      }
      if (c === ':') {
        colonKey = justKey;
        justKey = undefined;
        lastSig = ':';
        i += 1;
        continue;
      }
      if (c === '{') {
        const top = stack[stack.length - 1];
        stack.push({
          kind: c,
          keys: new Set(),
          values: new Map(),
          parentKey: lastSig === ':' ? colonKey : undefined,
          schemaArg: lastSig === '(' && top?.kind === '(' && SCHEMA_CTORS.has(top.callee ?? ''),
        });
      } else if (c === '(') {
        stack.push({ kind: c, keys: new Set(), values: new Map(), callee: lastSig === 'id' ? lastIdent : undefined });
      } else if (c === '[') {
        stack.push({ kind: c, keys: new Set(), values: new Map() });
      } else if (c === '}' || c === ']' || c === ')') {
        const frame = stack.pop();
        if (frame?.kind === '{' && c === '}' && isOffender(frame)) out.push(line);
      }
      if (!/\s/.test(c)) { lastSig = c; justKey = undefined; }
      i += 1;
    }
    return out;
  };

  /**
   * YAML: any mapping line keyed `uiPath` / `uiFramework`, and a block mapping
   * opened by `ui:` whose OWN keys (the lines at its first child's column)
   * carry a viewer member or a viewer `type`. Returns 1-based lines.
   */
  const yamlOffenders = (text: string): number[] => {
    const rows = text.split('\n').map((raw, idx) => {
      const m = /^(\s*)(-\s+)?([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(raw);
      if (!m) return null;
      const value = m[4]!.replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
      return { idx, col: m[1]!.length + (m[2]?.length ?? 0), key: m[3]!, value, opensBlock: value === '' };
    });
    const out: number[] = [];
    rows.forEach((row, at) => {
      if (!row) return;
      if (RETIRED_KEYS.includes(row.key)) { out.push(row.idx + 1); return; }
      if (row.key !== 'ui' || !row.opensBlock) return;
      const frame: Frame = { kind: '{', keys: new Set(), values: new Map(), parentKey: 'ui' };
      let childCol: number | undefined;
      for (let k = at + 1; k < rows.length; k += 1) {
        const r = rows[k];
        if (!r) continue;
        if (r.col <= row.col) break;
        childCol ??= r.col;
        if (r.col === childCol) { frame.keys.add(r.key); frame.values.set(r.key, r.value); }
      }
      if (isOffender(frame)) out.push(row.idx + 1);
    });
    return out;
  };

  /** MD/MDX: only fenced code is judged — prose mentions and reference tables are not authorings. */
  const markdownOffenders = (text: string): number[] => {
    const out: number[] = [];
    const fence = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```/gm;
    for (let m = fence.exec(text); m; m = fence.exec(text)) {
      const lang = m[1]!.toLowerCase();
      const body = m[2]!;
      const offset = text.slice(0, m.index).split('\n').length;
      const hits = lang === 'yaml' || lang === 'yml' ? yamlOffenders(body) : lexOffenders(body);
      for (const h of hits) out.push(offset + h);
    }
    return out;
  };

  const mentions = (text: string): boolean =>
    RETIRED_KEYS.some((k) => text.includes(k)) || /\bui\b/.test(text);

  const structuralOffendersIn = (ext: string, text: string): number[] => {
    if (!mentions(text)) return [];
    if (ext === '.yaml' || ext === '.yml') return yamlOffenders(text);
    if (ext === '.md' || ext === '.mdx') return markdownOffenders(text);
    return lexOffenders(text);
  };

  const vanished: string[] = [];
  /** Tolerates ONLY a path's disappearance mid-walk; every other fault is re-raised. */
  const readIfPresent = (full: string, rel: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      vanished.push(rel);
      return undefined;
    }
  };

  it('the reference matcher recognises a reference and ignores a prose mention (anti-vacuity)', () => {
    expect(REFERENCE.test("import { ApiTestingUiConfigSchema } from '@objectstack/spec/api';")).toBe(true);
    expect(REFERENCE.test("import { type ApiTestingUiType, OpenApiSpecSchema } from '@objectstack/spec/api';")).toBe(true);
    expect(REFERENCE.test('const ui: ApiTestingUiConfig = { type: "redoc" };')).toBe(true);
    expect(REFERENCE.test('ApiTestingUiConfigSchema.parse(value)')).toBe(true);
    expect(REFERENCE.test('let v: z.infer<typeof ApiTestingUiType>;')).toBe(true);
    expect(REFERENCE.test('"api/ApiTestingUiConfig",')).toBe(true);
    expect(REFERENCE.test('"api/ApiTestingUiConfig:path",')).toBe(true);
    expect(REFERENCE.test('the `ApiTestingUiConfigSchema` export was removed')).toBe(false);
    expect(REFERENCE.test('"api/ApiTestCollection",')).toBe(false); // the live near-namesake
    expect(REFERENCE.test('import { ApiTestCollectionSchema } from "./documentation.zod";')).toBe(false);
  });

  it('the structural matcher finds an authoring and ignores every neighbouring shape (anti-vacuity)', () => {
    // Offenders — the retired spelling, in each syntax the walk reads.
    expect(structuralOffendersIn('.ts', "createPlugin({ openApi: { title: 'X', uiPath: '/api/docs' } } as never)")).toEqual([1]);
    expect(structuralOffendersIn('.ts', "const openApi = {\n  uiFramework: 'redoc',\n};")).toEqual([3]);
    expect(structuralOffendersIn('.json', '{ "openApi": { "uiPath": "/docs" } }')).toEqual([1]);
    expect(structuralOffendersIn('.ts', "const docs = { version: '1.0.0', ui: { type: 'swagger-ui' } };")).toEqual([1]);
    expect(structuralOffendersIn('.json', '{ "version": "1.0.0", "ui": { "enableTryItOut": true } }')).toEqual([1]);
    expect(structuralOffendersIn('.yaml', 'openApi:\n  title: X\n  uiPath: /api/docs\n')).toEqual([3]);
    expect(structuralOffendersIn('.yaml', 'documentation:\n  version: 1.0.0\n  ui:\n    type: scalar\n')).toEqual([3]);
    expect(structuralOffendersIn('.md', 'Prose.\n\n```ts\nconst openApi = { uiFramework: "elements" };\n```\n')).toEqual([4]);
    // Neighbours that must NOT match.
    // The REST server's `/ui/view` route: a LOCAL VARIABLE named `uiPath`, never a key.
    expect(structuralOffendersIn('.ts', 'const uiPath = `${basePath}/ui`;\nregister({ path: `${uiPath}/view/:object/:type` });')).toEqual([]);
    // The schema declaration itself: the `{` is `z.object(`'s argument, not an authoring.
    expect(structuralOffendersIn('.ts', "const S = z.object({ uiPath: retiredKey('gone'), uiFramework: retiredKey('gone') });")).toEqual([]);
    // An ordinary `ui` block carries no viewer member and no viewer type.
    expect(structuralOffendersIn('.ts', "({ ui: { type: 'grid', theme: 'dark', path: '/x' } })")).toEqual([]);
    expect(structuralOffendersIn('.yaml', 'ui:\n  type: kanban\n  theme: light\n')).toEqual([]);
    // A viewer type that is NOT the value of a `ui` key belongs to something else.
    expect(structuralOffendersIn('.ts', "({ renderer: { type: 'scalar' } })")).toEqual([]);
    // Prose, comments and quoted strings are not authorings.
    expect(structuralOffendersIn('.md', 'A host once wrote `uiPath: /api/docs` here.')).toEqual([]);
    expect(structuralOffendersIn('.ts', "// openApi: { uiPath: '/api/docs' }")).toEqual([]);
    expect(structuralOffendersIn('.ts', 'const s = "{ uiPath: \'/api/docs\' }";')).toEqual([]);
  });

  it('a path that VANISHES mid-walk is not a finding, and every other read fault still is', () => {
    const before = vanished.length;
    const gone = path.join(REPO_ROOT, 'packages/spec/does-not-exist.bundled_probe.mjs');
    expect(fs.existsSync(gone)).toBe(false);
    expect(readIfPresent(gone, 'probe/gone')).toBeUndefined();
    expect(vanished.slice(before)).toEqual(['probe/gone']);
    expect(readIfPresent(fileURLToPath(import.meta.url), THIS_FILE)).toContain('tree-scoped absence');
    expect(() => readIfPresent(path.join(REPO_ROOT, 'packages/spec'), 'probe/dir')).toThrow();
    expect(vanished.length).toBe(before + 1);
  });

  it('no reference to a retired name and no authoring of a retired key survives inside the declared radius', () => {
    const offenders: string[] = [];
    let visited = 0;
    let bearing = 0;
    // What git does not ignore, never the raw filesystem (`scripts/lib/repo-walk-testkit.ts`).
    const skipDir = (name: string) => SKIPPED_DIRS.has(name) || name.startsWith('.');
    for (const root of WALK_ROOTS) {
      for (const full of listRepoWalkFiles(path.join(REPO_ROOT, root), { skipDir })) {
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        const name = path.basename(full);
        const ext = path.extname(name);
        if (!(rel.startsWith('examples/') ? EXAMPLES_EXT : SCANNED_EXT).has(ext)) continue;
        if (name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(name)) continue;
        visited += 1;
        const text = readIfPresent(full, rel);
        if (text === undefined) continue;
        if (RETIRED_KEYS.some((k) => text.includes(k))) bearing += 1;
        const m = REFERENCE.exec(text);
        if (m) offenders.push(`${rel} references \`${m[0].trim()}\``);
        for (const lineNo of structuralOffendersIn(ext, text)) offenders.push(`${rel}:${lineNo} authors a retired docs-viewer key`);
      }
    }
    // Anti-vacuity: the walk covered the tree, and the files that CAN hold an
    // authoring (they spell a retired key at all) were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(bearing).toBeGreaterThan(2);
    expect(offenders, 'a surviving reference or authoring means the retirement is being undone').toEqual([]);
  });
});
