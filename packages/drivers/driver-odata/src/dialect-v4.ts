// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The OData 4.0 dialect — the one this package ships (maintainer order: v4
 * only; a v2 dialect is a sibling file implementing {@link ODataDialect}).
 *
 * References: OData Version 4.0 Part 1 (Protocol) §11.2.6.1 (system query
 * options), Part 2 (URL Conventions) §5.1.1 (`$filter` operators and
 * functions) and its ABNF for primitive literals, the JSON Format §12 (the
 * collection envelope) and CSDL XML §3–§13.
 */

import { XMLParser } from 'fast-xml-parser';
import type {
  EdmEntitySet,
  EdmEntityType,
  EdmNavigationProperty,
  EdmProperty,
  ODataCollectionPage,
  ODataDialect,
  ODataServiceModel,
  ODataStringFunction,
} from './dialect.js';

type XmlNode = Record<string, unknown>;

const INTEGER_TYPES: ReadonlySet<string> = new Set(['Edm.Byte', 'Edm.SByte', 'Edm.Int16', 'Edm.Int32', 'Edm.Int64']);
const DECIMAL_TYPES: ReadonlySet<string> = new Set(['Edm.Decimal', 'Edm.Double', 'Edm.Single']);

const INTEGER_TEXT = /^-?\d+$/;
const DECIMAL_TEXT = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const GUID_TEXT = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
/** An instant: a date-time WITH its zone, so the remote and the engine read the same moment. */
const DATE_TIME_OFFSET_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,12})?)?(Z|[+-]\d{2}:\d{2})$/;
const TIME_OF_DAY_TEXT = /^\d{2}:\d{2}(:\d{2}(\.\d{1,12})?)?$/;
/** An enum member name, as CSDL allows one (`SimpleIdentifier`). */
const MEMBER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** `Collection(X)` → `{ type: X, isCollection: true }`. */
function unwrapCollection(type: string): { type: string; isCollection: boolean } {
  const match = /^Collection\((.+)\)$/.exec(type);
  return match ? { type: match[1]!, isCollection: true } : { type, isCollection: false };
}

const children = (node: unknown, name: string): XmlNode[] => {
  if (!node || typeof node !== 'object') return [];
  const value = (node as XmlNode)[name];
  return Array.isArray(value) ? (value as XmlNode[]) : [];
};

const attr = (node: XmlNode, name: string): string | undefined => {
  const value = node[`@_${name}`];
  return typeof value === 'string' ? value : undefined;
};

/** The parser: every element an array (so a single child reads like many), attributes kept as text. */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (_name, _jpath, _isLeafNode, isAttribute) => !isAttribute,
});

/** Parse a CSDL 4.0 `$metadata` document into the {@link ODataServiceModel} the driver reads. */
export function parseCsdlV4(xml: string): ODataServiceModel {
  let document: XmlNode;
  try {
    document = xmlParser.parse(xml) as XmlNode;
  } catch (error) {
    throw new Error(`driver-odata: the $metadata document is not well-formed XML (${(error as Error).message})`);
  }
  const edmx = children(document, 'Edmx')[0];
  const version = edmx ? attr(edmx, 'Version') : undefined;
  if (!edmx || !version || !version.startsWith('4.')) {
    throw new Error(
      `driver-odata: the $metadata document is not CSDL 4.x (edmx:Edmx Version="${version ?? 'absent'}"); `
      + 'this driver ships the OData v4 dialect only',
    );
  }
  const schemas = children(edmx, 'DataServices').flatMap((ds) => children(ds, 'Schema'));

  // Alias → namespace, so `Self.Person` and `Trippin.Person` name one type.
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

  interface RawEntityType {
    fullName: string;
    name: string;
    baseType?: string;
    key: string[];
    properties: EdmProperty[];
    navigationProperties: EdmNavigationProperty[];
  }
  const raw = new Map<string, RawEntityType>();
  const enumTypes = new Set<string>();
  const entitySets = new Map<string, EdmEntitySet>();

  for (const schema of schemas) {
    const namespace = attr(schema, 'Namespace') ?? '';
    for (const enumType of children(schema, 'EnumType')) {
      const name = attr(enumType, 'Name');
      if (name) enumTypes.add(`${namespace}.${name}`);
    }
    for (const entityType of children(schema, 'EntityType')) {
      const name = attr(entityType, 'Name');
      if (!name) continue;
      const baseType = attr(entityType, 'BaseType');
      raw.set(`${namespace}.${name}`, {
        fullName: `${namespace}.${name}`,
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
        navigationProperties: children(entityType, 'NavigationProperty').flatMap((nav) => {
          const navName = attr(nav, 'Name');
          const declared = attr(nav, 'Type');
          if (!navName || !declared) return [];
          const { type, isCollection } = unwrapCollection(qualify(declared));
          return [{
            name: navName,
            type,
            isCollection,
            nullable: attr(nav, 'Nullable') !== 'false',
            referentialConstraints: children(nav, 'ReferentialConstraint').flatMap((rc) => {
              const property = attr(rc, 'Property');
              const referencedProperty = attr(rc, 'ReferencedProperty');
              return property && referencedProperty ? [{ property, referencedProperty }] : [];
            }),
          }];
        }),
      });
    }
    for (const container of children(schema, 'EntityContainer')) {
      for (const set of children(container, 'EntitySet')) {
        const name = attr(set, 'Name');
        const entityType = attr(set, 'EntityType');
        if (!name || !entityType) continue;
        const navigationBindings: Record<string, string> = {};
        for (const binding of children(set, 'NavigationPropertyBinding')) {
          const path = attr(binding, 'Path');
          const target = attr(binding, 'Target');
          if (path && target) navigationBindings[path] = target;
        }
        entitySets.set(name, { name, entityType: qualify(entityType), navigationBindings });
      }
    }
  }

  // Flatten inheritance: base type first, keys from the nearest type that declares one.
  const entityTypes = new Map<string, EdmEntityType>();
  const resolve = (fullName: string, seen: Set<string>): EdmEntityType | undefined => {
    const done = entityTypes.get(fullName);
    if (done) return done;
    const own = raw.get(fullName);
    if (!own || seen.has(fullName)) return undefined;
    seen.add(fullName);
    const base = own.baseType ? resolve(own.baseType, seen) : undefined;
    const resolved: EdmEntityType = {
      fullName,
      name: own.name,
      key: own.key.length > 0 ? own.key : (base?.key ?? []),
      properties: [...(base?.properties ?? []), ...own.properties],
      navigationProperties: [...(base?.navigationProperties ?? []), ...own.navigationProperties],
    };
    entityTypes.set(fullName, resolved);
    return resolved;
  };
  for (const fullName of raw.keys()) resolve(fullName, new Set());

  return { version, entityTypes, entitySets, enumTypes };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const odataV4Dialect: ODataDialect = {
  version: '4.0',

  requestHeaders() {
    return {
      'OData-Version': '4.0',
      'OData-MaxVersion': '4.0',
      Accept: 'application/json;odata.metadata=minimal',
    };
  },

  readCollection(body: unknown): ODataCollectionPage {
    if (!isRecord(body) || !Array.isArray(body.value)) {
      throw new Error('driver-odata: the service answered a collection read without a `value` array');
    }
    const page: ODataCollectionPage = { rows: body.value.filter(isRecord) };
    const next = body['@odata.nextLink'];
    if (typeof next === 'string' && next !== '') page.nextLink = next;
    const count = body['@odata.count'];
    if (typeof count === 'number') page.count = count;
    else if (typeof count === 'string' && INTEGER_TEXT.test(count)) page.count = Number(count);
    return page;
  },

  readEntity(body: unknown) {
    if (!isRecord(body)) throw new Error('driver-odata: the service answered an entity read without an entity');
    return body;
  },

  etagOf(entity) {
    const etag = entity['@odata.etag'];
    return typeof etag === 'string' && etag !== '' ? etag : undefined;
  },

  isAnnotation(key) {
    // `@odata.etag`, `@odata.context`, and instance annotations on a property (`Name@odata.type`).
    return key.includes('@');
  },

  readError(body) {
    if (!isRecord(body) || !isRecord(body.error)) return {};
    const { code, message } = body.error;
    return {
      ...(typeof code === 'string' && code !== '' ? { code } : {}),
      ...(typeof message === 'string' && message !== '' ? { message } : {}),
    };
  },

  parseMetadata: parseCsdlV4,

  literal(value, type, model) {
    if (value === null) return 'null';
    if (type === 'Edm.String') return typeof value === 'string' ? quote(value) : undefined;
    if (type === 'Edm.Boolean') return typeof value === 'boolean' ? String(value) : undefined;
    if (INTEGER_TYPES.has(type)) {
      if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : undefined;
      return typeof value === 'string' && INTEGER_TEXT.test(value) ? value : undefined;
    }
    if (DECIMAL_TYPES.has(type)) {
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
      return typeof value === 'string' && DECIMAL_TEXT.test(value) ? value : undefined;
    }
    if (type === 'Edm.Guid') return typeof value === 'string' && GUID_TEXT.test(value) ? value : undefined;
    if (type === 'Edm.Date') return typeof value === 'string' && DATE_TEXT.test(value) ? value : undefined;
    if (type === 'Edm.DateTimeOffset') {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
      return typeof value === 'string' && DATE_TIME_OFFSET_TEXT.test(value) ? value : undefined;
    }
    if (type === 'Edm.TimeOfDay') return typeof value === 'string' && TIME_OF_DAY_TEXT.test(value) ? value : undefined;
    if (model.enumTypes.has(type)) {
      return typeof value === 'string' && MEMBER_NAME.test(value) ? `${type}'${value}'` : undefined;
    }
    // Binary, Duration, spatial types, complex types: no spelling is claimed.
    return undefined;
  },

  stringFunction(fn: ODataStringFunction, property: string, literal: string) {
    return `${fn}(${property},${literal})`;
  },

  toLower(property) {
    return `tolower(${property})`;
  },

  inList(property, literals) {
    // OData 4.0 has no `in` operator (4.01 added it): an `or` chain answers on both.
    return literals.length === 1
      ? `${property} eq ${literals[0]}`
      : `(${literals.map((literal) => `${property} eq ${literal}`).join(' or ')})`;
  },

  countOptions() {
    return { $count: 'true' };
  },
};
