// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The association seam: given participant addresses, which records does a
 * message belong to? (ruling 6116489638 on #22870, Q1 A.)
 *
 * The app answers it by DECLARATION, never by code: every `email` field
 * flagged `mailAssociation: true` (`FieldSchema`, `@objectstack/spec/data`)
 * names a field whose value identifies a correspondent. A record matches when
 * its value in such a field equals one of the participant addresses — ASCII
 * case-insensitive, inside the mailbox's organization only. Each match is one
 * `{ object, recordId, matchedField, matchedAddress }`, which becomes one
 * `sys_mail_association` row. No match means the pool.
 *
 * The platform learns which fields carry a correspondent's address and never
 * what a contact is: every object that flags a field is read the same way.
 *
 * ## The read
 *
 * One system-context read per (flagged field, chunk of addresses), scoped by
 * the object's `organization_id` column. The comparison is `$icontains` — the
 * case-insensitive operator every driver executes with its own LIKE escaping —
 * and the exact equality is then decided here on the value read back, so a
 * substring hit (`bob@acme.com` inside `jimbob@acme.com`) never matches. A
 * flagged object with no `organization_id` column (tenancy disabled, or
 * declared platform-global) holds no organization's records, so nothing in
 * one mailbox's organization can match it; it is skipped, and said so once.
 */

import { MAIL_ASSOCIATION_OBJECT, MAIL_MESSAGE_OBJECT, MAILBOX_OBJECT } from '../mail-read-visibility.js';
import { normalizeMailAddress } from './match-addresses.js';

/** One match: the record a participant address identifies, and how. */
export interface MailAssociationMatch {
  /** Machine name of the record's object. */
  object: string;
  recordId: string;
  /** The flagged email field whose value equalled the address. */
  matchedField: string;
  /** The participant address, normalized. */
  matchedAddress: string;
}

/** The engine surface the matcher reads. */
export interface MailMatchEngine {
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  registry?: { getAllObjects?(): ReadonlyArray<unknown> };
}

/** The logger surface the matcher reports through. */
export interface MailMatchLogger {
  warn(message: string): void;
}

/** One flagged field: an `email` field declaring `mailAssociation: true`. */
export interface MailAssociationField {
  object: string;
  field: string;
}

/** Addresses per read: one `$or` branch each. */
export const MATCH_ADDRESS_CHUNK = 50;
/** Rows per read. Beyond it the read may be incomplete, and is said so. */
export const MATCH_SCAN_LIMIT = 1_000;

const SYSTEM_CTX = { isSystem: true } as const;
const ORGANIZATION_COLUMN = 'organization_id';
const MAIL_OBJECTS: ReadonlySet<string> = new Set([MAIL_MESSAGE_OBJECT, MAIL_ASSOCIATION_OBJECT, MAILBOX_OBJECT]);

type AnyRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is AnyRecord => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The flagged fields of every registered object, in registry order, and the
 * flagged objects that carry no organization column (which cannot be matched).
 */
export function flaggedFieldsOf(engine: MailMatchEngine): {
  fields: MailAssociationField[];
  unscoped: string[];
} {
  const fields: MailAssociationField[] = [];
  const unscoped: string[] = [];
  for (const schema of engine.registry?.getAllObjects?.() ?? []) {
    if (!isRecord(schema) || typeof schema.name !== 'string' || MAIL_OBJECTS.has(schema.name)) continue;
    const defs = isRecord(schema.fields) ? schema.fields : {};
    const flagged = Object.entries(defs)
      .filter(([, def]) => isRecord(def) && def.type === 'email' && def.mailAssociation === true)
      .map(([field]) => field);
    if (flagged.length === 0) continue;
    if (!(ORGANIZATION_COLUMN in defs)) {
      unscoped.push(schema.name);
      continue;
    }
    for (const field of flagged) fields.push({ object: schema.name, field });
  }
  return { fields, unscoped };
}

/**
 * The record matcher. Holds the "said once" memory for unscoped objects, so a
 * long-lived instance does not repeat itself per message.
 */
export class MailRecordMatcher {
  private readonly reportedUnscoped = new Set<string>();

  constructor(
    private readonly engine: () => MailMatchEngine,
    private readonly logger: MailMatchLogger,
  ) {}

  /**
   * Every match for `addresses` inside `organizationId`, keyed by address.
   * An address with no match has no key.
   */
  async match(organizationId: string, addresses: ReadonlyArray<string>): Promise<Map<string, MailAssociationMatch[]>> {
    const out = new Map<string, MailAssociationMatch[]>();
    const wanted = [...new Set(addresses.map(normalizeMailAddress).filter((a): a is string => a !== null))];
    if (wanted.length === 0) return out;

    const engine = this.engine();
    const { fields, unscoped } = flaggedFieldsOf(engine);
    for (const object of unscoped) {
      if (this.reportedUnscoped.has(object)) continue;
      this.reportedUnscoped.add(object);
      this.logger.warn(
        `[mailbox] '${object}' flags an email field with mailAssociation but has no organization column, so no ` +
          "mailbox's mail can be matched to its records; it is skipped. Matching is scoped to a mailbox's " +
          'organization, and only an organization-scoped object holds records of one.',
      );
    }

    for (const { object, field } of fields) {
      for (let i = 0; i < wanted.length; i += MATCH_ADDRESS_CHUNK) {
        const chunk = wanted.slice(i, i + MATCH_ADDRESS_CHUNK);
        const rows = await engine.find(object, {
          where: {
            $and: [
              { [ORGANIZATION_COLUMN]: organizationId },
              { $or: chunk.map((address) => ({ [field]: { $icontains: address } })) },
            ],
          },
          fields: ['id', field],
          limit: MATCH_SCAN_LIMIT,
          context: { ...SYSTEM_CTX },
        });
        if (rows.length >= MATCH_SCAN_LIMIT) {
          this.logger.warn(
            `[mailbox] matching '${object}.${field}' read the ${MATCH_SCAN_LIMIT}-row bound for one set of ` +
              'participant addresses, so some matching records may not be associated; a re-match adds them later.',
          );
        }
        const inChunk = new Set(chunk);
        for (const row of rows) {
          const address = normalizeMailAddress(row[field]);
          const id = row.id;
          if (address === null || !inChunk.has(address)) continue;
          if (typeof id !== 'string' && typeof id !== 'number') continue;
          let list = out.get(address);
          if (!list) out.set(address, (list = []));
          list.push({ object, recordId: String(id), matchedField: field, matchedAddress: address });
        }
      }
    }
    return out;
  }
}

/**
 * The links for one message: the matches of each of its addresses, in address
 * order, one per record (a record two addresses or two fields match is linked
 * once, by the first).
 */
export function linksFor(
  addresses: ReadonlyArray<string>,
  matches: ReadonlyMap<string, ReadonlyArray<MailAssociationMatch>>,
): MailAssociationMatch[] {
  const seen = new Set<string>();
  const out: MailAssociationMatch[] = [];
  for (const address of addresses) {
    for (const match of matches.get(address) ?? []) {
      const key = `${match.object} ${match.recordId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(match);
    }
  }
  return out;
}
