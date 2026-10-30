// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The OData 2.0 dialect (`version: '2.0'`): the public v2 protocol, as
 * Microsoft's open specifications write it ([MS-ODATA], [MS-CSDL] and the
 * OData v2 URI Conventions). It implements the same {@link ODataDialect} as
 * `dialect-v4.ts`; the driver and the filter translator do not change.
 *
 * What v2 spells differently from v4:
 *
 * - Requests carry `DataServiceVersion` / `MaxDataServiceVersion` and ask for
 *   `application/json`, which a v2 service answers in its verbose JSON: a
 *   collection is `{ d: { results, __count, __next } }` (a 1.0 service writes
 *   `{ d: [ … ] }`), an entity is `{ d: { … } }`, and each entity carries
 *   `__metadata` (with its `etag`) and a `{ __deferred }` stub per navigation
 *   property, which is not a value and is dropped.
 * - Values: `Edm.DateTime` is written `/Date(<ms since epoch>)/`, read as that
 *   UTC instant (or, under a field declared `date`, its UTC date: v2 has no
 *   `Edm.Date`); `Edm.Int64` and `Edm.Decimal` are strings; `Edm.Time` is a
 *   duration since midnight (`PT13H20M`), read as the time of day.
 * - The count is `$inlinecount=allpages`.
 * - `$metadata` is EDMX 1.0. A navigation property names an `Association`
 *   (`Relationship`, `FromRole`, `ToRole`): the association's ends give the
 *   target type and cardinality, its `ReferentialConstraint` the key columns,
 *   and the container's `AssociationSet`s the target entity set. They are read
 *   into the same {@link EdmNavigationProperty} shape v4 yields, so an import
 *   drafts the same lookups over either version.
 * - Literals are typed: `datetime'…'`, `datetimeoffset'…'`, `time'PT…'`,
 *   `guid'…'`, `1L`, `1.5M`, `1.5d`, `1.5f`; keys take the same spellings
 *   (`Orders(guid'…')`, `Items(1L)`).
 * - `contains` is `substringof('x',P)`.
 * - A partial update is `MERGE`, sent as a `POST` tunnelled with
 *   `X-HTTP-Method: MERGE`, which every v2 service accepts and no
 *   intermediary refuses as an unknown verb.
 *
 * ⛔ Nothing vendor-specific lives here (the 2026-10-29 ruling): no CSRF token
 * handshake, no `sap-client`, no `sap:*` annotations. A service that needs one
 * is served by a vendor plugin.
 */

import type {
  EdmEntitySet,
  EdmNavigationProperty,
  ODataCollectionPage,
  ODataDialect,
  ODataServiceModel,
  ODataStringFunction,
} from './dialect.js';
import {
  attr,
  children,
  flattenEntityTypes,
  unwrapCollection,
  xmlParser,
  type RawEntityType,
  type XmlNode,
} from './dialect-v4.js';

const SMALL_INTEGER_TYPES: ReadonlySet<string> = new Set(['Edm.Byte', 'Edm.SByte', 'Edm.Int16', 'Edm.Int32']);
/** Literal suffix by type: v2's typed numeric literals. */
const NUMBER_SUFFIX: Readonly<Record<string, string>> = { 'Edm.Int64': 'L', 'Edm.Decimal': 'M', 'Edm.Double': 'd', 'Edm.Single': 'f' };

const INTEGER_TEXT = /^-?\d+$/;
/** v2's decimal literal has no exponent. */
const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;
const FLOAT_TEXT = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const GUID_TEXT = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A date-time WITH its zone: the only text read as one instant on both sides. */
const ZONED_DATE_TIME_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,12})?)?(Z|[+-]\d{2}:\d{2})$/;
/** A date-time without a zone; `Edm.DateTime` values are read as UTC, so it is written as one. */
const LOCAL_DATE_TIME_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,12})?)?$/;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY_TEXT = /^(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,12})?)?$/;
/** `/Date(1700000000000)/`, with the optional offset v2 writes on a `DateTimeOffset` (`+0060`, minutes). */
const JSON_DATE = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/;
/** A duration within one day, as v2 writes an `Edm.Time`. */
const DAY_DURATION = /^PT(?:(\d{1,2})H)?(?:(\d{1,2})M)?(?:(\d{1,2})(\.\d{1,12})?S)?$/;

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A v2 `/Date(ms)/` → the ISO instant; `undefined` when it is not one. */
function fromJsonDate(value: string): string | undefined {
  const match = JSON_DATE.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** A zoned date-time or a `Date` → milliseconds since the epoch; `undefined` otherwise. */
function instantOf(value: unknown): number | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.getTime();
  if (typeof value !== 'string' || !ZONED_DATE_TIME_TEXT.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** The UTC wall-clock text of an instant, as a v2 `datetime'…'` body: `2024-01-15T10:00:00.000`. */
const utcWallClock = (ms: number) => new Date(ms).toISOString().slice(0, -1);

/** `13:20` / `13:20:05.5` → `PT13H20M0S` / `PT13H20M5.5S`. */
function toDuration(value: string): string | undefined {
  const match = TIME_OF_DAY_TEXT.exec(value);
  if (!match) return undefined;
  const [, h, m, s = '00', fraction = ''] = match;
  if (Number(h) > 23 || Number(m) > 59 || Number(s) > 59) return undefined;
  return `PT${Number(h)}H${Number(m)}M${Number(s)}${fraction}S`;
}

/** `PT13H20M` → `13:20:00`; `undefined` for anything that is not a duration within one day. */
function fromDuration(value: string): string | undefined {
  const match = DAY_DURATION.exec(value);
  if (!match || value === 'PT') return undefined;
  const [, h = '0', m = '0', s = '0', fraction = ''] = match;
  if (Number(h) > 23 || Number(m) > 59 || Number(s) > 59) return undefined;
  const two = (n: string) => n.padStart(2, '0');
  return `${two(h)}:${two(m)}:${two(s)}${fraction}`;
}

/** Drop the `{ __deferred }` stubs a v2 entity carries for its navigation properties. */
function withoutDeferred(entity: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    if (isRecord(value) && '__deferred' in value) continue;
    out[key] = value;
  }
  return out;
}

interface Association {
  /** Role → the end's qualified entity type and multiplicity (`1`, `0..1`, `*`). */
  ends: Map<string, { type: string; multiplicity: string }>;
  constraint?: { principalRole: string; principal: string[]; dependentRole: string; dependent: string[] };
}

/** Parse an EDMX 1.0 (CSDL v1/v2) `$metadata` document into the {@link ODataServiceModel} the driver reads. */
export function parseCsdlV2(xml: string): ODataServiceModel {
  let document: XmlNode;
  try {
    document = xmlParser.parse(xml) as XmlNode;
  } catch (error) {
    throw new Error(`driver-odata: the $metadata document is not well-formed XML (${(error as Error).message})`);
  }
  const edmx = children(document, 'Edmx')[0];
  const edmxVersion = edmx ? attr(edmx, 'Version') : undefined;
  if (!edmx || !edmxVersion || !edmxVersion.startsWith('1.')) {
    throw new Error(
      `driver-odata: the $metadata document is not EDMX 1.0 (edmx:Edmx Version="${edmxVersion ?? 'absent'}"); `
      + "this is the v2 dialect only; an OData v4 service is read with `version: '4.0'`",
    );
  }
  const dataServices = children(edmx, 'DataServices');
  // `m:DataServiceVersion` (the `m:` prefix is stripped by the parser): 1.0 or 2.0 on a v2 service.
  const version = dataServices.map((ds) => attr(ds, 'DataServiceVersion')).find((v) => v !== undefined) ?? '1.0';
  const schemas = dataServices.flatMap((ds) => children(ds, 'Schema'));

  const aliases = new Map<string, string>();
  for (const schema of schemas) {
    const namespace = attr(schema, 'Namespace');
    const alias = attr(schema, 'Alias');
    if (namespace && alias) aliases.set(alias, namespace);
  }
  const qualify = (name: string): string => {
    const { type, isCollection } = unwrapCollection(name);
    const dot = type.lastIndexOf('.');
    const prefix = dot > 0 ? type.slice(0, dot) : '';
    const resolved = aliases.has(prefix) ? `${aliases.get(prefix)}${type.slice(dot)}` : type;
    return isCollection ? `Collection(${resolved})` : resolved;
  };

  const associations = new Map<string, Association>();
  for (const schema of schemas) {
    const namespace = attr(schema, 'Namespace') ?? '';
    for (const association of children(schema, 'Association')) {
      const name = attr(association, 'Name');
      if (!name) continue;
      const ends = new Map<string, { type: string; multiplicity: string }>();
      for (const end of children(association, 'End')) {
        const role = attr(end, 'Role');
        const type = attr(end, 'Type');
        if (role && type) ends.set(role, { type: qualify(type), multiplicity: attr(end, 'Multiplicity') ?? '*' });
      }
      const rc = children(association, 'ReferentialConstraint')[0];
      const principal = rc ? children(rc, 'Principal')[0] : undefined;
      const dependent = rc ? children(rc, 'Dependent')[0] : undefined;
      const refs = (node: XmlNode) =>
        children(node, 'PropertyRef').map((ref) => attr(ref, 'Name')).filter((n): n is string => typeof n === 'string');
      const principalRole = principal ? attr(principal, 'Role') : undefined;
      const dependentRole = dependent ? attr(dependent, 'Role') : undefined;
      associations.set(`${namespace}.${name}`, {
        ends,
        ...(principal && dependent && principalRole && dependentRole
          ? { constraint: { principalRole, principal: refs(principal), dependentRole, dependent: refs(dependent) } }
          : {}),
      });
    }
  }

  /** A navigation's association and the role it navigates from, for the association sets below. */
  const navigationRoles = new Map<string, Map<string, { association: string; fromRole: string }>>();
  const raw = new Map<string, RawEntityType>();
  for (const schema of schemas) {
    const namespace = attr(schema, 'Namespace') ?? '';
    for (const entityType of children(schema, 'EntityType')) {
      const name = attr(entityType, 'Name');
      if (!name) continue;
      const fullName = `${namespace}.${name}`;
      const baseType = attr(entityType, 'BaseType');
      const roles = new Map<string, { association: string; fromRole: string }>();
      navigationRoles.set(fullName, roles);
      raw.set(fullName, {
        fullName,
        name,
        ...(baseType ? { baseType: qualify(baseType) } : {}),
        key: children(entityType, 'Key')
          .flatMap((key) => children(key, 'PropertyRef'))
          .map((ref) => attr(ref, 'Name'))
          .filter((n): n is string => typeof n === 'string'),
        properties: children(entityType, 'Property').flatMap((property) => {
          const propertyName = attr(property, 'Name');
          const declared = attr(property, 'Type');
          if (!propertyName || !declared) return [];
          const { type, isCollection } = unwrapCollection(qualify(declared));
          return [{ name: propertyName, type, isCollection, nullable: attr(property, 'Nullable') !== 'false' }];
        }),
        navigationProperties: children(entityType, 'NavigationProperty').flatMap((nav): EdmNavigationProperty[] => {
          const navName = attr(nav, 'Name');
          const relationship = attr(nav, 'Relationship');
          const fromRole = attr(nav, 'FromRole');
          const toRole = attr(nav, 'ToRole');
          if (!navName || !relationship || !fromRole || !toRole) return [];
          const associationName = qualify(relationship);
          const association = associations.get(associationName);
          const target = association?.ends.get(toRole);
          if (!association || !target) return [];
          roles.set(navName, { association: associationName, fromRole });
          const { constraint } = association;
          // A constraint is a lookup's columns only when this end is the dependent one: the
          // dependent properties live on this type and reference the target's (principal's) key.
          const referentialConstraints = constraint && constraint.dependentRole === fromRole && constraint.principalRole === toRole
            ? constraint.dependent.flatMap((property, i) => {
                const referencedProperty = constraint.principal[i];
                return referencedProperty ? [{ property, referencedProperty }] : [];
              })
            : [];
          return [{
            name: navName,
            type: target.type,
            isCollection: target.multiplicity === '*',
            nullable: target.multiplicity !== '1',
            referentialConstraints,
          }];
        }),
      });
    }
  }

  const entityTypes = flattenEntityTypes(raw);

  // The association set ends: (association, role) → entity set.
  const setOfEnd = new Map<string, string>();
  const containers = schemas.flatMap((schema) => children(schema, 'EntityContainer'));
  for (const container of containers) {
    for (const associationSet of children(container, 'AssociationSet')) {
      const association = attr(associationSet, 'Association');
      if (!association) continue;
      for (const end of children(associationSet, 'End')) {
        const role = attr(end, 'Role');
        const entitySet = attr(end, 'EntitySet');
        if (role && entitySet) setOfEnd.set(`${qualify(association)}\u0000${role}`, entitySet);
      }
    }
  }

  const entitySets = new Map<string, EdmEntitySet>();
  for (const container of containers) {
    for (const set of children(container, 'EntitySet')) {
      const name = attr(set, 'Name');
      const declared = attr(set, 'EntityType');
      if (!name || !declared) continue;
      const entityType = qualify(declared);
      const navigationBindings: Record<string, string> = {};
      for (const nav of entityTypes.get(entityType)?.navigationProperties ?? []) {
        const roles = roleOf(entityType, nav.name, raw, navigationRoles);
        if (!roles) continue;
        // The set this navigation reaches: the association set whose from-end is this set.
        if (setOfEnd.get(`${roles.association}\u0000${roles.fromRole}`) !== name) continue;
        const association = associations.get(roles.association);
        const toRole = association && [...association.ends.keys()].find((role) => role !== roles.fromRole);
        const target = toRole === undefined ? undefined : setOfEnd.get(`${roles.association}\u0000${toRole}`);
        if (target) navigationBindings[nav.name] = target;
      }
      entitySets.set(name, { name, entityType, navigationBindings });
    }
  }

  return { version, entityTypes, entitySets, enumTypes: new Set() };
}

/** A navigation's association and from-role, looked up on the type that declares it (itself or a base). */
function roleOf(
  entityType: string,
  navigation: string,
  raw: ReadonlyMap<string, RawEntityType>,
  navigationRoles: ReadonlyMap<string, ReadonlyMap<string, { association: string; fromRole: string }>>,
): { association: string; fromRole: string } | undefined {
  const seen = new Set<string>();
  for (let type: string | undefined = entityType; type && !seen.has(type); type = raw.get(type)?.baseType) {
    seen.add(type);
    const found = navigationRoles.get(type)?.get(navigation);
    if (found) return found;
  }
  return undefined;
}

export const odataV2Dialect: ODataDialect = {
  version: '2.0',

  requestHeaders() {
    return {
      DataServiceVersion: '2.0',
      MaxDataServiceVersion: '2.0',
      Accept: 'application/json',
    };
  },

  readCollection(body: unknown): ODataCollectionPage {
    const d = isRecord(body) ? body.d : undefined;
    // 2.0 wraps the rows in `results`; a 1.0 service answers the array itself.
    const results = Array.isArray(d) ? d : isRecord(d) ? d.results : undefined;
    if (!Array.isArray(results)) {
      throw new Error('driver-odata: the service answered a collection read without a `d.results` array');
    }
    const page: ODataCollectionPage = { rows: results.filter(isRecord).map(withoutDeferred) };
    if (isRecord(d)) {
      const next = d.__next;
      if (typeof next === 'string' && next !== '') page.nextLink = next;
      const count = d.__count;
      if (typeof count === 'number') page.count = count;
      else if (typeof count === 'string' && INTEGER_TEXT.test(count)) page.count = Number(count);
    }
    return page;
  },

  readEntity(body: unknown) {
    const d = isRecord(body) ? body.d : undefined;
    // A service that wraps one entity like a collection page (`{ d: { results: { … } } }`).
    const entity = isRecord(d) && isRecord(d.results) ? d.results : d;
    if (!isRecord(entity)) throw new Error('driver-odata: the service answered an entity read without a `d` entity');
    return withoutDeferred(entity);
  },

  etagOf(entity) {
    const metadata = entity.__metadata;
    const etag = isRecord(metadata) ? metadata.etag : undefined;
    return typeof etag === 'string' && etag !== '' ? etag : undefined;
  },

  isAnnotation(key) {
    // `__metadata`, and any other `__` member of the verbose envelope.
    return key.startsWith('__');
  },

  readError(body) {
    if (!isRecord(body) || !isRecord(body.error)) return {};
    const { code, message } = body.error;
    // v2 writes `message: { lang, value }`; accept the bare string too.
    const text = isRecord(message) ? message.value : message;
    return {
      ...(typeof code === 'string' && code !== '' ? { code } : {}),
      ...(typeof text === 'string' && text !== '' ? { message: text } : {}),
    };
  },

  parseMetadata: parseCsdlV2,

  literal(value, type) {
    if (value === null) return 'null';
    if (type === 'Edm.String') return typeof value === 'string' ? quote(value) : undefined;
    if (type === 'Edm.Boolean') return typeof value === 'boolean' ? String(value) : undefined;
    if (SMALL_INTEGER_TYPES.has(type)) {
      if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : undefined;
      return typeof value === 'string' && INTEGER_TEXT.test(value) ? value : undefined;
    }
    if (type === 'Edm.Int64') {
      if (typeof value === 'number') return Number.isSafeInteger(value) ? `${value}L` : undefined;
      return typeof value === 'string' && INTEGER_TEXT.test(value) ? `${value}L` : undefined;
    }
    if (type === 'Edm.Decimal' || type === 'Edm.Double' || type === 'Edm.Single') {
      const pattern = type === 'Edm.Decimal' ? DECIMAL_TEXT : FLOAT_TEXT;
      const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : undefined)
        : typeof value === 'string' ? value : undefined;
      return text !== undefined && pattern.test(text) ? `${text}${NUMBER_SUFFIX[type]}` : undefined;
    }
    if (type === 'Edm.Guid') return typeof value === 'string' && GUID_TEXT.test(value) ? `guid'${value}'` : undefined;
    if (type === 'Edm.DateTime') {
      // The service's value has no zone and is read as UTC; only a comparand that names its
      // instant is spelled, as that instant's UTC wall clock. A bare date or a zone-less
      // date-time is left to the engine rather than given a zone here.
      const ms = instantOf(value);
      return ms === undefined ? undefined : `datetime'${utcWallClock(ms)}'`;
    }
    if (type === 'Edm.DateTimeOffset') {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : `datetimeoffset'${value.toISOString()}'`;
      return typeof value === 'string' && ZONED_DATE_TIME_TEXT.test(value) ? `datetimeoffset'${value}'` : undefined;
    }
    if (type === 'Edm.Time') {
      const duration = typeof value === 'string' ? toDuration(value) : undefined;
      return duration === undefined ? undefined : `time'${duration}'`;
    }
    // Binary and complex types: no spelling is claimed. v2 has no enum types.
    return undefined;
  },

  stringFunction(fn: ODataStringFunction, property: string, literal: string) {
    // v2 has no `contains`: `substringof` takes the needle first.
    return fn === 'contains' ? `substringof(${literal},${property})` : `${fn}(${property},${literal})`;
  },

  toLower(property) {
    return `tolower(${property})`;
  },

  inList(property, literals) {
    // v2 has no `in` operator: an `or` chain.
    return literals.map((literal) => `${property} eq ${literal}`).join(' or ');
  },

  countOptions() {
    return { $inlinecount: 'allpages' };
  },

  readValue(value, property, fieldType) {
    if (typeof value !== 'string' || property.isCollection) return value;
    switch (property.type) {
      case 'Edm.DateTime': {
        // v2 has no Edm.Date: a date column is an Edm.DateTime at midnight, and a `date` field over it reads its date.
        const instant = fromJsonDate(value);
        if (instant === undefined) return value;
        return fieldType === 'date' ? instant.slice(0, 10) : instant;
      }
      case 'Edm.DateTimeOffset':
        return fromJsonDate(value) ?? value;
      case 'Edm.Int64':
        return INTEGER_TEXT.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : value;
      case 'Edm.Decimal':
        return FLOAT_TEXT.test(value) ? Number(value) : value;
      case 'Edm.Time':
        return fromDuration(value) ?? value;
      default:
        return value;
    }
  },

  writeValue(value, property) {
    if (value === null || value === undefined || property.isCollection) return value;
    switch (property.type) {
      case 'Edm.DateTime': {
        // Read as UTC, so written as UTC: a zone-less date-time or a bare date names the UTC wall clock.
        const text = typeof value === 'string' && (LOCAL_DATE_TIME_TEXT.test(value) || DATE_TEXT.test(value))
          ? `${DATE_TEXT.test(value) ? `${value}T00:00:00` : value}Z`
          : value;
        const ms = instantOf(text);
        return ms === undefined ? value : `/Date(${ms})/`;
      }
      case 'Edm.DateTimeOffset':
        return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : value;
      case 'Edm.Int64':
        return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
      case 'Edm.Decimal':
        return typeof value === 'number' && DECIMAL_TEXT.test(String(value)) ? String(value) : value;
      case 'Edm.Time':
        return typeof value === 'string' ? (toDuration(value) ?? value) : value;
      default:
        return value;
    }
  },

  keyValue(literal, type) {
    if (type === 'Edm.String') {
      return literal.length >= 2 && literal.startsWith("'") && literal.endsWith("'")
        ? literal.slice(1, -1).replace(/''/g, "'")
        : undefined;
    }
    const typed = /^(guid|datetime|datetimeoffset|time)'(.*)'$/.exec(literal);
    if (typed) {
      const [, prefix, body] = typed;
      if (prefix === 'datetime') return `${body}Z`;
      if (prefix === 'time') return fromDuration(body!);
      return body;
    }
    const suffixed = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[LlMmDdFf]$/.exec(literal);
    return suffixed ? suffixed[1] : literal;
  },

  updateRequest() {
    return { method: 'POST', headers: { 'X-HTTP-Method': 'MERGE' } };
  },
};
