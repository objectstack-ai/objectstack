// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0160 D3/D4] What the executor reads through: one door, bound by its
 * host to ONE caller.
 *
 * Every record read goes through the door's data members (`get`, `query`)
 * with the caller's execution context — no system context and no direct
 * driver read. The door is what an MCP bridge already is (both bridges build
 * one from their own members), and the product registry builds one from the
 * same data engine (row 9). The executor reads nothing the door does not hand
 * it, and the door adds no gate of its own beyond the ones the record tools
 * already put before the same read.
 */
export interface RecordContextDoor {
  /**
   * The record tools' read guard on an object (the system-object refusal and
   * its AI-read attestation): `undefined` admits it, a sentence refuses it.
   */
  readGuard(objectName: string): Promise<string | undefined>;
  /**
   * The record tools' API-exposure gate (`apiEnabled`, `apiMethods`) for a
   * `get` or a list `query` of `objectName`: resolves when the read is
   * exposed, throws the door's own coded refusal when it is not.
   */
  assertApiExposed(objectName: string, action: 'get' | 'query'): Promise<void>;
  /**
   * The object definition as THIS caller is served it (ADR-0106: a field the
   * caller may not read is not in it), with labels at the caller's locale, or
   * `null` when the object is not served to the caller at all.
   */
  servedObjectDefinitionOf(objectName: string): Promise<Record<string, unknown> | null>;
  /**
   * The object definition as published — metadata, never records — or `null`.
   * Read only to tell an entry the caller's schema hides (stated) from a name
   * the published definition lacks (an author defect, reported at save and
   * by `os validate`, and silent here).
   */
  publishedObjectDefinitionOf(objectName: string): Promise<Record<string, unknown> | null>;
  /**
   * The published context packs (`ai_context` items), each the authored pack,
   * not the serving envelope: the door removes the read path's decorations
   * (`stripReadDecorations`, `@objectstack/spec/kernel`) before handing the
   * listing over, because the executor parses every row with the closed
   * `AiContextSchema` and a decorated row is no pack.
   */
  listContextPacks(): Promise<readonly unknown[]>;
  /** The record, read as the caller; `null` (or a throw) when the caller cannot read it. */
  get(objectName: string, id: string): Promise<unknown>;
  /**
   * A list read as the caller, `query_records`' read (with its one-level
   * `expand`). A related list with a `where` is read with the link filter and
   * that `where` joined under `$and`, and with its `orderBy` (ADR-0160 D3,
   * second amendment): still one query.
   */
  query(
    objectName: string,
    opts: {
      where: Record<string, unknown>;
      fields?: string[];
      limit?: number;
      expand?: string[];
      orderBy?: Array<{ field: string; order: 'asc' | 'desc' }>;
    },
  ): Promise<unknown>;
  /**
   * [#35137] The served-schema field names and the readable ones, both asked
   * as the caller. OPTIONAL: absent, or `undefined`, names no withheld field.
   */
  fieldVisibilityOf?(objectName: string): Promise<{ served: readonly string[]; readable: readonly string[] } | undefined>;
  /**
   * [ADR-0160 D3, second amendment] The fields the caller may QUERY ON in
   * `objectName` — filter or sort by — the security service's
   * `getQueryableFields` for the caller. OPTIONAL: absent, or `undefined`,
   * the executor takes that contract's fallback (a field that declares a
   * `maskingRule` is never queryable, and neither is one the caller's served
   * schema hides or field-level security withholds).
   */
  queryableFieldsOf?(objectName: string): Promise<readonly string[] | undefined>;
  /**
   * [ADR-0090 D10] Whether a read on `objectName` is narrowed by the agent
   * ceiling, with the security service's sentence. OPTIONAL: a door with no
   * probe states no narrowing.
   */
  diagnoseDelegation?(objectName: string): Promise<{ narrowed: boolean; statement?: string } | undefined>;
  /** The caller's locale ladder for the executor's sentences. OPTIONAL: `en`. */
  userTextLocales?(): Promise<readonly string[]>;
  /**
   * [ADR-0150 D6, addendum 2026-11-25] The manifest namespace of the
   * installed package `packageId` names — what a package's pack is spelt by
   * where its name crosses the AI face (`NS-NAME`, `deriveAiFaceName`): the
   * `context` argument and the candidates a refusal lists. `undefined` for an
   * id the host cannot place. OPTIONAL: a door without it spells every pack by
   * its bare name, as an environment pack is spelt.
   */
  packageNamespace?(packageId: string): string | undefined | Promise<string | undefined>;
}
