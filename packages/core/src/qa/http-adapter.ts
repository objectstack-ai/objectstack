// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as QA from '@objectstack/spec/qa';
import { RestApiConfigSchema, CrudEndpointsConfigSchema } from '@objectstack/spec/api';
import { TestExecutionAdapter } from './adapter.js';

/** Memoised {@link defaultDataPath} — the schemas are `lazySchema`, so build them once. */
let dataPathCache: string | undefined;

/**
 * The path prefix a stock ObjectStack server serves the Data Protocol under.
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
 * Defaults only: this adapter is handed an origin, not a deployment's config,
 * so a host that overrides `api.apiPath` or `crud.dataPrefix` is still out of
 * reach here (tracked separately — the `api_call` action type is the escape
 * hatch until then). What the derivation buys is that the DEFAULT can never
 * again disagree with the schema that declares it.
 */
function defaultDataPath(): string {
  if (dataPathCache === undefined) {
    const api = RestApiConfigSchema.parse({});
    const crud = CrudEndpointsConfigSchema.parse({});
    dataPathCache = `${api.apiPath ?? `${api.basePath}/${api.version}`}${crud.dataPrefix}`;
  }
  return dataPathCache;
}

export class HttpTestAdapter implements TestExecutionAdapter {
  constructor(private baseUrl: string, private authToken?: string) {}

  /** `{baseUrl}{apiBasePath}{dataPrefix}/{object}` — the collection URL. */
  private collectionUrl(objectName: string): string {
    return `${this.baseUrl}${defaultDataPath()}/${encodeURIComponent(objectName)}`;
  }

  /** `{collection}/{id}` — the single-record URL. */
  private recordUrl(objectName: string, id: unknown): string {
    return `${this.collectionUrl(objectName)}/${encodeURIComponent(String(id))}`;
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
    const response = await fetch(this.collectionUrl(objectName), {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });
    return this.handleResponse(response);
  }

  private async updateRecord(objectName: string, data: Record<string, unknown>, headers: Record<string, string>) {
    const { id, ...fields } = data;
    if (!id) throw new Error('Update record requires id in payload');
    // PATCH, not PUT: `PATCH {apiPath}/data/:object/:id` is the route the server
    // registers, and there is no PUT sibling — the old verb 404'd even once the
    // path was right (#7848). The body is the field patch, so `id` is peeled off
    // rather than posted back as a column write.
    const response = await fetch(this.recordUrl(objectName, id), {
      method: 'PATCH',
      headers,
      body: JSON.stringify(fields)
    });
    return this.handleResponse(response);
  }

  private async deleteRecord(objectName: string, data: Record<string, unknown>, headers: Record<string, string>) {
    const id = data.id;
    if (!id) throw new Error('Delete record requires id in payload');
    const response = await fetch(this.recordUrl(objectName, id), {
      method: 'DELETE',
      headers
    });
    return this.handleResponse(response);
  }

  private async readRecord(objectName: string, data: Record<string, unknown>, headers: Record<string, string>) {
    const id = data.id;
    if (!id) throw new Error('Read record requires id in payload');
    const response = await fetch(this.recordUrl(objectName, id), {
      method: 'GET',
      headers
    });
    return this.handleResponse(response);
  }

  private async queryRecords(objectName: string, data: Record<string, unknown>, headers: Record<string, string>) {
      // `POST {apiPath}/data/:object/query` — the spec-shape advanced query
      // (QueryAST in the body), the same route `client.data.query()` posts to.
      const response = await fetch(`${this.collectionUrl(objectName)}/query`, {
          method: 'POST',
          headers,
          body: JSON.stringify(data)
      });
      return this.handleResponse(response);
  }

  private async rawApiCall(endpoint: string, data: Record<string, unknown>, headers: Record<string, string>) {
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

  private async handleResponse(response: Response) {
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP Error ${response.status}: ${text}`);
    }
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return response.json();
    }
    return response.text();
  }
}
