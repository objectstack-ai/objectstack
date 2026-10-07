// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `api.responseFormat` and `api.documentation.enabled` RETIRED (#20295) —
 * ADR-0049 enforce-or-remove; triage's grade, verbatim: 「Verdict: **RETIRE**
 * the 4 keys, by the maintainer's criterion」.
 *
 * [#20294] `api.documentation.version` RETIRED too, by ruling B on #20359:
 * the block's eight identity members are ENFORCED (they overlay the served
 * OpenAPI `info`, pinned in `packages/rest`'s
 * `rest-openapi-info-overlay.test.ts`) and `version` alone retires, because
 * the served `info.version` is the protocol version (#11646). The same ruling
 * made `documentation.title` `.optional()` — its never-served
 * `'ObjectStack API'` default is gone — which the CONTROL block below pins.
 *
 * Both sat on `RestApiConfigSchema` (the `api` sub-object of the REST
 * server's construction argument), were parsed, defaulted and copied into
 * `RestServer`'s config by `normalizeConfig` — and were read by nothing
 * (`liveness/rest_api.json`, re-measured before removal with lit controls in
 * this repo, in objectui at its pin and in cloud). `envelope: false` unwrapped
 * no response; `documentation.enabled: false` turned no document off, because
 * `api.enableOpenApi` decides that mount.
 *
 * Bookkeeping shapes, pinned below:
 *   1. `responseFormat` retires WHOLE — one `retiredKey()` tombstone for the
 *      container (the `crud.patterns` precedent): its three members were its
 *      only members and none was live. `documentation.enabled` is a tombstone
 *      INSIDE the live `documentation` block, whose other members keep parsing
 *      (they are a separate decision).
 *   2. Tombstones, not bare deletions: both objects are non-strict
 *      `z.object()`s, so a bare deletion would strip the key in silence
 *      (ADR-0104).
 *   3. No D2 conversion: a `RestServerConfig` is plugin TS configuration, never
 *      a stack collection member or a stored row. `RETIRED_KEYS_BY_MAJOR[18]`
 *      carries both keys; the D3 entry `rest-api-config-dead-keys-retired`
 *      carries the prescription to `os migrate meta` and the upgrade guide.
 *   4. The REST server's own construction-time refusal is pinned where it
 *      lives, in `packages/rest` (`rest-api-config-dead-keys-refused.test.ts`).
 *
 * On the assertion set (the #13823 precedent): a schema refusal raises a
 * `ZodError` whose issues carry `code` and `path` but no ADR-0112 `status` —
 * that envelope belongs to the API error surface. So these pins assert the
 * strongest set this surface has: refusal, the issue `code`, the `path` naming
 * the key, and the prescription text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { RestApiConfigSchema, RestServerConfigSchema, type RestApiConfig } from './rest-server.zod';

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself below.
const RESPONSE_FORMAT_PRESCRIPTION =
  /`api\.responseFormat` was removed in @objectstack\/spec 17\.5\.0 \(ADR-0049 enforce-or-remove\).*nothing ever read it.*`envelope: false` unwrapped no response.*Delete the key\..*Response shapes are fixed, not a server-wide option/s;
const DOCS_ENABLED_PRESCRIPTION =
  /`api\.documentation\.enabled` was removed in @objectstack\/spec 17\.5\.0 \(ADR-0049 enforce-or-remove\).*nothing ever read it.*decided by the sibling `api\.enableOpenApi`.*Delete the key; `api\.enableOpenApi: false` is the switch/s;
const DOCS_VERSION_PRESCRIPTION =
  /`api\.documentation\.version` was removed in @objectstack\/spec 17\.5\.0 \(ADR-0049 enforce-or-remove\).*nothing ever read it.*`info\.version` has one source: the protocol version.*`@objectstack\/spec` package.*Delete the key\. To publish your app's own release number, write it into `api\.documentation\.description`/s;

describe('rest_api retirement — `api.responseFormat`, at every door that parses the api block', () => {
  // Every former spelling is refused: the old defaults, the one that "meant"
  // something, and the empty block — the container itself is the tombstone.
  const FORMER_VALUES = [
    { envelope: false },
    { envelope: true, includeMetadata: true, includePagination: true },
    { includePagination: false },
    {},
  ];

  for (const value of FORMER_VALUES) {
    it(`RestApiConfigSchema refuses \`responseFormat: ${JSON.stringify(value)}\` at its path, with the prescription`, () => {
      const r = RestApiConfigSchema.safeParse({ responseFormat: value });
      expect(r.success).toBe(false);
      if (r.success) return;
      const issue = r.error.issues.find((i) => i.path[0] === 'responseFormat');
      expect(issue, 'the refusal must name `responseFormat`').toBeDefined();
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.path).toEqual(['responseFormat']);
      expect(issue!.message).toMatch(RESPONSE_FORMAT_PRESCRIPTION);
      // House convention 1: the fully-qualified key, in backticks, opens it.
      expect(issue!.message.startsWith('`api.responseFormat` was removed')).toBe(true);
    });
  }

  it('the whole-config door refuses it THROUGH `api`, located at `api.responseFormat`', () => {
    const r = RestServerConfigSchema.safeParse({ api: { responseFormat: { envelope: false } } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.join('.') === 'api.responseFormat');
    expect(issue, 'the refusal must locate `api.responseFormat`').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toMatch(RESPONSE_FORMAT_PRESCRIPTION);
  });

  it('fails tsc at the authoring site: the input type is `never`', () => {
    const authored: RestApiConfig = {
      version: 'v1',
      // @ts-expect-error — `responseFormat` is a retiredKey() tombstone: its input type is `never`.
      responseFormat: { envelope: false },
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => RestApiConfigSchema.parse(authored)).toThrow(RESPONSE_FORMAT_PRESCRIPTION);
  });
});

describe('rest_api retirement — `api.documentation.enabled`, a tombstone inside a live block', () => {
  for (const enabled of [false, true]) {
    it(`RestApiConfigSchema refuses \`documentation.enabled: ${enabled}\` — the old default included`, () => {
      const r = RestApiConfigSchema.safeParse({ documentation: { enabled, title: 'My API' } });
      expect(r.success).toBe(false);
      if (r.success) return;
      const issue = r.error.issues.find((i) => i.path.join('.') === 'documentation.enabled');
      expect(issue, 'the refusal must locate `documentation.enabled`').toBeDefined();
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.path).toEqual(['documentation', 'enabled']);
      expect(issue!.message).toMatch(DOCS_ENABLED_PRESCRIPTION);
      expect(issue!.message.startsWith('`api.documentation.enabled` was removed')).toBe(true);
    });
  }

  it('the whole-config door refuses it THROUGH `api`, located at `api.documentation.enabled`', () => {
    const r = RestServerConfigSchema.safeParse({ api: { documentation: { enabled: false } } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.join('.') === 'api.documentation.enabled');
    expect(issue).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toMatch(DOCS_ENABLED_PRESCRIPTION);
  });

  it('fails tsc at the authoring site: the input type is `never`', () => {
    const authored: RestApiConfig = {
      documentation: {
        title: 'My API',
        // @ts-expect-error — `documentation.enabled` is a retiredKey() tombstone: its input type is `never`.
        enabled: false,
      },
    };
    expect(() => RestApiConfigSchema.parse(authored)).toThrow(DOCS_ENABLED_PRESCRIPTION);
  });
});

describe('rest_api retirement — `api.documentation.version`, a second tombstone inside the live block', () => {
  // The old authored spellings: a release number, a semver-looking protocol
  // version, and an empty string.
  for (const version of ['2.3.0', '17.4.0', '']) {
    it(`RestApiConfigSchema refuses \`documentation.version: ${JSON.stringify(version)}\` at its path, with the prescription`, () => {
      const r = RestApiConfigSchema.safeParse({ documentation: { title: 'Acme Orders API', version } });
      expect(r.success).toBe(false);
      if (r.success) return;
      const issue = r.error.issues.find((i) => i.path.join('.') === 'documentation.version');
      expect(issue, 'the refusal must locate `documentation.version`').toBeDefined();
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.path).toEqual(['documentation', 'version']);
      expect(issue!.message).toMatch(DOCS_VERSION_PRESCRIPTION);
      // House convention 1: the fully-qualified key, in backticks, opens it.
      expect(issue!.message.startsWith('`api.documentation.version` was removed')).toBe(true);
      // Only the retired member is diagnosed — the enforced `title` beside it parses.
      expect(r.error.issues.map((i) => i.path.join('.'))).toEqual(['documentation.version']);
    });
  }

  it('the whole-config door refuses it THROUGH `api`, located at `api.documentation.version`', () => {
    const r = RestServerConfigSchema.safeParse({ api: { documentation: { version: '2.3.0' } } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.join('.') === 'api.documentation.version');
    expect(issue).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toMatch(DOCS_VERSION_PRESCRIPTION);
  });

  it('fails tsc at the authoring site: the input type is `never`', () => {
    const authored: RestApiConfig = {
      documentation: {
        title: 'Acme Orders API',
        // @ts-expect-error — `documentation.version` is a retiredKey() tombstone: its input type is `never`.
        version: '2.3.0',
      },
    };
    expect(() => RestApiConfigSchema.parse(authored)).toThrow(DOCS_VERSION_PRESCRIPTION);
  });

  it('`api.version` — the route identifier, a different key — is untouched by the tombstone', () => {
    const r = RestApiConfigSchema.safeParse({ version: 'v2', documentation: { title: 'Acme Orders API' } });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.version).toBe('v2');
  });
});

describe('rest_api retirement — CONTROL: the live keys are untouched', () => {
  it('a config without the retired keys parses; the replacement switch and the block\'s siblings keep their values', () => {
    const r = RestApiConfigSchema.safeParse({
      enableOpenApi: false,
      documentation: {
        title: 'ObjectStack API',
        description: 'd',
        termsOfService: 'https://example.com/terms',
        contact: { name: 'API Support', email: 'api@example.com' },
        license: { name: 'MIT' },
      },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    // The switch the prescription names is live and keeps an authored `false`.
    expect(r.data.enableOpenApi).toBe(false);
    // `documentation`'s enforced members parse byte-identically to before
    // (`version` left them in #20294 — its refusal is pinned above).
    expect(r.data.documentation).toEqual({
      title: 'ObjectStack API',
      description: 'd',
      termsOfService: 'https://example.com/terms',
      contact: { name: 'API Support', email: 'api@example.com' },
      license: { name: 'MIT' },
    });
  });

  it('absence stays absence: nothing re-defaults either retired key', () => {
    const empty = RestApiConfigSchema.parse({});
    expect(empty).not.toHaveProperty('responseFormat');
    expect(empty.enableOpenApi, 'the live switch still defaults on').toBe(true);
    // A present `documentation` block no longer grows `enabled: true`.
    const doc = RestApiConfigSchema.parse({ documentation: {} }).documentation;
    expect(doc).not.toHaveProperty('enabled');
    // [#20294] ...nor `title: 'ObjectStack API'`: `title` is `.optional()`,
    // because the served `info` is overlaid from this block and that default
    // was never the served title (the bundled one, 'ObjectStack REST API',
    // is). An empty block parses to an empty block — nothing authored,
    // nothing overlaid.
    expect(doc).toEqual({});
    expect(doc).not.toHaveProperty('title');
    expect(RestApiConfigSchema.parse({ documentation: { description: 'd' } }).documentation).toEqual({ description: 'd' });
  });
});

describe('rest_api retirement — ADR-0087 registration', () => {
  it('declares both keys under major 18 and carries one D3 entry for the family, with no D2 conversion', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('api/RestApiConfig:responseFormat');
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('api/RestApiConfig:documentation.enabled');
    const step = MIGRATIONS_BY_MAJOR[18]!;
    const entry = step.semantic.find((e) => e.id === 'rest-api-config-dead-keys-retired');
    expect(entry, 'the family D3 entry must be registered in the step-18 chain').toBeDefined();
    expect(entry!.surface).toBe('restServer.api.responseFormat / restServer.api.documentation.enabled');
    expect(entry!.replacement).toContain('`api.enableOpenApi`');
    // Plugin TS configuration has no stored or stack source for a conversion to
    // rewrite — the `RestServerConfig` retirement (commit b3a63d32c) / `openApi31`
    // shape. A conversion id naming either key would be a strip with nothing to strip.
    expect(step.conversionIds.filter((id) => /response-format|documentation-enabled/.test(id))).toEqual([]);
  });

  it('declares `documentation.version` under major 18 with its own family D3 entry, and no D2 conversion', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('api/RestApiConfig:documentation.version');
    const step = MIGRATIONS_BY_MAJOR[18]!;
    const entry = step.semantic.find((e) => e.id === 'rest-api-documentation-version-retired');
    expect(entry, 'the family D3 entry must be registered in the step-18 chain').toBeDefined();
    expect(entry!.surface).toBe('restServer.api.documentation.version');
    expect(entry!.replacement).toContain('`api.documentation.description`');
    expect(step.conversionIds.filter((id) => /documentation-version/.test(id))).toEqual([]);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types both keys `never` on
// `RestApiConfig`, so every typed authoring site fails to compile, and the
// REST server refuses both at construction. The residue is what neither
// judges before runtime: JSON, YAML, MD/MDX code fences, untyped `.js`, and TS
// literals cast through `as any` / `as never` (a config handed to the plugin
// the way cloud's hosts do). This walk covers that residue across five roots,
// each already declared for `@objectstack/spec#test` in
// `scripts/cross-package-test-inputs.mjs` and mirrored in `turbo.json` — the
// same roots and extensions the view-item and connector retirement pins walk.
//
// ⭐ `documentation` and `responseFormat` are not unique names (an OpenAPI-style
// `responseFormat` is a plausible future AI key; `documentation` is an ordinary
// word and an error-schema field), so the matcher is STRUCTURAL: an offender
// is an object literal (or YAML mapping) that is the VALUE of a
// `responseFormat` key and carries one of the retired members
// (`envelope` / `includeMetadata` / `includePagination`), or the value of a
// `documentation` key that carries `enabled` or (since #20294) `version`.
// Nothing else — the route identifier `api.version` is a sibling of
// `documentation`, never inside it, so it does not match.
//
// The bound, stated: a block assembled by SPREAD or computed keys, and a YAML
// flow mapping (`responseFormat: { envelope: false }` on one YAML line), are
// invisible to this walk; `docs/**`, `.claude/**`, `.github/**` and the
// repo-root files are outside the radius.
describe('tree-scoped absence: no `api` block inside the declared radius still authors the retired keys', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` only the non-code extensions are scanned AND declared. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);
  const RESPONSE_FORMAT_MEMBERS = ['envelope', 'includeMetadata', 'includePagination'];

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired keys on an `api` block.
   */
  const EXCLUDED = new Set([
    // This pin authors both keys to assert the schema refuses them.
    THIS_FILE,
    // The REST server's construction-time refusal pins author both keys to
    // assert the SERVER refuses them — the other half of the same kit.
    'packages/rest/src/rest-api-config-dead-keys-refused.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /** [#20294] `version` joined `enabled` as a retired `documentation` member. */
  const DOCUMENTATION_RETIRED_MEMBERS = ['enabled', 'version'];

  const isOffender = (parentKey: string | undefined, keys: Set<string>): boolean =>
    (parentKey === 'responseFormat' && RESPONSE_FORMAT_MEMBERS.some((k) => keys.has(k)))
    || (parentKey === 'documentation' && DOCUMENTATION_RETIRED_MEMBERS.some((k) => keys.has(k)));

  /**
   * One pass over JS/TS/JSON text: a stack of bracket frames, each `{` frame
   * collecting its OWN keys — an identifier or quoted string in key position
   * (after `{` or `,`) followed by `:` — and remembering the key it is the
   * VALUE of (a `{` whose previous significant token is the `:` of a key).
   * Strings and comments are skipped; a single- or double-quoted string never
   * spans a line, so a mis-lexed quote (a regex literal) costs at most that
   * line. Returns the 1-based line of each closing brace whose frame offends.
   */
  const lexOffenders = (text: string): number[] => {
    const out: number[] = [];
    const stack: { kind: string; keys: Set<string>; parentKey?: string }[] = [];
    let lastSig = '';
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
        continue;
      }
      if (c === ':') {
        colonKey = justKey;
        justKey = undefined;
        lastSig = ':';
        i += 1;
        continue;
      }
      if (c === '{') stack.push({ kind: c, keys: new Set(), parentKey: lastSig === ':' ? colonKey : undefined });
      else if (c === '[' || c === '(') stack.push({ kind: c, keys: new Set() });
      else if (c === '}' || c === ']' || c === ')') {
        const frame = stack.pop();
        if (frame?.kind === '{' && c === '}' && isOffender(frame.parentKey, frame.keys)) out.push(line);
      }
      if (!/\s/.test(c)) { lastSig = c; justKey = undefined; }
      i += 1;
    }
    return out;
  };

  /**
   * YAML: a block mapping opened by `responseFormat:` / `documentation:` with
   * no inline value; its OWN keys are the lines at its first child's column,
   * until a line at or above the opener's column. Returns the 1-based line of
   * each offending opener.
   */
  const yamlOffenders = (text: string): number[] => {
    const rows = text.split('\n').map((raw, idx) => {
      const m = /^(\s*)(-\s+)?([A-Za-z_][\w]*)\s*:/.exec(raw);
      if (!m) return null;
      const opensBlock = /^\s*(-\s+)?[A-Za-z_][\w]*\s*:\s*(#.*)?$/.test(raw);
      return { idx, col: m[1]!.length + (m[2]?.length ?? 0), key: m[3]!, opensBlock };
    });
    const out: number[] = [];
    rows.forEach((row, at) => {
      if (!row || !row.opensBlock || (row.key !== 'responseFormat' && row.key !== 'documentation')) return;
      const keys = new Set<string>();
      let childCol: number | undefined;
      for (let k = at + 1; k < rows.length; k += 1) {
        const r = rows[k];
        if (!r) continue;
        if (r.col <= row.col) break;
        childCol ??= r.col;
        if (r.col === childCol) keys.add(r.key);
      }
      if (isOffender(row.key, keys)) out.push(row.idx + 1);
    });
    return out;
  };

  /** MD/MDX: only fenced code is judged — prose mentions are not authorings. */
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

  const mentions = (text: string): boolean => text.includes('responseFormat') || text.includes('documentation');

  const offendersIn = (ext: string, text: string): number[] => {
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

  it('the matcher finds an authoring and ignores every neighbouring shape (anti-vacuity)', () => {
    // Offenders — the retired spelling, in each syntax the walk reads.
    expect(offendersIn('.ts', 'createRestApiPlugin({ api: { api: { responseFormat: { envelope: false } } } } as never)')).toEqual([1]);
    expect(offendersIn('.ts', "const api = {\n  documentation: {\n    contact: { name: 'x' },\n    enabled: false,\n  },\n};")).toEqual([5]);
    expect(offendersIn('.json', '{ "api": { "responseFormat": { "includePagination": false } } }')).toEqual([1]);
    expect(offendersIn('.yaml', 'api:\n  documentation:\n    title: X\n    enabled: false\n')).toEqual([2]);
    expect(offendersIn('.yaml', 'api:\n  responseFormat:\n    includeMetadata: false\n')).toEqual([2]);
    // [#20294] the retired `documentation.version`, in the three syntaxes.
    expect(offendersIn('.ts', "createRestApiPlugin({ api: { api: { documentation: { title: 'X', version: '2.3.0' } } } } as never)")).toEqual([1]);
    expect(offendersIn('.json', '{ "api": { "documentation": { "version": "1.0.0" } } }')).toEqual([1]);
    expect(offendersIn('.yaml', 'api:\n  documentation:\n    title: X\n    version: 1.0.0\n')).toEqual([2]);
    expect(offendersIn('.md', 'Prose.\n\n```ts\nnew RestServer(s, p, { api: { responseFormat: { envelope: false } } });\n```\n')).toEqual([4]);
    // Neighbours that must NOT match.
    // The agent alias map spells `responseFormat` with a STRING value.
    expect(offendersIn('.ts', "const ALIASES = { output: 'structuredOutput', responseFormat: 'structuredOutput' };")).toEqual([]);
    // An OpenAI-style `responseFormat` object carries none of the retired members.
    expect(offendersIn('.ts', "chat({ responseFormat: { type: 'json_schema' } })")).toEqual([]);
    // `documentation` without `enabled`; an `enabled` NESTED one level down belongs to another block.
    expect(offendersIn('.ts', "({ documentation: { title: 'X', contact: { enabled: true } } })")).toEqual([]);
    // The schema declaration itself: the `{` is `z.object(`'s argument, not the key's value.
    expect(offendersIn('.ts', "documentation: z.object({ enabled: retiredKey('gone') })")).toEqual([]);
    // A ternary's `:` is not a key's.
    expect(offendersIn('.ts', "const documentation = 1; const v = ok ? documentation : { enabled: true };")).toEqual([]);
    // Prose, comments and quoted strings are not authorings.
    expect(offendersIn('.md', 'A host once wrote `responseFormat: { envelope: false }` here.')).toEqual([]);
    expect(offendersIn('.ts', '// responseFormat: { envelope: false }')).toEqual([]);
    expect(offendersIn('.ts', 'const s = "{ responseFormat: { envelope: false } }";')).toEqual([]);
    // A YAML `documentation` mapping whose `enabled` belongs to a nested block.
    expect(offendersIn('.yaml', 'documentation:\n  title: X\n  contact:\n    enabled: true\n')).toEqual([]);
    // [#20294] the route identifier `api.version` sits BESIDE `documentation`, not in it.
    expect(offendersIn('.ts', "({ api: { version: 'v1', documentation: { title: 'X' } } })")).toEqual([]);
    // The enforced members alone are not an authoring of a retired key.
    expect(offendersIn('.ts', "({ documentation: { title: 'X', description: 'd', license: { name: 'MIT' } } })")).toEqual([]);
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

  it('no `api` block authoring `responseFormat`, `documentation.enabled` or `documentation.version` survives inside the declared radius', () => {
    const offenders: string[] = [];
    let visited = 0;
    let bearing = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        if (!(rel.startsWith('examples/') ? EXAMPLES_EXT : SCANNED_EXT).has(ext)) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        const text = readIfPresent(full, rel);
        if (text === undefined) continue;
        if (text.includes('responseFormat')) bearing += 1;
        for (const lineNo of offendersIn(ext, text)) offenders.push(`${rel}:${lineNo}`);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk covered the tree, and the files that CAN hold an
    // authoring (they spell the key at all) were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(bearing).toBeGreaterThan(5);
    expect(offenders, 'an `api` block authoring a retired key means the retirement is being undone').toEqual([]);
  });
});
