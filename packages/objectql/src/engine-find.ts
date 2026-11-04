// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Query lowering, search, find and findOne" section of
 * `ObjectQL`: the bodies of `expandSearchOnAst`, `requireFindOnePredicate`,
 * `reportFindFailure` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link FindHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each method hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { resolveSearchFieldResolution } from '@objectstack/spec/data';
import type { QueryAST, ServiceObject } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { collectCredentialFields, collectInternalReadFields } from './secret-fields.js';
import { expandSearchToFilter, normalizeSearch } from './search-filter.js';
import {
  emptySearchSetError, refuseSearchOverrideNamingNoField, refuseSearchOverrideNamingNoSearchableField,
  writeFailureLogMeta,
} from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface FindHost {
  readonly logger: ObjectQL['logger'];
  resolveSearchQueryableFields: ObjectQL['resolveSearchQueryableFields'];
}

/** The body of `ObjectQL#expandSearchOnAst`; the method's docblock there is its contract. */
export async function expandSearchOnAst(this: Pick<FindHost, 'resolveSearchQueryableFields'>, ast: QueryAST, schema: ServiceObject | undefined, context: ExecutionContext | undefined): Promise<void> {
    // The `$search`/`$searchFields` OData spellings are NOT read here: the
    // protocol layer normalizes them to the bare keys before the engine
    // (protocol.ts findData), and a direct engine call carrying one is an
    // unknown option — rejected at the entry point, not silently dropped
    // (#4371).
    const raw = (ast as any).search;
    // [#27732] An override naming no field is refused, never read as absent.
    // Judged before the expansion and so before any driver read, whether or
    // not a search term rode along, on both slots, as the door does.
    refuseSearchOverrideNamingNoField(ast.object, (ast as any).searchFields, 'searchFields');
    if (raw !== null && typeof raw === 'object') refuseSearchOverrideNamingNoField(ast.object, raw.fields, 'search.fields');
    if (raw != null && schema?.fields) {
      const requestedFields = (ast as any).searchFields
        ?? (typeof raw === 'object' ? raw?.fields : undefined);
      // [#22646] A `search` never scans an `internal: true` column. The flag's
      // promise ("the value is never returned on a generic data exit") is a
      // withhold on the read path (the row strip) and a refusal everywhere the
      // value would be revealed by evaluation; `$search` is such a position —
      // a cross-field `$icontains` that confirms a guessed prefix of a withheld
      // credential, matching the row only when the guess is right. The field is
      // dropped from the set the expansion resolves over (a WITHHOLD, like the
      // auto-default's `hidden`/credential-type exclusions one layer down), so
      // the default set never scans it, for every verb that reaches here
      // (`find` / `findOne` / `aggregate`, and `searchAll` through them). An
      // EXPLICIT `$searchFields` naming one is refused loudly at the generic
      // data door instead (`assertSearchFieldsAreSearchable`,
      // `@objectstack/metadata-protocol`), the #4254 posture — an unhonoured
      // narrowing must be a 400, not a silent widening. A direct engine caller
      // naming one beside a searchable field has it intersected away here, the
      // engine's existing tolerant posture for an unknown requested search
      // field; naming only such fields is refused below (#28120).
      // [ADR-0100] …and never a `secret` / `password` column either, by the
      // collector the credential guards read: the auto-default already skips
      // those types, and an author-declared `searchableFields` naming one is
      // withheld here the same way, so a search term is never evaluated over
      // a value the read path masks.
      const internalFields = [...new Set([...collectInternalReadFields(schema), ...collectCredentialFields(schema)])];
      const scanFields = internalFields.length === 0
        ? (schema.fields as any)
        : Object.fromEntries(
            Object.entries(schema.fields as Record<string, unknown>)
              .filter(([name]) => !internalFields.includes(name)),
          );
      const expandOptions = {
        fields: scanFields,
        searchableFields: (schema as any).searchableFields,
        requestedFields,
        // [ADR-0079] `nameField` is the canonical primary-title pointer;
        // `displayNameField` is the deprecated alias (still honored).
        displayField: (schema as any).nameField ?? (schema as any).displayNameField,
      };
      // [#28120] An override naming none of the fields the expansion would
      // scan is refused, never widened back to the whole set.
      refuseSearchOverrideNamingNoSearchableField(
        ast.object, requestedFields, (ast as any).searchFields != null ? 'searchFields' : 'search.fields',
        resolveSearchFieldResolution(expandOptions).allowed,
      );
      // [#25672] …and never a column the CALLER may not query. The field-read
      // predicate guard (plugin-security) runs after this expansion and judges
      // the expanded `$or` as the caller's own predicate, so one hidden column
      // in the server-resolved set refused the whole search with 403 —
      // `sys_user`'s `role` / `ban_reason` / `last_login_ip` broke every user
      // picker for members. The set is narrowed to the security service's
      // `getQueryableFields` answer, the published complement of what that
      // guard refuses (one derivation, no second field-permission rule here),
      // asked with the context the middleware will see. A field the caller
      // NAMED in `searchFields` is not withheld, so the guard still refuses it
      // loudly. The guard itself is unchanged, and still judges every
      // predicate the caller wrote.
      const queryableFields = normalizeSearch(raw).query.trim()
        ? await this.resolveSearchQueryableFields(ast.object, context)
        : undefined;
      const searchFilter = expandSearchToFilter(raw, { ...expandOptions, queryableFields });
      if (searchFilter) {
        ast.where = ast.where ? { $and: [ast.where, searchFilter] } : searchFilter;
      } else if (normalizeSearch(raw).query.trim()) {
        // [#24284] A non-blank term that expanded to nothing means the RESOLVED
        // search set is empty: `expandSearchToFilter` answers `null` for
        // exactly two reasons, and the other one (a blank term) is excluded
        // here. Leaving `where` untouched would answer the search with EVERY
        // row, indistinguishable from "everything matched" — the silent
        // widening #4254 refuses on the explicit-override axis. Judged on the
        // set the expansion itself resolved (no second resolver), so it holds
        // for every verb that reaches here (`find` / `findOne` / `aggregate` /
        // the count) and every door (REST, dispatcher, SDK, a hook's
        // `ctx.api`). An explicit override intersected to nothing is refused
        // before the expansion (#28120) unless the allowed set is empty too, so
        // it reaches this only then. [#25672] A set the caller's
        // queryable fields withheld down to nothing gets the same answer: the
        // declared set expands without the narrowing, so the refusal says so.
        const withheld = queryableFields !== undefined && expandSearchToFilter(raw, expandOptions) !== null;
        throw emptySearchSetError(ast.object, schema, internalFields.length > 0, withheld);
      }
    }
    delete (ast as any).search;
    delete (ast as any).searchFields;
  }

/** The body of `ObjectQL#requireFindOnePredicate`; the method's docblock there is its contract. */
export function requireFindOnePredicate(object: string, ast: QueryAST): void {
    const where = ast.where as unknown;
    const hasPredicate =
      where != null &&
      (typeof where !== 'object' || Array.isArray(where) || Object.keys(where).length > 0);
    if (hasPredicate) return;
    if (Array.isArray(ast.orderBy) && ast.orderBy.length > 0) return;
    throw new Error(
      `findOne('${object}') selects no particular record: 'where' is absent or empty ` +
      `and the query carries no 'orderBy'. findOne applies limit: 1, so this would return an ` +
      `ARBITRARY row — a real, plausible-looking record unrelated to what was asked for, which ` +
      `no caller's null-check can catch. Pass 'where' (or a 'search' that resolves to ` +
      `one) to select the record; pass 'orderBy' if you mean "the first record in THIS order"; ` +
      `or call find('${object}', { limit: 1 }) if any row will genuinely do.`,
    );
  }

/** The body of `ObjectQL#reportFindFailure`; the method's docblock there is its contract. */
export function reportFindFailure(this: Pick<FindHost, 'logger'>, object: string, error: unknown): void {
    if (isMissingTableError(error, object)) {
      this.logger.debug('Find operation failed', {
        object,
        reason: 'table-not-provisioned',
        error: (error as { message?: unknown } | null | undefined)?.message,
      });
      return;
    }
    // [#17212] `warn`, not `error`: `find`'s `catch` rethrows, so the caller
    // is told — see the docblock's last section.
    this.logger.warn('Find operation failed', writeFailureLogMeta(error, { object }));
  }
