// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as QA from '@objectstack/spec/qa';
import { RestApiConfigSchema, CrudEndpointsConfigSchema } from '@objectstack/spec/api';
import { TestExecutionAdapter } from './adapter.js';

/** Memoised {@link conventionMounts} — the schemas are `lazySchema`, so build them once. */
let conventionCache: { apiBase: string; dataPath: string } | undefined;

/**
 * The paths a STOCK ObjectStack server serves the API base and the Data
 * Protocol under, derived from the two schemas `RestServer` resolves from.
 *
 * ## [#7848] Why this is derived and not written down
 *
 * Every record-shaped action type used to build `${baseUrl}/api/data/:object` —
 * a literal, one version segment short of the route the server registers, so
 * `create_record`, `read_record`, `update_record`, `delete_record` and
 * `query_records` (5 of the 8 declared `TestActionTypeSchema` members) answered
 * `HTTP Error 404: {"error":"Not found"}` against a stock boot. The suite author
 * reading that 404 has every reason to think it is their own URL.
 *
 * Replacing one literal with a corrected literal only moves the drift: the
 * server composes this path out of two declared pieces, and both of them are
 * configurable. So this asks the SAME schemas the server's own resolution asks:
 *
 *   - `RestApiConfigSchema` → `apiPath ?? `${basePath}/${version}`` — the exact
 *     expression `RestServer.getApiBasePath()` evaluates (`/api` + `v1`);
 *   - `CrudEndpointsConfigSchema.dataPrefix` — what `RestServer` appends to it
 *     to get `dataPath` (`/data`).
 *
 * These are the CONVENTION: what the schemas default to, which is what a
 * deployment serves until it says otherwise. `HttpTestAdapter` is handed an
 * origin and nothing else, so the convention is also all it can know before it
 * asks the server — which is what {@link HttpTestAdapter.resolveDataMount}
 * does (#7983). The `/discovery` path is derived here for the same reason the
 * data path is: `RestServer.registerDiscoveryEndpoints` mounts it at
 * `${getApiBasePath()}/discovery`, so a second literal would be a second place
 * to forget.
 */
function conventionMounts(): { apiBase: string; dataPath: string } {
  if (conventionCache === undefined) {
    const api = RestApiConfigSchema.parse({});
    const crud = CrudEndpointsConfigSchema.parse({});
    const apiBase = api.apiPath ?? `${api.basePath}/${api.version}`;
    conventionCache = { apiBase, dataPath: `${apiBase}${crud.dataPrefix}` };
  }
  return conventionCache;
}

/**
 * Where this adapter decided the Data Protocol is mounted, and on what evidence.
 *
 * `why` is not decoration — it is the whole difference between a 404 that reads
 * as the suite author's own URL mistake and one that names the mount it used
 * and where that mount came from (Route & surface ownership §3).
 */
interface ResolvedDataMount {
  /** The path prefix record actions address, e.g. `/api/v1/data`. */
  readonly path: string;
  /** `discovery` = the server told us; `convention` = the schemas' defaults. */
  readonly source: 'discovery' | 'convention';
  /** One clause naming the probe and its outcome. */
  readonly why: string;
}

export class HttpTestAdapter implements TestExecutionAdapter {
  /**
   * The single discovery probe of a run, memoised as the in-flight promise so
   * concurrent record actions share one request rather than racing N.
   *
   * `os test` builds ONE adapter for the whole run (`packages/cli/src/commands/
   * test.ts`) and hands it to every suite, so instance scope IS run scope.
   */
  private mountPromise?: Promise<ResolvedDataMount>;

  constructor(private baseUrl: string, private authToken?: string) {}

  /** The resolved data mount; probes at most once per adapter. */
  private dataMount(): Promise<ResolvedDataMount> {
    if (this.mountPromise === undefined) {
      this.mountPromise = this.resolveDataMount();
    }
    return this.mountPromise;
  }

  /**
   * Ask the server where it serves the Data Protocol, and fall back to the
   * convention — loudly — when it cannot say.
   *
   * ## [#7983] What the probe recovers, measured rather than assumed
   *
   * `@objectstack/client` answers the same question through discovery
   * (`getRoute`, `packages/client/src/index.ts`), and this follows it: prefer
   * the server's own `routes.data`, fall back to the convention. Measured on a
   * booted stack (REST generator + dispatcher bridge, three configs):
   *
   *   | deployment                     | `{apiBase}/discovery` | serves        |
   *   |--------------------------------|-----------------------|---------------|
   *   | stock                          | 200 `/api/v1/data`    | `/api/v1/data`|
   *   | `crud.dataPrefix: '/objects'`  | 200 `/api/v1/objects` | `/api/v1/objects` |
   *   | `api.apiPath: '/api/2026-01'`  | **404**               | `/api/2026-01/data` |
   *
   * So the probe closes the `dataPrefix` row exactly: `RestServer`'s discovery
   * handler substitutes the configured prefix into `routes.data`, and reading
   * it is strictly better than recomputing it here. The `apiPath` row it cannot
   * close, and the reason is structural rather than an oversight — `apiPath`
   * moves the base that discovery itself is mounted under, so the document that
   * would name the new mount is behind the very prefix we are missing.
   *
   * ⛔ And the one discovery document at a FIXED path does not rescue it:
   * `/.well-known/objectstack` is mounted at the site root by the dispatcher
   * bridge, but its `routes.data` is the DISPATCHER's own `${prefix}/data` —
   * measured as `/api/v1/data` under all three configs above, including the two
   * where the server serves elsewhere. Falling back to it would turn "we could
   * not resolve the mount" into "discovery told us `/api/v1/data`": the same
   * 404, now with a false provenance attached. Not probed, deliberately.
   *
   * Hence: one probe, then a diagnostic that NAMES the mount, the evidence and
   * the remedy. `api_call` takes the path it is given and is unaffected either
   * way — it stays the escape hatch for a host this cannot reach.
   */
  private async resolveDataMount(): Promise<ResolvedDataMount> {
    const { apiBase, dataPath } = conventionMounts();
    const probeUrl = `${this.baseUrl}${apiBase}/discovery`;
    let why: string;

    try {
      const headers: Record<string, string> = {};
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }
      const response = await fetch(probeUrl, { method: 'GET', headers });
      if (response.ok) {
        const body = await response.json();
        // `@objectstack/rest` answers the document bare; the dispatcher bridge
        // wraps it as `{ data: … }`. Pick the object that actually carries
        // `routes` rather than `body.data || body` — the document's own
        // `routes.data` key makes the looser test ambiguous to read here.
        const doc = (body && typeof body === 'object' && 'routes' in body)
          ? (body as { routes?: Record<string, unknown> })
          : ((body as { data?: { routes?: Record<string, unknown> } } | null)?.data);
        const advertised = doc?.routes?.data;
        if (typeof advertised === 'string' && advertised.length > 0) {
          return {
            path: advertised,
            source: 'discovery',
            why: `GET ${probeUrl} advertised routes.data`,
          };
        }
        why = `GET ${probeUrl} answered ${response.status} but carried no routes.data`;
      } else {
        why = `GET ${probeUrl} answered ${response.status}`;
      }
    } catch (error) {
      why = `GET ${probeUrl} could not be reached (${(error as Error).message})`;
    }

    const mount: ResolvedDataMount = { path: dataPath, source: 'convention', why };
    // Absence must be loud (Route & surface ownership §3): state the mount that
    // will be addressed, the evidence for it, and what to do about a host this
    // cannot reach — never leave the bare 404 to be diagnosed.
    console.warn(
      `[HttpTestAdapter] Data Protocol mount NOT resolved from discovery. `
      + `Record actions (create_record, read_record, update_record, delete_record, query_records) `
      + `will address ${this.baseUrl}${dataPath}, the convention declared by RestApiConfigSchema `
      + `(apiPath ?? basePath/version) + CrudEndpointsConfigSchema.dataPrefix. Evidence: ${why}. `
      + `A deployment that sets crud.dataPrefix is normally recovered by this probe; one that sets `
      + `api.apiPath moves discovery itself out from under it, and no fixed-path document reports `
      + `the REST mount — write those steps as api_call, which takes the path you give it.`,
    );
    return mount;
  }

  /** `{baseUrl}{dataMount}/{object}` — the collection URL. */
  private collectionUrl(mount: ResolvedDataMount, objectName: string): string {
    return `${this.baseUrl}${mount.path}/${encodeURIComponent(objectName)}`;
  }

  /** `{collection}/{id}` — the single-record URL. */
  private recordUrl(mount: ResolvedDataMount, objectName: string, id: unknown): string {
    return `${this.collectionUrl(mount, objectName)}/${encodeURIComponent(String(id))}`;
  }

  /**
   * The provenance clause appended to a failed record action's error.
   *
   * The card this closes is about a 404 that reads like the author's own URL
   * mistake; the mount is the one fact that distinguishes the two, so it rides
   * on the failure itself rather than only on a warning printed earlier in the
   * transcript.
   */
  private mountNote(mount: ResolvedDataMount): string {
    const how = mount.source === 'discovery'
      ? 'resolved from discovery'
      : 'assumed by convention — the server was not able to state it';
    return `record actions addressed ${this.baseUrl}${mount.path} (data mount ${how}: ${mount.why})`;
  }

  async execute(action: QA.TestAction, _context: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    // If action.user is specified, maybe add a specific header for impersonation if supported?
    if (action.user) {
        headers['X-Run-As'] = action.user;
    }

    switch (action.type) {
      case 'create_record':
        return this.createRecord(action.target, action.payload || {}, headers);
      case 'update_record':
        return this.updateRecord(action.target, action.payload || {}, headers);
      case 'delete_record':
        return this.deleteRecord(action.target, action.payload || {}, headers);
      case 'read_record':
        return this.readRecord(action.target, action.payload || {}, headers);
        case 'query_records':
        return this.queryRecords(action.target, action.payload || {}, headers);
      case 'api_call':
        return this.rawApiCall(action.target, action.payload || {}, headers);
        case 'wait':
            const ms = Number(action.payload?.duration || 1000);
            return new Promise(resolve => setTimeout(() => resolve({ waited: ms }), ms));
      default:
        throw new Error(`Unsupported action type in HttpAdapter: ${action.type}`);
    }
  }

  private async createRecord(objectName: string, data: Record<string, unknown>, headers: Record<string, string>) {
    const mount = await this.dataMount();
    const response = await fetch(this.collectionUrl(mount, objectName), {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });
    return this.handleResponse(response, this.mountNote(mount));
  }

  private async updateRecord(objectName: string, data: Record<string, unknown>, headers: Record<string, string>) {
    const { id, ...fields } = data;
    if (!id) throw new Error('Update record requires id in payload');
    // PATCH, not PUT: `PATCH {dataMount}/:object/:id` is the route the server
    // registers, and there is no PUT sibling — the old verb 404'd even once the
    // path was right (#7848). The body is the field patch, so `id` is peeled off
    // rather than posted back as a column write.
    const mount = await this.dataMount();
    const response = await fetch(this.recordUrl(mount, objectName, id), {
      method: 'PATCH',
      headers,
      body: JSON.stringify(fields)
    });
    return this.handleResponse(response, this.mountNote(mount));
  }

  private async deleteRecord(objectName: string, data: Record<string, unknown>, headers: Record<string, string>) {
    const id = data.id;
    if (!id) throw new Error('Delete record requires id in payload');
    const mount = await this.dataMount();
    const response = await fetch(this.recordUrl(mount, objectName, id), {
      method: 'DELETE',
      headers
    });
    return this.handleResponse(response, this.mountNote(mount));
  }

  private async readRecord(objectName: string, data: Record<string, unknown>, headers: Record<string, string>) {
    const id = data.id;
    if (!id) throw new Error('Read record requires id in payload');
    const mount = await this.dataMount();
    const response = await fetch(this.recordUrl(mount, objectName, id), {
      method: 'GET',
      headers
    });
    return this.handleResponse(response, this.mountNote(mount));
  }

  private async queryRecords(objectName: string, data: Record<string, unknown>, headers: Record<string, string>) {
      // `POST {dataMount}/:object/query` — the spec-shape advanced query
      // (QueryAST in the body), the same route `client.data.query()` posts to.
      const mount = await this.dataMount();
      const response = await fetch(`${this.collectionUrl(mount, objectName)}/query`, {
          method: 'POST',
          headers,
          body: JSON.stringify(data)
      });
      return this.handleResponse(response, this.mountNote(mount));
  }

  private async rawApiCall(endpoint: string, data: Record<string, unknown>, headers: Record<string, string>) {
      // Deliberately does NOT consult the resolved mount — `api_call` takes the
      // path it is given, which is what makes it the escape hatch for a host
      // the discovery probe cannot reach (#7983). It probes nothing either: a
      // suite written entirely in `api_call` steps issues no discovery request.
      const method = (data.method as string) || 'GET';
      const body = data.body ? JSON.stringify(data.body) : undefined;
      const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;

      const response = await fetch(url, {
          method,
          headers,
          body
      });
      return this.handleResponse(response);
  }

  private async handleResponse(response: Response, mountNote?: string) {
    if (!response.ok) {
        const text = await response.text();
        // The `HTTP Error <status>: <body>` prefix is unchanged — a suite author
        // (and every transcript predating #7983) reads the same first clause;
        // the mount provenance is APPENDED, never substituted.
        //
        // Appended on 404/405 only: those are the statuses a wrong mount
        // produces (nothing registered at the path / registered under another
        // verb), and they are exactly the ones this card calls unreadable. A
        // 400 or 422 reached the right route and got a real answer from it —
        // decorating those with the mount would bury the server's own message
        // under a URL the author has no reason to doubt.
        const wrongUrlShaped = response.status === 404 || response.status === 405;
        throw new Error(
          `HTTP Error ${response.status}: ${text}${wrongUrlShaped && mountNote ? ` — ${mountNote}` : ''}`,
        );
    }
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return response.json();
    }
    return response.text();
  }
}
