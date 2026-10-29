// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * normalize-openapi -- the OFFLINE half of the declarative `openapi` provider
 * (ADR-0023, ADR-0097): turn a vendor OpenAPI / Swagger document into the one
 * shape the provider loads, a self-contained OpenAPI 3.x JSON document.
 *
 *   pnpm --filter @objectstack/connector-openapi normalize-openapi \
 *     --in <file | http(s) URL> --out <file.json> \
 *     [--include-pattern <regex>]... [--max-depth <n>] [--server-url <url>] \
 *     [--empty-consumes <media type>]
 *
 * The runtime never converts: `openapi-provider.ts` refuses a document that is
 * not 3.x, and the generator skips a `$ref` parameter, request body or response
 * (`openapi-connector.ts`), so the action it derives silently loses that part.
 * Everything that would otherwise be done wrong at boot is done here, once, by
 * the shelf pipeline or the app author:
 *
 *   1. read the document from a file or URL, JSON or YAML;
 *   2. bundle every external `$ref` (other files, other URLs) into the document;
 *   3. convert Swagger 2.0 to OpenAPI 3.0 (`@scalar/openapi-upgrader`); a 3.x
 *      document keeps its version;
 *   4. dereference every `$ref` reachable from `paths` / `webhooks`, then drop
 *      the reusable `components` sections nothing points at any more (the
 *      `securitySchemes` stay: they are referenced by name, not by `$ref`);
 *   5. make `servers[0].url` absolute (server variables take their defaults; a
 *      relative URL resolves against the source URL, or `--server-url`);
 *   6. optionally compute the `providerConfig.include` list from allow-patterns;
 *   7. write the JSON and print its sha256 -- the hash of the bytes written.
 *
 * ## Where a `$ref` is cut, and why it has to be
 *
 * "No `$ref` left" and "every schema fully inlined" cannot both hold for a real
 * vendor document. A recursive schema has no finite inline form, and even the
 * acyclic expansion explodes: measured on Stripe's `spec3.json` (3.0.0, 431
 * paths, 612 operations, 117 back-edges among its component schemas), EVERY
 * one of the 612 operations expands past 2,000,000 JSON nodes when only true
 * recursion is cut. So a schema `$ref` is replaced by a stub in two cases:
 *
 *   - `recursive` -- the reference is already being expanded on this path;
 *   - `max-depth` -- `--max-depth` named-schema hops are already open above it.
 *
 * The stub keeps the target's `type`, `nullable`, `title` and `description`
 * and says, in its description, which reference was not expanded and why, so
 * an AI reading the action schema sees a typed, explained leaf rather than a
 * dangling pointer. Only SCHEMA references are cut: a `$ref` parameter,
 * response, request body, header or path item is always inlined, because a
 * stub there is a parameter with no `name` and no `in`. Every cut is counted in
 * the printed summary.
 *
 * ## The one Swagger 2.0 repair, and why it refuses by default
 *
 * An operation-level `consumes: []` clears the global list (Swagger 2.0 spec),
 * so a faithful conversion gives that operation's request body NO media type --
 * and a 3.x request body with no media type carries no schema at all: the body
 * would vanish from the action without an error. DocuSign's eSignature document
 * does this on all of its operations. The script refuses such a document and
 * names the operations; `--empty-consumes application/json` says which media
 * type to use instead, and the summary counts the operations it filled.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundle } from '@scalar/json-magic/bundle';
import { fetchUrls, parseJson, parseYaml, readFiles } from '@scalar/json-magic/bundle/plugins/node';
import { normalize as parseJsonOrYaml } from '@scalar/json-magic/helpers/normalize';
import { upgrade } from '@scalar/openapi-upgrader';

// The provider's own derivation of an action key -- the key
// `providerConfig.include` is matched against. Imported, never re-derived: an
// include list computed with a copy could disagree with the provider it feeds.
import { operationActionKey } from '../src/openapi-connector.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/** HTTP methods an OpenAPI path item can carry, in the generator's order. */
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/** The default `--max-depth`: named-schema hops inlined before a stub. */
export const DEFAULT_MAX_DEPTH = 2;

/** Options for {@link normalizeOpenApi}. */
export interface NormalizeOptions {
  /** A file path (resolved against `cwd`) or an http(s) URL. */
  input: string;
  /** Allow-patterns (JavaScript regular expressions) for the generated `include` list. */
  includePatterns?: readonly string[];
  /** Named-schema hops inlined before a stub (default {@link DEFAULT_MAX_DEPTH}). */
  maxDepth?: number;
  /** Absolute http(s) URL that replaces `servers[0].url`. */
  serverUrl?: string;
  /** Media type used for a Swagger 2.0 operation whose effective `consumes` is empty. */
  emptyConsumes?: string;
  /** Injected fetch (tests); defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Base directory for a relative file `input` (default `process.cwd()`). */
  cwd?: string;
}

/** What {@link normalizeOpenApi} produced. */
export interface NormalizeResult {
  /** The normalized OpenAPI 3.x document. */
  document: JsonObject;
  /** The exact text to write: `JSON.stringify(document, null, 2)` plus a newline. */
  text: string;
  /** sha256 (hex) of `text` encoded as UTF-8 -- the bytes written. */
  sha256: string;
  /** The source document's version: `swagger` for 2.0, else `openapi`. */
  sourceVersion: string;
  /** The output document's `openapi` version. */
  openapi: string;
  /** Every operation's action key, in document order, de-duplicated. */
  operationKeys: string[];
  /** The `providerConfig.include` list, when allow-patterns were given. */
  include?: string[];
  /** Schema references replaced by a stub, by reason. */
  cuts: CutCounts;
  /** `$ref` keys left in the output -- only ever inside literal data (an example value). */
  refsLeft: number;
  /** Swagger 2.0 operations whose empty `consumes` was filled by `emptyConsumes`. */
  filledConsumes: string[];
}

/** A refusal: the input cannot be normalized as given. The message names the remedy. */
export class NormalizeError extends Error {
  override name = 'NormalizeError';
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/**
 * Normalize one OpenAPI / Swagger document. Pure apart from reading the input
 * (and any external `$ref`); writing is {@link main}'s job, so the hash a caller
 * gets is the hash of `text`, whatever it does with it.
 */
export async function normalizeOpenApi(options: NormalizeOptions): Promise<NormalizeResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new NormalizeError(`--max-depth must be a non-negative integer, got ${String(options.maxDepth)}.`);
  }
  const fromUrl = isHttpUrl(options.input);
  const origin = fromUrl ? options.input : resolvePath(options.cwd ?? process.cwd(), options.input);
  const fetchImpl = options.fetchImpl ?? fetch;

  // 1. Read and parse the root document.
  let raw: string;
  try {
    if (fromUrl) {
      const res = await fetchImpl(origin);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.text();
    } else {
      raw = await readFile(origin, 'utf8');
    }
  } catch (err) {
    throw new NormalizeError(`could not read '${options.input}': ${(err as Error).message}`);
  }
  const parsed = parseJsonOrYaml(raw);
  if (!isObject(parsed)) {
    throw new NormalizeError(`'${options.input}' is not a JSON or YAML object.`);
  }

  // 2. Bundle external references. A file document may reach files beside it
  // (confined to its own directory); a URL document reaches URLs only, never
  // the local disk.
  const unresolved: string[] = [];
  const bundled = (await bundle(parsed, {
    plugins: [
      ...(fromUrl ? [] : [readFiles({ basePath: dirname(origin) })]),
      fetchUrls({ fetch: fetchImpl }),
      parseJson(),
      parseYaml(),
    ],
    treeShake: false,
    origin,
    hooks: {
      onResolveError: (node) => {
        unresolved.push(String(node.$ref));
      },
    },
  })) as JsonObject;
  if (unresolved.length > 0) {
    throw new NormalizeError(
      `'${options.input}' has external $ref(s) that could not be loaded: ${unresolved.map((r) => `'${r}'`).join(', ')}.`,
    );
  }

  // 3. Convert Swagger 2.0; keep any 3.x version as it is.
  const sourceVersion = String(bundled.swagger ?? bundled.openapi ?? '');
  const filledConsumes: string[] = [];
  let document: JsonObject;
  if (bundled.swagger === '2.0') {
    fillEmptyConsumes(bundled, options.emptyConsumes, filledConsumes);
    document = upgrade(bundled, '3.0') as unknown as JsonObject;
  } else if (typeof bundled.openapi === 'string' && /^3\.\d+(\.\d+)?$/.test(bundled.openapi)) {
    document = bundled;
  } else {
    throw new NormalizeError(
      `'${options.input}' is neither Swagger 2.0 nor OpenAPI 3.x ` +
        `(swagger: ${JSON.stringify(bundled.swagger ?? null)}, openapi: ${JSON.stringify(bundled.openapi ?? null)}).`,
    );
  }

  // 4. Dereference everything reachable from the operations, then drop what
  // only existed to be referenced.
  const cuts: CutCounts = { recursive: 0, maxDepth: 0, extension: 0 };
  const deref = new Dereferencer(document, maxDepth, cuts);
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(document)) {
    if (key === 'x-ext' || key === 'x-ext-urls') continue;
    if (key === 'components') {
      const securitySchemes = isObject(value) ? value.securitySchemes : undefined;
      if (isObject(securitySchemes)) out.components = { securitySchemes: deref.structural(securitySchemes) };
      continue;
    }
    out[key] = key === 'paths' || key === 'webhooks' ? deref.structural(value) : value;
  }

  // 5. An absolute servers[0].url.
  out.servers = absoluteServers(out.servers, fromUrl ? origin : undefined, options.serverUrl);

  // 6. Action keys, and the include list from the allow-patterns.
  const operations = listOperations(out);
  const operationKeys = [...new Set(operations.map((op) => op.key))];
  let include: string[] | undefined;
  if (options.includePatterns && options.includePatterns.length > 0) {
    const patterns = options.includePatterns.map((source) => {
      try {
        return new RegExp(source);
      } catch (err) {
        throw new NormalizeError(`--include-pattern '${source}' is not a valid regular expression: ${(err as Error).message}`);
      }
    });
    include = [
      ...new Set(
        operations
          .filter((op) => patterns.some((p) => p.test(op.key) || p.test(`${op.method.toUpperCase()} ${op.path}`)))
          .map((op) => op.key),
      ),
    ];
    if (include.length === 0) {
      throw new NormalizeError(
        `--include-pattern matched none of the ${operationKeys.length} operation(s); a pattern is tested against ` +
          `each action key (an operationId, or the method_path key) and against 'METHOD /path'.`,
      );
    }
  }

  // 7. The bytes, and their hash.
  const text = `${JSON.stringify(out, null, 2)}\n`;
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  return {
    document: out,
    text,
    sha256,
    sourceVersion,
    openapi: String(out.openapi),
    operationKeys,
    include,
    cuts,
    refsLeft: countRefs(out),
    filledConsumes,
  };
}

/** Count `$ref` keys anywhere in a value. */
function countRefs(node: Json): number {
  if (Array.isArray(node)) return node.reduce<number>((sum, item) => sum + countRefs(item), 0);
  if (!isObject(node)) return 0;
  let sum = 0;
  for (const [key, value] of Object.entries(node)) sum += (key === '$ref' ? 1 : 0) + countRefs(value);
  return sum;
}

/**
 * Swagger 2.0: an operation that takes a `body` / `formData` parameter but
 * whose effective `consumes` is an empty list would convert to a request body
 * with no media type, i.e. no schema. Refuse, or fill it from `emptyConsumes`.
 */
function fillEmptyConsumes(doc: JsonObject, emptyConsumes: string | undefined, filled: string[]): void {
  const globalConsumes = doc.consumes;
  const offending: { op: JsonObject; label: string }[] = [];
  for (const [path, item] of Object.entries(isObject(doc.paths) ? doc.paths : {})) {
    if (!isObject(item)) continue;
    const pathParams = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!isObject(op)) continue;
      const params = [...pathParams, ...(Array.isArray(op.parameters) ? op.parameters : [])];
      const takesBody = params.some((p) => isObject(p) && (p.in === 'body' || p.in === 'formData'));
      const effective = op.consumes ?? globalConsumes;
      if (takesBody && Array.isArray(effective) && effective.length === 0) {
        offending.push({ op, label: `${method.toUpperCase()} ${path}` });
      }
    }
  }
  if (offending.length === 0) return;
  if (!emptyConsumes) {
    const sample = offending.slice(0, 5).map((o) => `'${o.label}'`).join(', ');
    const more = offending.length > 5 ? `, … ${offending.length - 5} more` : '';
    throw new NormalizeError(
      `${offending.length} Swagger 2.0 operation(s) take a request body but declare an empty 'consumes' list ` +
        `(${sample}${more}), so a faithful conversion gives the body no media type and no schema. ` +
        `Pass --empty-consumes <media type> (for example application/json) to say which media type they accept.`,
    );
  }
  for (const { op, label } of offending) {
    op.consumes = [emptyConsumes];
    filled.push(label);
  }
}

/** Schema keywords whose values are literal data (instances), never schemas to dereference. */
const SCHEMA_LITERAL_KEYS = new Set(['example', 'examples', 'default', 'enum', 'const']);

/** Schema keywords whose values are maps of NAME -> schema (a property may be called `default`). */
const SCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);

/** Decode one JSON-pointer segment. */
const decodeSegment = (segment: string): string =>
  decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~');

/** Define an own property, so a `__proto__` key in the input stays a key. */
function put(target: JsonObject, key: string, value: Json): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Schema references replaced by a stub, by reason. */
export interface CutCounts {
  /** Already being expanded on the same path. */
  recursive: number;
  /** Beyond `--max-depth` named-schema hops. */
  maxDepth: number;
  /** Inside a vendor `x-` extension value, which is copied, not expanded. */
  extension: number;
}

/**
 * Inline every local `$ref` (after bundling, every `$ref` is local). Two
 * contexts: STRUCTURAL objects (path items, operations, parameters, responses,
 * request bodies, headers) are always inlined; SCHEMA objects -- everything at
 * or below a `schema` key -- are inlined up to `maxDepth` named hops and cut
 * on recursion (see the header). Literal data (`example`, a schema's
 * `default` / `enum` / `const` / `examples`, an Example Object) is copied as
 * it is; a vendor `x-` extension value is copied with each `$ref` in it
 * replaced by a stub, since what it pointed at is dropped with `components`.
 */
class Dereferencer {
  constructor(
    private readonly root: JsonObject,
    private readonly maxDepth: number,
    private readonly cuts: CutCounts,
  ) {}

  structural(node: Json | undefined): Json {
    return this.walk(node ?? null, [], 0, false);
  }

  private walk(node: Json, stack: readonly string[], depth: number, inSchema: boolean): Json {
    if (Array.isArray(node)) return node.map((item) => this.walk(item, stack, depth, inSchema));
    if (!isObject(node)) return node;
    if (typeof node.$ref === 'string') return this.follow(node, stack, depth, inSchema);
    const out: JsonObject = {};
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('x-')) {
        put(out, key, this.extension(value));
      } else if (inSchema && SCHEMA_LITERAL_KEYS.has(key)) {
        put(out, key, value);
      } else if (inSchema && SCHEMA_MAP_KEYS.has(key) && isObject(value)) {
        const map: JsonObject = {};
        for (const [name, schema] of Object.entries(value)) put(map, name, this.walk(schema, stack, depth, true));
        put(out, key, map);
      } else if (!inSchema && key === 'example') {
        put(out, key, value);
      } else if (!inSchema && key === 'examples' && isObject(value)) {
        // A map of Example Objects, each possibly a `$ref`; all literal data.
        const map: JsonObject = {};
        for (const [name, example] of Object.entries(value)) put(map, name, this.literal(example));
        put(out, key, map);
      } else {
        put(out, key, this.walk(value, stack, depth, inSchema || key === 'schema'));
      }
    }
    return out;
  }

  /** Literal data: a `$ref` to it is resolved, and nothing inside it is walked. */
  private literal(node: Json): Json {
    const seen = new Set<string>();
    let current = node;
    while (isObject(current) && typeof current.$ref === 'string' && !seen.has(current.$ref)) {
      seen.add(current.$ref);
      current = this.resolve(current.$ref);
    }
    return current;
  }

  /** An extension value, copied, with each `$ref` object replaced by a stub. */
  private extension(node: Json): Json {
    if (Array.isArray(node)) return node.map((item) => this.extension(item));
    if (!isObject(node)) return node;
    if (typeof node.$ref === 'string') {
      this.cuts.extension++;
      return this.stub(node.$ref, this.resolve(node.$ref), 'extension');
    }
    const out: JsonObject = {};
    for (const [key, value] of Object.entries(node)) put(out, key, this.extension(value));
    return out;
  }

  private follow(node: JsonObject, stack: readonly string[], depth: number, inSchema: boolean): Json {
    const ref = node.$ref as string;
    const { $ref: _ref, ...siblings } = node;
    const target = this.resolve(ref);
    if (inSchema) {
      const reason = stack.includes(ref) ? 'recursive' : depth >= this.maxDepth ? 'max-depth' : undefined;
      if (reason) {
        if (reason === 'recursive') this.cuts.recursive++;
        else this.cuts.maxDepth++;
        return { ...this.stub(ref, target, reason), ...this.walkSiblings(siblings, stack, depth) };
      }
    } else if (stack.includes(ref)) {
      throw new NormalizeError(`the document's $ref '${ref}' refers to itself outside a schema; it has no inline form.`);
    }
    const inlined = this.walk(target, [...stack, ref], inSchema ? depth + 1 : depth, inSchema);
    const extra = this.walkSiblings(siblings, stack, depth, inSchema);
    return isObject(inlined) ? { ...inlined, ...extra } : inlined;
  }

  private walkSiblings(siblings: JsonObject, stack: readonly string[], depth: number, inSchema = true): JsonObject {
    return this.walk(siblings, stack, depth, inSchema) as JsonObject;
  }

  /** A typed, explained leaf for a schema reference that is not expanded. */
  private stub(ref: string, target: Json, reason: 'recursive' | 'max-depth' | 'extension'): JsonObject {
    let shape: Json = target;
    const seen = new Set<string>([ref]);
    while (isObject(shape) && typeof shape.$ref === 'string' && !seen.has(shape.$ref)) {
      seen.add(shape.$ref);
      shape = this.resolve(shape.$ref);
    }
    const leaf: JsonObject = {};
    if (isObject(shape)) {
      if (typeof shape.type === 'string' || Array.isArray(shape.type)) leaf.type = shape.type;
      if (shape.nullable === true) leaf.nullable = true;
      if (typeof shape.title === 'string') leaf.title = shape.title;
    }
    const why =
      reason === 'recursive'
        ? 'a recursive reference'
        : reason === 'max-depth'
          ? `deeper than --max-depth ${this.maxDepth}`
          : 'referenced from a vendor extension';
    const note = `(Not expanded by normalize-openapi: '${ref}', ${why}.)`;
    const description = isObject(shape) && typeof shape.description === 'string' ? shape.description : '';
    leaf.description = description ? `${description}\n\n${note}` : note;
    return leaf;
  }

  private resolve(ref: string): Json {
    if (!ref.startsWith('#')) {
      throw new NormalizeError(`the $ref '${ref}' was not bundled; only local references can be inlined.`);
    }
    let node: Json | undefined = this.root;
    for (const segment of ref.slice(1).split('/').slice(1)) {
      const key = decodeSegment(segment);
      node = Array.isArray(node) ? node[Number(key)] : isObject(node) ? node[key] : undefined;
      if (node === undefined) throw new NormalizeError(`the $ref '${ref}' points at nothing in the document.`);
    }
    return node;
  }
}

/** Make every top-level server URL absolute; `serverUrl` replaces the first. */
function absoluteServers(servers: Json | undefined, sourceUrl: string | undefined, serverUrl: string | undefined): Json {
  const list: JsonObject[] = Array.isArray(servers) && servers.length > 0
    ? servers.filter(isObject)
    : [{ url: '/' }];
  if (serverUrl !== undefined) {
    if (!isAbsoluteHttpUrl(serverUrl)) {
      throw new NormalizeError(`--server-url must be an absolute http(s) URL, got '${serverUrl}'.`);
    }
    list[0] = { ...list[0], url: serverUrl };
    delete list[0].variables;
  }
  return list.map((server, index) => {
    const variables = isObject(server.variables) ? server.variables : {};
    const templated = String(server.url ?? '').replace(/\{([^}]+)\}/g, (_match, name: string) => {
      const variable = variables[name];
      if (isObject(variable) && typeof variable.default === 'string') return variable.default;
      throw new NormalizeError(`servers[${index}].url '${String(server.url)}' uses {${name}}, which has no default.`);
    });
    let url = templated;
    if (!isAbsoluteHttpUrl(url)) {
      if (!sourceUrl) {
        throw new NormalizeError(
          `servers[${index}].url '${templated}' is relative and the document was read from a file; ` +
            `pass --server-url <absolute URL> (the API's base URL).`,
        );
      }
      url = new URL(templated, sourceUrl).toString();
    }
    const { variables: _variables, ...rest } = server;
    return { ...rest, url };
  });
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Every operation of a normalized document, keyed as the provider keys it. */
function listOperations(doc: JsonObject): { key: string; method: string; path: string }[] {
  const ops: { key: string; method: string; path: string }[] = [];
  for (const [path, item] of Object.entries(isObject(doc.paths) ? doc.paths : {})) {
    if (!isObject(item)) continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!isObject(op)) continue;
      const operationId = typeof op.operationId === 'string' ? op.operationId : undefined;
      ops.push({ key: operationActionKey({ operationId, method, path }), method, path });
    }
  }
  return ops;
}

const USAGE =
  'usage: normalize-openapi --in <file | http(s) URL> --out <file.json> [--include-pattern <regex>]... ' +
  `[--max-depth <n> (default ${DEFAULT_MAX_DEPTH})] [--server-url <url>] [--empty-consumes <media type>]`;

/**
 * The CLI. Writes the document to `--out`, prints a JSON summary on stdout
 * (`sha256` is the hash of the bytes written) and returns the exit code:
 * 0 written, 1 refused (the message names the remedy), 2 usage error.
 */
export async function main(argv: readonly string[], io = { out: process.stdout, err: process.stderr }): Promise<number> {
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const value = argv[i + 1];
    if (!/^--(in|out|include-pattern|max-depth|server-url|empty-consumes)$/.test(arg) || value === undefined) {
      io.err.write(`normalize-openapi: unexpected argument '${arg}'.\n${USAGE}\n`);
      return 2;
    }
    (flags[arg.slice(2)] ??= []).push(value);
    i++;
  }
  const single = (name: string): string | undefined => flags[name]?.at(-1);
  const input = single('in');
  const outPath = single('out');
  if (!input || !outPath) {
    io.err.write(`normalize-openapi: --in and --out are required.\n${USAGE}\n`);
    return 2;
  }
  const depthFlag = single('max-depth');
  // Relative paths are the caller's: `pnpm --filter … normalize-openapi` runs
  // this in the package directory and records where it was typed in INIT_CWD.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  try {
    const result = await normalizeOpenApi({
      input,
      cwd,
      includePatterns: flags['include-pattern'],
      maxDepth: depthFlag === undefined ? undefined : Number(depthFlag),
      serverUrl: single('server-url'),
      emptyConsumes: single('empty-consumes'),
    });
    const target = resolvePath(cwd, outPath);
    await mkdir(dirname(target), { recursive: true });
    const bytes = Buffer.from(result.text, 'utf8');
    await writeFile(target, bytes);
    io.out.write(
      `${JSON.stringify(
        {
          out: target,
          bytes: bytes.length,
          sha256: result.sha256,
          sourceVersion: result.sourceVersion,
          openapi: result.openapi,
          operations: result.operationKeys.length,
          maxDepth: depthFlag === undefined ? DEFAULT_MAX_DEPTH : Number(depthFlag),
          cuts: result.cuts,
          refsLeft: result.refsLeft,
          filledConsumes: result.filledConsumes.length,
          ...(result.include ? { include: result.include } : {}),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  } catch (err) {
    if (err instanceof NormalizeError) {
      io.err.write(`normalize-openapi: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
