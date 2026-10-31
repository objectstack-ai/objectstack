// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dialect seam: every place where OData versions spell the same thing
 * differently goes through one {@link ODataDialect} object, so a v2 dialect is
 * a new file beside `dialect-v4.ts`, not a rewrite of the driver.
 *
 * What varies between versions, and therefore lives here:
 *
 * - the request headers (`OData-Version`, the JSON format parameter);
 * - the response envelope of a collection (`value` / `@odata.nextLink` /
 *   `@odata.count` in v4; `d.results` / `__next` / `__count` in v2) and of a
 *   single entity, and where its ETag sits;
 * - the `$metadata` document (CSDL v4 under `edmx:Edmx Version="4.0"`; v2's
 *   EDMX 1.0 with `DataServiceVersion`);
 * - literal spellings (`'text'`, bare v4 dates and GUIDs; v2's
 *   `datetime'…'` / `guid'…'`), the string functions (`contains(P,'x')` in v4,
 *   `substringof('x',P)` in v2) and set membership;
 * - the count query option (`$count=true` in v4, `$inlinecount=allpages` in
 *   v2).
 *
 * What does NOT vary, and therefore stays in the driver and the filter
 * translator: the `where` walk, the widening rules, paging, key handling, the
 * error mapping and the write verbs.
 */

/** A primitive or enum property of an entity type. */
export interface EdmProperty {
  name: string;
  /** The qualified type name, e.g. `Edm.String`, `Trippin.PersonGender`; for a collection, its element type. */
  type: string;
  isCollection: boolean;
  nullable: boolean;
}

/** A navigation property: imported as a lookup only (a single-valued one), never followed. */
export interface EdmNavigationProperty {
  name: string;
  /** The qualified target entity type. */
  type: string;
  isCollection: boolean;
  nullable: boolean;
  /** `ReferentialConstraint` pairs: the dependent property on this type → the principal property on the target. */
  referentialConstraints: Array<{ property: string; referencedProperty: string }>;
}

export interface EdmEntityType {
  /** The qualified name (`Namespace.Name`). */
  fullName: string;
  name: string;
  /** The key property names, the base type's when this type declares none. */
  key: string[];
  /** Own and inherited structural properties, base type first. */
  properties: EdmProperty[];
  /** Own and inherited navigation properties, base type first. */
  navigationProperties: EdmNavigationProperty[];
}

export interface EdmEntitySet {
  name: string;
  /** The qualified entity type. */
  entityType: string;
  /** `NavigationPropertyBinding` path → target entity set. */
  navigationBindings: Record<string, string>;
}

/** The parts of a service's `$metadata` the driver reads. */
export interface ODataServiceModel {
  /** The CSDL version the document declared. */
  version: string;
  entityTypes: Map<string, EdmEntityType>;
  entitySets: Map<string, EdmEntitySet>;
  /** Qualified enum type names; a literal of one is spelled as an enum member. */
  enumTypes: Set<string>;
}

/** One page of a collection, as the dialect reads it out of the envelope. */
export interface ODataCollectionPage {
  rows: Array<Record<string, unknown>>;
  nextLink?: string;
  count?: number;
}

/** A string function the translator may ask the dialect to spell. */
export type ODataStringFunction = 'contains' | 'startswith' | 'endswith';

export interface ODataDialect {
  /** The protocol version this dialect speaks, as the config names it. */
  readonly version: string;
  /** Headers every request carries. */
  requestHeaders(): Record<string, string>;
  /** Read a collection response body. Throws when the body is not a collection envelope. */
  readCollection(body: unknown): ODataCollectionPage;
  /** Read a single-entity response body. Throws when the body is not an entity. */
  readEntity(body: unknown): Record<string, unknown>;
  /** The entity's ETag, when the response carried one. */
  etagOf(entity: Record<string, unknown>): string | undefined;
  /** Is this key of an entity payload a protocol annotation rather than a property? */
  isAnnotation(key: string): boolean;
  /** Read the error body of a failed request: the service's code and message, when present. */
  readError(body: unknown): { code?: string; message?: string };
  /** Parse a `$metadata` document. Throws when it is not this dialect's CSDL. */
  parseMetadata(xml: string): ODataServiceModel;
  /**
   * Spell `value` as a literal of `type` (a qualified primitive or enum type).
   * `undefined` when the value cannot be spelled as that type — the caller
   * then leaves the predicate to the engine instead of guessing.
   */
  literal(value: unknown, type: string, model: ODataServiceModel): string | undefined;
  /** Spell a string function call over a property and a string literal. */
  stringFunction(fn: ODataStringFunction, property: string, literal: string): string;
  /** Spell a case-folded property reference (for `$icontains`). */
  toLower(property: string): string;
  /**
   * Spell set membership over already-spelled literals (non-empty). The
   * result need not be grouped: the translator parenthesizes it wherever it
   * is an operand (under `not`, beside `and` / `or`).
   */
  inList(property: string, literals: readonly string[]): string;
  /** The query options that ask a collection read to carry its total count. */
  countOptions(): Record<string, string>;

  // The members below are optional: a dialect that leaves one out gets the v4
  // behaviour, which is what `odataV4Dialect` relies on.

  /**
   * A property value as the service wrote it → the value a row carries (v2
   * writes `Edm.DateTime` as `/Date(ms)/` and `Edm.Int64` as a string).
   * `fieldType` is the declared type of the field the property backs, when the
   * object declares one: v2 has no `Edm.Date`, so a `date` field over an
   * `Edm.DateTime` reads the date alone. Absent: the value is carried as
   * written.
   */
  readValue?(value: unknown, property: EdmProperty, fieldType?: string): unknown;
  /** The inverse of {@link readValue}, for a request body. Absent: the value is sent as given. */
  writeValue?(value: unknown, property: EdmProperty): unknown;
  /**
   * Read back one literal this dialect spelled (a part of a composite key
   * predicate, `1L`, `guid'…'`) as the value {@link literal} spells again.
   * Absent: a quoted string is unquoted and any other literal is taken as it
   * is written, which is v4's spelling.
   */
  keyValue?(literal: string, type: string): unknown;
  /**
   * The request that applies a partial update to one entity. Absent: `PATCH`.
   * v2 has no `PATCH`: its partial update is `MERGE`, sent as a `POST`
   * tunnelled with `X-HTTP-Method` (MS-ODATA §2.2.5.8).
   */
  updateRequest?(): { method: 'PATCH' | 'POST'; headers: Record<string, string> };
}
