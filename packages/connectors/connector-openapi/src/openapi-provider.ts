// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  ConnectorProviderContext,
  ConnectorProviderFactory,
  ResolvedConnectorAuth,
} from '@objectstack/spec/integration';
import { ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';
import {
  createOpenApiConnector,
  operationActionKey,
  type OpenApiDocument,
  type RestAuth,
} from './openapi-connector.js';

/**
 * The provider key this package contributes (ADR-0097). A declarative
 * `connectors:` entry with `provider: 'openapi'` is materialized by this factory.
 */
export const OPENAPI_PROVIDER_KEY = 'openapi';

/**
 * HTTP statuses treated as **transient** when fetching a remote spec at boot
 * (#3049 follow-up): a timeout / rate-limit / 5xx means the spec endpoint is
 * momentarily unhealthy, not that the connector is misconfigured — so the
 * instance degrades and retries rather than aborting boot. Mirrors the
 * connector request-retry convention (`retryableStatusCodes` default in
 * `ConnectorSchema`). Any OTHER non-2xx (400 / 401 / 403 / 404 / 410 …) means
 * the request itself is wrong — a configuration fault that stays fatal.
 */
const SPEC_FETCH_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Injectable dependencies for {@link createOpenApiProviderFactory} (tests). */
export interface OpenApiProviderDeps {
  /** Injected fetch implementation (spec fetch + request transport); defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Shape of `providerConfig` for a `provider: 'openapi'` declarative instance. */
interface OpenApiProviderConfig {
  /**
   * The OpenAPI 3.x document: an inline object, an http(s) URL to fetch at
   * boot, or a file path resolved relative to the declaring stack/package root
   * (`'./billing-openapi.json'`, #3016).
   *
   * A remote URL that is unreachable / transiently failing (network error,
   * 408 / 429 / 5xx) degrades the instance and retries (#3049); a wrong URL
   * (non-retryable 4xx), an unparseable document, or a document that is not
   * OpenAPI 3.x (a Swagger 2.0 document included) stays a fatal config fault.
   */
  spec?: unknown;
  /** Override the base URL (else the document's `servers[0].url`). */
  baseUrl?: unknown;
  /**
   * Optional operation allowlist — only the listed operations become actions,
   * the same allowlist meaning as the `mcp` provider's `include` (tool names
   * there, action keys here). Each entry is an operation's `operationId`, or
   * the generated `method_path` key (`get_pets_id`) for an operation the
   * document gives no `operationId` — i.e. exactly the action key the
   * operation is exposed under. An entry naming an operation the document
   * does not carry is a configuration fault (see {@link resolveIncludeList}).
   */
  include?: unknown;
}

/**
 * Validate `providerConfig.include`: absent ⇒ every operation; otherwise an
 * array of non-empty strings. Any other shape is a configuration fault, thrown
 * plain (fatal at boot, a skipped entry on reload) — an allowlist that silently
 * dropped an entry it could not read would expose the very operations the
 * author meant to keep out, or hide the one they meant to keep in.
 */
function resolveIncludeList(raw: unknown, connectorName: string): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new Error(
      `connector-openapi provider: connector '${connectorName}' providerConfig.include must be an array of ` +
        `operation keys (strings): each an operationId, or the generated method_path key for an operation ` +
        `without one.`,
    );
  }
  return raw as string[];
}

/** How many of the document's action keys an unknown-entry refusal lists. */
const INCLUDE_REFUSAL_KEY_SAMPLE = 20;

/**
 * Refuse a document that is not OpenAPI 3.x — a Swagger 2.0 document
 * (`swagger: "2.0"`) included. The generator maps the 3.x shape only
 * (ADR-0023): a 2.0 document would "load" with its `host` / `basePath` ignored
 * and its `body` / `formData` parameters dropped, so the instance would come up
 * with wrong actions and no error. That is a configuration fault — fatal at
 * boot, a skipped entry on reload — and the runtime never converts: the remedy
 * is an offline conversion to 3.x.
 *
 * `source` names where the document came from (file path, URL, or inline), so
 * the refusal points at the thing to convert.
 */
function assertOpenApi3Document(document: object, source: string, connectorName: string): OpenApiDocument {
  const version = (document as { openapi?: unknown }).openapi;
  if (typeof version === 'string' && /^3\.\d+(\.\d+)?$/.test(version)) {
    return document as OpenApiDocument;
  }
  const swagger = (document as { swagger?: unknown }).swagger;
  const found =
    swagger !== undefined
      ? `a Swagger ${JSON.stringify(swagger)} document`
      : version === undefined
        ? `a document with no 'openapi' version field`
        : `a document declaring openapi: ${JSON.stringify(version)}`;
  throw new Error(
    `connector-openapi provider: connector '${connectorName}' providerConfig.spec ${source} is ${found}; ` +
      `this provider loads OpenAPI 3.x documents only and never converts at runtime. ` +
      `Convert the document to OpenAPI 3.x offline (a Swagger 2.0 → OpenAPI 3 converter) and point ` +
      `providerConfig.spec at the converted document.`,
  );
}

/**
 * Resolve `providerConfig.spec` into a parsed OpenAPI document (ADR-0097;
 * union per #3016): an inline document object (the reliable, no-I/O-at-boot
 * form used by the showcase), an http(s) URL fetched at materialization, or a
 * **file path** read through the host's `ctx.loadPackageFile` — which resolves
 * it relative to the declaring stack/package root and confines the read to
 * that root (absolute / `..`-escaping paths are rejected there).
 *
 * Fault classification (#3049 seam, symmetric with connector-mcp's connect
 * path): a remote spec URL that is unreachable or transiently failing throws
 * {@link ConnectorUpstreamUnavailableError} — the materializer degrades the
 * instance and retries. Every OTHER failure (missing spec, a wrong URL,
 * an unparseable document, no host file access) throws a plain error, which
 * stays fatal at boot / a skipped entry on reload. A document that is not
 * OpenAPI 3.x (Swagger 2.0 included) is one of those fatal faults, whichever of
 * the three forms carried it — see {@link assertOpenApi3Document}.
 */
async function loadOpenApiDocument(
  spec: unknown,
  fetchImpl: typeof fetch | undefined,
  ctx: ConnectorProviderContext,
): Promise<OpenApiDocument> {
  const connectorName = ctx.name;
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    return assertOpenApi3Document(spec, '(the inline document)', connectorName);
  }
  if (typeof spec === 'string' && spec.length > 0) {
    if (/^https?:\/\//i.test(spec)) {
      const doFetch = fetchImpl ?? fetch;
      let res: Response;
      let document: object;
      try {
        res = await doFetch(spec);
      } catch (err) {
        // The spec endpoint is unreachable — DNS / connection refused /
        // timeout / network error. Operational, not a config mistake: degrade
        // + retry rather than fail boot.
        throw new ConnectorUpstreamUnavailableError(
          `connector-openapi provider: connector '${connectorName}' could not reach spec URL '${spec}': ${(err as Error).message}`,
          { cause: err },
        );
      }
      if (!res.ok) {
        if (SPEC_FETCH_RETRYABLE_STATUS.has(res.status)) {
          // A transient server-side status (timeout / rate-limit / 5xx) — the
          // endpoint is momentarily unhealthy, so treat it as upstream-unavailable.
          throw new ConnectorUpstreamUnavailableError(
            `connector-openapi provider: connector '${connectorName}' got a transient HTTP ${res.status} fetching spec '${spec}'.`,
          );
        }
        // A non-retryable status (400 / 401 / 403 / 404 / 410 …) — the request
        // is wrong (bad URL, missing/insufficient auth for the spec endpoint):
        // a configuration fault that stays fatal.
        throw new Error(
          `connector-openapi provider: connector '${connectorName}' failed to fetch spec '${spec}' (HTTP ${res.status}).`,
        );
      }
      // A 2xx with an unparseable / non-object body is a content fault (the
      // endpoint served the wrong thing) — fatal, symmetric with the file-path
      // parse below.
      try {
        const parsed: unknown = await res.json();
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not a JSON object');
        }
        document = parsed;
      } catch (err) {
        throw new Error(
          `connector-openapi provider: connector '${connectorName}' fetched spec '${spec}' but it is not a parseable ` +
            `OpenAPI JSON document: ${(err as Error).message}`,
        );
      }
      return assertOpenApi3Document(document, `URL '${spec}'`, connectorName);
    }
    // File path — dereferenced through the host capability so resolution stays
    // anchored to (and confined within) the declaring stack/package root.
    if (!ctx.loadPackageFile) {
      throw new Error(
        `connector-openapi provider: connector '${connectorName}' providerConfig.spec '${spec}' is a file path, ` +
          `but this host provides no package file access — inline the OpenAPI document or use an http(s) URL.`,
      );
    }
    let text: string;
    try {
      text = await ctx.loadPackageFile(spec);
    } catch (err) {
      throw new Error(
        `connector-openapi provider: connector '${connectorName}' failed to read providerConfig.spec '${spec}': ` +
          `${(err as Error).message}`,
      );
    }
    let document: object;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not a JSON object');
      }
      document = parsed;
    } catch (err) {
      throw new Error(
        `connector-openapi provider: connector '${connectorName}' providerConfig.spec '${spec}' is not a parseable ` +
          `OpenAPI JSON document: ${(err as Error).message}`,
      );
    }
    return assertOpenApi3Document(document, `file '${spec}'`, connectorName);
  }
  throw new Error(
    `connector-openapi provider: connector '${connectorName}' requires providerConfig.spec — an inline OpenAPI 3.x ` +
      `document object, an http(s) URL, or a package-relative file path.`,
  );
}

/**
 * Build the `openapi` {@link ConnectorProviderFactory} (ADR-0097 / ADR-0023). At
 * boot the automation service invokes it for each `provider: 'openapi'`
 * declarative instance: it loads the OpenAPI document from `providerConfig.spec`,
 * then produces the same `{ def, handlers }` bundle {@link createOpenApiConnector}
 * generates for a hand-wired OpenAPI connector — one action per operation over
 * an HTTP transport, with the resolved `auth` applied — or, for a grant-bearing
 * instance (`oauth2`, `app-credential`), the `credentialHandle` asked on every
 * request (ADR-0143 D4); the document's `security` decides which operations
 * send it (see `createOpenApiConnector`).
 *
 * `providerConfig.include` (optional) narrows the actions to an allowlist of
 * operation keys, through the generator's own `include` predicate.
 *
 * Hard-fails on invalid config (missing spec, a wrong spec URL, an unparseable
 * document, a document that is not OpenAPI 3.x, a bad base URL, an `include`
 * that is not a string array or names an operation the document does not
 * carry), so a misconfigured instance fails boot loudly. A
 * remote spec URL that is merely unreachable / transiently failing instead
 * degrades the instance and retries (#3049) — see {@link loadOpenApiDocument}.
 */
export function createOpenApiProviderFactory(deps: OpenApiProviderDeps = {}): ConnectorProviderFactory {
  return async (ctx) => {
    const cfg = (ctx.providerConfig ?? {}) as OpenApiProviderConfig;
    if (cfg.baseUrl !== undefined && typeof cfg.baseUrl !== 'string') {
      throw new Error(
        `connector-openapi provider: connector '${ctx.name}' providerConfig.baseUrl must be a string when set.`,
      );
    }
    const includeList = resolveIncludeList(cfg.include, ctx.name);
    const document = await loadOpenApiDocument(cfg.spec, deps.fetchImpl, ctx);
    const auth = ctx.auth as ResolvedConnectorAuth | undefined as RestAuth | undefined;
    // The allowlist rides the generator's own `include` predicate; every key
    // the document offers is recorded on the way, so an entry nothing matched
    // can be named in the refusal below.
    const documentKeys: string[] = [];
    const include = includeList
      ? (op: Parameters<typeof operationActionKey>[0]) => {
          const key = operationActionKey(op);
          documentKeys.push(key);
          return includeList.includes(key);
        }
      : undefined;
    const bundle = createOpenApiConnector({
      name: ctx.name,
      label: ctx.label,
      description: ctx.description,
      document,
      baseUrl: typeof cfg.baseUrl === 'string' ? cfg.baseUrl : undefined,
      auth,
      // ADR-0143 D2.3 — a `signed` instance's signer, applied to every attempt.
      requestSigner: ctx.requestSigner,
      // ADR-0143 D4 — a grant-bearing instance's per-dispatch credential.
      credentialHandle: ctx.credentialHandle,
      include,
      // ADR-0049 · #18975 — the authored resilience policy, already resolved by
      // the materializer, reaches the transport this bundle closes over.
      retryConfig: ctx.retryConfig,
      requestTimeoutMs: ctx.requestTimeoutMs,
      fetchImpl: deps.fetchImpl,
    });
    if (includeList) {
      // An entry naming an operation the document does not carry is a
      // configuration fault, thrown plain — fatal at boot, a skipped entry on
      // reload. Ignoring it would bring the instance up without the action
      // the author listed (a typo, or an operation the upstream renamed or
      // removed), and the first sign would be a flow failing at run time.
      const offered = new Set(documentKeys);
      const unknown = [...new Set(includeList)].filter((entry) => !offered.has(entry));
      if (unknown.length > 0) {
        const sample = [...offered].slice(0, INCLUDE_REFUSAL_KEY_SAMPLE);
        const more = offered.size > sample.length ? `, … ${offered.size - sample.length} more` : '';
        throw new Error(
          `connector-openapi provider: connector '${ctx.name}' providerConfig.include names ` +
            `${unknown.map((entry) => `'${entry}'`).join(', ')}, which the OpenAPI document does not carry. ` +
            `Each entry must be an operationId, or the generated method_path key for an operation without one; ` +
            `the document offers ${offered.size} operation key(s): ` +
            `${sample.map((key) => `'${key}'`).join(', ')}${more}.`,
        );
      }
    }
    // Says so, so the host serves the `signed` instance (it refuses one whose
    // provider does not apply the signer).
    return ctx.requestSigner ? { ...bundle, requestSignerApplied: true } : bundle;
  };
}
