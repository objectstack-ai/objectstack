// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ODataDriver` — a declarative OData v4 datasource driver (epic #27261 Tier B,
 * ruling 6486145005).
 *
 * An administrator declares a datasource served by this driver and binds
 * objects to its entity sets (`object.external.remoteName`); every read and
 * write of such an object is answered by the service, live. Nothing is stored
 * on the platform side.
 *
 * ## A plugin driver, behind the engine's floor
 *
 * The driver is published by {@link createODataDriverPlugin} as the service
 * `driver.<name>` and is NOT a built-in id (`DRIVER_VOCABULARY`), so on a
 * datasource with `schemaMode: 'external'` the engine holds it behind its
 * external-driver floor: `find` is sent `where`, `orderBy` and a row cap, and
 * the engine re-applies the whole query to the rows returned. This driver
 * pushes down what it can translate (`filter.ts`) and is never narrower than
 * the query; `supports` claims nothing about pushdown, because no such claim
 * exists in `DriverCapabilities` and the floor treats every part of the query
 * as unclaimed.
 *
 * ## What a request becomes
 *
 * - `find` → `GET <EntitySet>?$filter&$orderby&$select&$top&$skip`, following
 *   `@odata.nextLink` until the asked number of rows is reached. A paged read
 *   is ordered by the entity key after any requested order, so pages
 *   partition the result (`IDataDriver.find`'s contract).
 * - `count` → the same read with `$count=true&$top=0`, when the whole `where`
 *   was translated; otherwise refused, since the service cannot count rows it
 *   cannot select.
 * - `create` → `POST <EntitySet>`; `update` → `PATCH <EntitySet>(<key>)`;
 *   `delete` → `DELETE <EntitySet>(<key>)`. `If-Match` carries the row's
 *   `@odata.etag` when a read of that row returned one. Only properties the
 *   entity type declares are sent: the engine's own stamps (`updated_at`, …)
 *   are not the service's.
 * - The bulk verbs, `upsert`, transactions, `execute` and `dropTable` are
 *   refused by name. A transport without `$batch` has no atomic multi-row
 *   write, and offering a loop under that name would claim one.
 *
 * ## Rows and keys
 *
 * A row is the entity with its protocol annotations removed, each property
 * renamed through `external.columnMap` (remote → local), and `id` set to the
 * entity key: the key's value as text for a single-property key, the key
 * predicate's body (`OrderID=1,ProductID=7`) for a composite one. The key is
 * read from `$metadata`, which the driver reads once, at the first request.
 */

import { findMisplacedReadableIds, readableIdsDriverRefusal } from '@objectstack/core';
import type { DriverQuery, IDataDriver, IntrospectedSchema, IntrospectedTable } from '@objectstack/spec/contracts';
import type { DriverOptions } from '@objectstack/spec/data';
import type { EdmEntitySet, EdmEntityType, EdmProperty, ODataDialect, ODataServiceModel } from './dialect.js';
import { odataV4Dialect } from './dialect-v4.js';
import { translateWhere, type FilterTarget } from './filter.js';
import { ODataRequestError, ODataTransport, type FetchLike, type ODataResponse } from './transport.js';
import type { ODataDriverConfig } from './config.js';

type Row = Record<string, unknown>;

/** The dialects this package ships, by the config's `version`. */
const DIALECTS: Record<string, ODataDialect> = { '4.0': odataV4Dialect };

/** How many ETags the driver keeps (by object and id) for `If-Match`. */
const ETAG_CACHE_LIMIT = 10_000;

/** What the driver is given besides its config. */
export interface ODataDriverRuntime {
  /** The `fetch` to call; the global one when absent. */
  fetch?: FetchLike;
  /** The secret behind the datasource's `external.credentialsRef`; see `plugin.ts`. */
  credential?: () => Promise<string | undefined>;
}

/** An introspected table, with the navigation properties the import offers as lookups. */
export interface ODataIntrospectedTable extends IntrospectedTable {
  /** The qualified entity type. */
  entityType: string;
  /** Single-valued navigation properties: candidates for a lookup field, never followed by reads. */
  navigationProperties: Array<{ name: string; targetEntitySet?: string; targetEntityType: string; nullable: boolean }>;
}

export interface ODataIntrospectedSchema extends IntrospectedSchema {
  tables: Record<string, ODataIntrospectedTable>;
}

/** What `registerExternalObject` records for an object. */
interface ObjectDeclaration {
  remoteName?: string;
  /** remote property → local field */
  columnMap: Record<string, string>;
}

/** An object resolved against the service model. */
interface Binding extends FilterTarget {
  object: string;
  entitySet: EdmEntitySet;
  entityType: EdmEntityType;
  keyProperties: EdmProperty[];
  /** remote property → local field */
  fieldOfProperty: Map<string, string>;
  /** `id` names the (single) key, rather than a property the column map named `id`. */
  idIsKeyAlias: boolean;
}

/** A refusal of the request itself — the floor answers it 400 on a read, 422 on a write. */
function refusal(message: string): ODataRequestError {
  return new ODataRequestError(`driver-odata: ${message}`, 400);
}

const isRecord = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

export class ODataDriver implements IDataDriver {
  readonly name: string;
  readonly version = '1.0.0';
  /**
   * No pushdown claim: `DriverCapabilities` has none to make, and the engine
   * floors every part of the query on a plugin driver. A REST transport has
   * no transactions.
   */
  readonly supports = { transactionsUnsupported: true };

  private readonly dialect: ODataDialect;
  private readonly transport: ODataTransport;
  private readonly declarations = new Map<string, ObjectDeclaration>();
  private readonly bindings = new Map<string, Binding>();
  private readonly etags = new Map<string, string>();
  private model?: Promise<ODataServiceModel>;

  constructor(config: ODataDriverConfig, runtime: ODataDriverRuntime = {}) {
    const dialect = DIALECTS[config.version];
    if (!dialect) throw new Error(`driver-odata: OData version '${config.version}' has no dialect in this package`);
    this.name = config.name;
    this.dialect = dialect;
    this.transport = new ODataTransport({
      serviceRoot: config.serviceRoot,
      dialect,
      auth: config.auth,
      requestTimeoutMs: config.requestTimeoutMs,
      pageSize: config.pageSize,
      ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
      ...(runtime.credential ? { credential: runtime.credential } : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Nothing remote happens here. The credential is the datasource's
   * `external.credentialsRef`, resolved at the first request: at `connect()`
   * the datasource definitions may not be registered yet, and a boot must not
   * record "no credential" from a registry that is still filling.
   */
  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {
    this.model = undefined;
    this.bindings.clear();
    this.etags.clear();
    this.transport.reset();
  }

  /** Answers whether the service document is served. */
  async checkHealth(): Promise<boolean> {
    try {
      await this.transport.request({ method: 'GET', url: this.transport.root, subject: 'service document' });
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

  /** The service's `$metadata`, read once (a failed read is retried by the next call). */
  getServiceModel(): Promise<ODataServiceModel> {
    if (!this.model) {
      const pending = this.transport
        .request({ method: 'GET', url: this.transport.resolve('$metadata'), subject: '$metadata', text: true })
        .then((response) => {
          if (typeof response.body !== 'string') throw new Error('driver-odata: $metadata answered no document');
          return this.dialect.parseMetadata(response.body);
        });
      this.model = pending;
      pending.catch(() => { if (this.model === pending) this.model = undefined; });
    }
    return this.model;
  }

  /**
   * Record an external object's binding (ADR-0015): its entity set
   * (`external.remoteName`, the object name when absent) and its
   * `external.columnMap`. Pure bookkeeping — the engine re-drives it after
   * every metadata reload.
   */
  registerExternalObject(schema: unknown): void {
    if (!isRecord(schema) || typeof schema.name !== 'string') return;
    const external = isRecord(schema.external) ? schema.external : {};
    const columnMap: Record<string, string> = {};
    if (isRecord(external.columnMap)) {
      for (const [remote, local] of Object.entries(external.columnMap)) {
        if (typeof local === 'string') columnMap[remote] = local;
      }
    }
    this.declarations.set(schema.name, {
      ...(typeof external.remoteName === 'string' ? { remoteName: external.remoteName } : {}),
      columnMap,
    });
    this.bindings.delete(schema.name);
  }

  /** External: the service owns its schema, so there is no DDL to run. */
  async syncSchema(_object: string, _schema: unknown, _options?: DriverOptions): Promise<void> {}

  /**
   * The service's entity sets as tables (ADR-0015 introspection): each
   * structural property a column typed by its EDM type name, the key as the
   * primary key, and single-valued navigation properties listed apart as
   * lookup candidates.
   */
  async introspectSchema(): Promise<ODataIntrospectedSchema> {
    const model = await this.getServiceModel();
    const tables: Record<string, ODataIntrospectedTable> = {};
    for (const set of model.entitySets.values()) {
      const type = model.entityTypes.get(set.entityType);
      if (!type) continue;
      tables[set.name] = {
        name: set.name,
        entityType: type.fullName,
        columns: type.properties.map((p) => ({
          name: p.name,
          type: p.isCollection ? `Collection(${p.type})` : p.type,
          nullable: p.nullable,
          primaryKey: type.key.includes(p.name),
        })),
        navigationProperties: type.navigationProperties
          .filter((nav) => !nav.isCollection)
          .map((nav) => ({
            name: nav.name,
            targetEntityType: nav.type,
            ...(set.navigationBindings[nav.name] ? { targetEntitySet: set.navigationBindings[nav.name] } : {}),
            nullable: nav.nullable,
          })),
      };
    }
    return { tables, dialect: `odata-${this.dialect.version}`, introspectedAt: new Date().toISOString() };
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async find(object: string, query: DriverQuery = {}, _options?: DriverOptions): Promise<Row[]> {
    refuseReadableIds(query.where);
    const binding = await this.bind(object);
    const limit = typeof query.limit === 'number' ? query.limit : undefined;
    const offset = typeof query.offset === 'number' ? query.offset : undefined;
    if (limit === 0) return [];

    const params: Record<string, string> = {};
    const { filter } = translateWhere(query.where, binding, this.dialect);
    if (filter !== null) params.$filter = filter;

    const paged = limit !== undefined || offset !== undefined;
    const orderby = this.orderBy(binding, query.orderBy, paged);
    if (orderby) params.$orderby = orderby;

    const select = this.select(binding, query.fields);
    if (select) params.$select = select;
    if (offset !== undefined && offset > 0) params.$skip = String(offset);
    if (limit !== undefined) params.$top = String(limit);

    const rows: Row[] = [];
    let url: URL | undefined = this.collectionUrl(binding, params);
    while (url) {
      const response: ODataResponse = await this.transport.request({ method: 'GET', url, subject: binding.entitySet.name });
      const page = this.dialect.readCollection(response.body);
      for (const entity of page.rows) rows.push(this.toRow(binding, entity));
      if (limit !== undefined && rows.length >= limit) {
        rows.length = limit;
        break;
      }
      url = page.nextLink ? this.transport.followLink(page.nextLink, url) : undefined;
    }
    return rows;
  }

  async findOne(object: string, query: DriverQuery = {}, options?: DriverOptions): Promise<Row | null> {
    return (await this.find(object, { ...query, limit: 1 }, options))[0] ?? null;
  }

  async count(object: string, query: DriverQuery = {}, _options?: DriverOptions): Promise<number> {
    refuseReadableIds(query.where);
    const binding = await this.bind(object);
    const { filter, complete } = translateWhere(query.where, binding, this.dialect);
    if (!complete) {
      throw refusal(
        `count on '${object}' carries a predicate this driver cannot send to the service, `
        + 'so the service cannot count the rows it selects',
      );
    }
    const params: Record<string, string> = { ...this.dialect.countOptions(), $top: '0' };
    if (filter !== null) params.$filter = filter;
    const url = this.collectionUrl(binding, params);
    const response = await this.transport.request({ method: 'GET', url, subject: binding.entitySet.name });
    const { count } = this.dialect.readCollection(response.body);
    if (count === undefined) throw new Error(`driver-odata: the service answered a count on '${binding.entitySet.name}' without one`);
    return count;
  }

  // ---------------------------------------------------------------------------
  // Writes (ADR-0015: the engine has checked `allowWrites` and `writable`)
  // ---------------------------------------------------------------------------

  async create(object: string, data: Row, _options?: DriverOptions): Promise<Row> {
    const binding = await this.bind(object);
    const url = this.transport.resolve(encodeURIComponent(binding.entitySet.name));
    const response = await this.transport.request({
      method: 'POST',
      url,
      subject: binding.entitySet.name,
      body: this.toRemote(binding, data, true),
      headers: { Prefer: 'return=representation' },
    });
    if (isRecord(response.body)) return this.toRow(binding, this.dialect.readEntity(response.body));
    const location = response.headers.get('OData-EntityId') ?? response.headers.get('Location');
    if (location) {
      const created = await this.transport.request({
        method: 'GET', url: this.transport.followLink(location, url), subject: binding.entitySet.name,
      });
      return this.toRow(binding, this.dialect.readEntity(created.body));
    }
    throw new Error(`driver-odata: the service created a '${binding.entitySet.name}' entity without returning it or its location`);
  }

  async update(object: string, id: string | number, data: Row, _options?: DriverOptions): Promise<Row | null> {
    const binding = await this.bind(object);
    const url = this.entityUrl(binding, id);
    if (!url) return null;
    const response = await this.transport.request({
      method: 'PATCH',
      url,
      subject: binding.entitySet.name,
      body: this.toRemote(binding, data, false),
      headers: { Prefer: 'return=representation', ...this.ifMatch(object, id) },
      accept: [404],
    });
    if (response.status === 404) return null;
    if (isRecord(response.body)) return this.toRow(binding, this.dialect.readEntity(response.body));
    const reread = await this.transport.request({ method: 'GET', url, subject: binding.entitySet.name, accept: [404] });
    return reread.status === 404 ? null : this.toRow(binding, this.dialect.readEntity(reread.body));
  }

  async delete(object: string, id: string | number, _options?: DriverOptions): Promise<boolean> {
    const binding = await this.bind(object);
    const url = this.entityUrl(binding, id);
    if (!url) return false;
    const response = await this.transport.request({
      method: 'DELETE',
      url,
      subject: binding.entitySet.name,
      headers: this.ifMatch(object, id),
      accept: [404],
    });
    this.etags.delete(etagKey(object, id));
    return response.status !== 404;
  }

  upsert = refused('upsert (OData has no conflict-keyed write; create or update by key)');
  bulkCreate = refused('bulkCreate (no $batch support yet; write rows one at a time)');
  bulkUpdate = refused('bulkUpdate (no $batch support yet; write rows one at a time)');
  bulkDelete = refused('bulkDelete (no $batch support yet; delete rows one at a time)');
  execute = refused('execute (an OData service runs no raw commands)');
  beginTransaction = refused('beginTransaction (an OData service offers no transactions)');
  commit = refused('commit (an OData service offers no transactions)');
  rollback = refused('rollback (an OData service offers no transactions)');
  dropTable = refused('dropTable (the service owns its schema)');

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Resolve an object against the service model: its entity set, type, key and field names. */
  private async bind(object: string): Promise<Binding> {
    const cached = this.bindings.get(object);
    if (cached) return cached;
    const model = await this.getServiceModel();
    const declaration = this.declarations.get(object) ?? { columnMap: {} };
    const setName = declaration.remoteName ?? object;
    const entitySet = model.entitySets.get(setName);
    if (!entitySet) {
      throw new Error(
        `driver-odata: object '${object}' is bound to entity set '${setName}', which the service's $metadata does not declare`,
      );
    }
    const entityType = model.entityTypes.get(entitySet.entityType);
    if (!entityType) {
      throw new Error(`driver-odata: entity set '${setName}' names entity type '${entitySet.entityType}', which $metadata does not declare`);
    }
    const byName = new Map(entityType.properties.map((p) => [p.name, p]));
    const keyProperties = entityType.key.map((name) => byName.get(name)).filter((p): p is EdmProperty => !!p);
    if (keyProperties.length === 0 || keyProperties.length !== entityType.key.length) {
      throw new Error(`driver-odata: entity type '${entityType.fullName}' declares no usable key`);
    }

    const fieldOfProperty = new Map<string, string>();
    const propertyOfField = new Map<string, EdmProperty>();
    for (const property of entityType.properties) {
      const field = declaration.columnMap[property.name] ?? property.name;
      fieldOfProperty.set(property.name, field);
      propertyOfField.set(field, property);
    }
    // `id` names the key, unless the column map gave the name to a property of its own.
    const idIsKeyAlias = keyProperties.length === 1 && !propertyOfField.has('id');
    if (idIsKeyAlias) propertyOfField.set('id', keyProperties[0]!);

    const binding: Binding = {
      object,
      model,
      entitySet,
      entityType,
      keyProperties,
      fieldOfProperty,
      idIsKeyAlias,
      propertyOf: (field) => propertyOfField.get(field),
    };
    this.bindings.set(object, binding);
    return binding;
  }

  private collectionUrl(binding: Binding, params: Record<string, string>): URL {
    const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return this.transport.resolve(`${encodeURIComponent(binding.entitySet.name)}${query ? `?${query}` : ''}`);
  }

  /** `<EntitySet>(<key>)`, or `undefined` when `id` cannot be a key of this entity type. */
  private entityUrl(binding: Binding, id: string | number): URL | undefined {
    const predicate = this.keyPredicate(binding, id);
    return predicate === undefined
      ? undefined
      : this.transport.resolve(`${encodeURIComponent(binding.entitySet.name)}(${predicate})`);
  }

  private keyPredicate(binding: Binding, id: string | number): string | undefined {
    const { keyProperties, model } = binding;
    if (keyProperties.length === 1) {
      const key = keyProperties[0]!;
      const literal = this.dialect.literal(key.type === 'Edm.String' ? String(id) : id, key.type, model);
      return literal === undefined ? undefined : encodeURIComponent(literal);
    }
    // Composite: `id` is the predicate body this driver wrote (`A=1,B='x'`); each part is re-spelled.
    const parts = splitPredicate(String(id));
    if (!parts || parts.length !== keyProperties.length) return undefined;
    const spelled: string[] = [];
    for (const key of keyProperties) {
      const raw = parts.find(([name]) => name === key.name)?.[1];
      if (raw === undefined) return undefined;
      const value = key.type === 'Edm.String' ? unquote(raw) : raw;
      const literal = value === undefined ? undefined : this.dialect.literal(value, key.type, model);
      if (literal === undefined) return undefined;
      spelled.push(`${key.name}=${encodeURIComponent(literal)}`);
    }
    return spelled.join(',');
  }

  /** The row's `id`: the key's value, or the composite key's predicate body. */
  private idOf(binding: Binding, entity: Row): string {
    const { keyProperties, model } = binding;
    const values = keyProperties.map((key) => entity[key.name]);
    if (values.some((v) => v === undefined || v === null)) {
      throw new Error(`driver-odata: an entity of '${binding.entitySet.name}' arrived without its key`);
    }
    if (keyProperties.length === 1) return String(values[0]);
    return keyProperties
      .map((key, i) => `${key.name}=${this.dialect.literal(values[i], key.type, model) ?? String(values[i])}`)
      .join(',');
  }

  private toRow(binding: Binding, entity: Row): Row {
    const row: Row = {};
    for (const [key, value] of Object.entries(entity)) {
      if (this.dialect.isAnnotation(key)) continue;
      row[binding.fieldOfProperty.get(key) ?? key] = value;
    }
    row.id = this.idOf(binding, entity);
    const etag = this.dialect.etagOf(entity);
    if (etag) this.rememberEtag(binding.object, row.id as string, etag);
    return row;
  }

  /** The request body: declared properties only, renamed to the service's names; the key only on create. */
  private toRemote(binding: Binding, data: Row, withKey: boolean): Row {
    const body: Row = {};
    const keys = new Set(binding.keyProperties.map((k) => k.name));
    for (const [field, value] of Object.entries(data)) {
      // `id` as the key's alias is the engine's name for the row, not a property to send: a key
      // the service expects from the caller arrives through the field its property maps to.
      if (field === 'id' && binding.idIsKeyAlias) continue;
      const property = binding.propertyOf(field);
      if (!property) continue;
      if (keys.has(property.name) && !withKey) continue;
      body[property.name] = value;
    }
    return body;
  }

  private orderBy(
    binding: Binding,
    orderBy: DriverQuery['orderBy'],
    paged: boolean,
  ): string | undefined {
    const terms: string[] = [];
    const named = new Set<string>();
    for (const term of orderBy ?? []) {
      const field = (term as { field?: unknown }).field;
      const property = typeof field === 'string' ? binding.propertyOf(field) : undefined;
      // One field the service cannot sort by: send no order at all rather than a different one.
      if (!property || property.isCollection) {
        if (paged) throw refusal(`a paged read of '${binding.object}' sorts by '${String(field)}', which the service cannot sort by`);
        return undefined;
      }
      const direction = (term as { order?: unknown }).order === 'desc' ? 'desc' : 'asc';
      terms.push(`${property.name} ${direction}`);
      named.add(property.name);
    }
    if (paged) {
      for (const key of binding.keyProperties) if (!named.has(key.name)) terms.push(`${key.name} asc`);
    }
    return terms.length > 0 ? terms.join(',') : undefined;
  }

  private select(binding: Binding, fields: DriverQuery['fields']): string | undefined {
    if (!Array.isArray(fields) || fields.length === 0) return undefined;
    const names = new Set(binding.keyProperties.map((k) => k.name));
    for (const field of fields) {
      const property = typeof field === 'string' ? binding.propertyOf(field) : undefined;
      // A field the service does not carry: select everything rather than drop it.
      if (!property) return undefined;
      names.add(property.name);
    }
    return [...names].join(',');
  }

  private ifMatch(object: string, id: string | number): Record<string, string> {
    const etag = this.etags.get(etagKey(object, id));
    return etag ? { 'If-Match': etag } : {};
  }

  private rememberEtag(object: string, id: string, etag: string): void {
    const key = etagKey(object, id);
    this.etags.delete(key);
    this.etags.set(key, etag);
    if (this.etags.size > ETAG_CACHE_LIMIT) {
      const oldest = this.etags.keys().next().value;
      if (oldest !== undefined) this.etags.delete(oldest);
    }
  }
}

/**
 * A `ReadableIds` leaf (ADR-0139 D3) is a read-scope predicate: "the ids of X
 * this caller may read". `$filter` has no tenant-walled semi-join to spell it
 * with, and leaving it out — the translator's answer to anything it cannot
 * spell — would read it as no restriction. So it is refused, loudly, before
 * anything is sent.
 */
function refuseReadableIds(where: unknown): void {
  const site = findMisplacedReadableIds(where, false);
  if (site) throw readableIdsDriverRefusal('driver-odata', site, 'an OData $filter has no form of the tenant-walled semi-join');
}

const etagKey = (object: string, id: string | number) => `${object}\u0000${String(id)}`;

/** A verb this driver does not offer, refused by name (a request-shaped refusal, never an outage). */
function refused(what: string) {
  return async (..._args: unknown[]): Promise<never> => {
    throw refusal(`${what} is not offered by the OData driver`);
  };
}

/** `A=1,B='x,y'` → `[['A','1'],['B',"'x,y'"]]`, or `undefined` when it is not a predicate body. */
function splitPredicate(text: string): Array<[string, string]> | undefined {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "'" && inQuote && text[i + 1] === "'") {
      current += "''";
      i++;
      continue;
    }
    if (ch === "'") inQuote = !inQuote;
    if (ch === ',' && !inQuote) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (inQuote) return undefined;
  parts.push(current);
  const pairs: Array<[string, string]> = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) return undefined;
    pairs.push([part.slice(0, eq), part.slice(eq + 1)]);
  }
  return pairs;
}

/** `'O''Neil'` → `O'Neil`; `undefined` when not a quoted literal. */
function unquote(literal: string): string | undefined {
  if (literal.length < 2 || !literal.startsWith("'") || !literal.endsWith("'")) return undefined;
  return literal.slice(1, -1).replace(/''/g, "'");
}
