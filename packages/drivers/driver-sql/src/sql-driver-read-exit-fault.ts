// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25521 cut 15] The fault terminals of `SqlDriver`'s read exits: what a read
 * answers when the backend refused its statement. `backendStatementFault` is
 * the #8931 terminal that `find` and `count` end in;
 * `unresolvableFilterColumnRefusal` is #8790's `INVALID_FILTER` for a WHERE
 * column the database could not resolve; `aggregateBackendFault` and
 * `distinctBackendFault` are the classifiers of `aggregate` and `distinct`,
 * and `unresolvableAggregateColumnRefusal` and
 * `unresolvableDistinctColumnRefusal` are the column refusals only those two
 * raise. They moved out of `sql-driver.ts` whole, with the four module-level
 * declarations only they read: the #8931 envelope `backendStatementFaultError`,
 * #8790's `unresolvableFilterColumnError`, the dialect-message reader
 * `unresolvableColumnNameOf` and the #20020 attribution walk
 * `unresolvableColumnProvenance`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited, and each moved declaration is byte-identical: the same envelopes,
 * the same redacted log lines, the same arms in the same order.
 *
 * What did NOT move, and why:
 *
 *  - The read exits themselves (`findRows`, `count`, `aggregate`, `distinct`)
 *    build through `getBuilder`, and stay.
 *  - `isUnresolvableColumnError` (also read by `findRows` and `count`),
 *    `OWN_STATEMENT_FAULT` (also read by `sql-driver-raw-execution.ts`, which
 *    imports it from there), `PRE_DDL_QUESTION_SCOPE` (also run by the two
 *    media-arm resolvers), `unsupportedFilterError` and `isFilterNode` are
 *    shared with code that stays. The three that were not exported gained
 *    `export` in place in `sql-driver.ts`, and all five are imported here.
 *  - `mapSortField` and `remoteColumn` are read by members that stay too; the
 *    moved bodies reach them through the host.
 *
 * ## How the moved bodies reach the class
 *
 * The shape the other seam modules apply, after #23050. The class keeps every
 * method, because the published `dist/*.d.ts` lists each one's name,
 * docblock and position, because `driver-turso` calls `aggregateBackendFault`
 * and `distinctBackendFault` on its own instance, and because a subclass may
 * override any of the six and call `super`. Each method body is now one
 * literal of exactly the {@link ReadExitFaultHost} members that method reads,
 * plus a `.call`. Methods go as closures that call them on the driver at call
 * time, so a subclass override or an instance spy is still the one a body
 * reaches (the classifiers reach the refusals and the terminal that way); the
 * fields `logger`, `physicalTableByObject`, `deferredDdl` and
 * `deferredSchemaObjects` go as GETTERS, so each read happens when the body
 * makes it, as it did on the class.
 *
 * The module cycle is evaluation-safe because every value import from
 * `sql-driver.ts` is read only inside a function body, never while the two
 * modules are first evaluated. `index.ts` re-exports nothing from this module
 * and names its `sql-driver.ts` exports one by one, so the published surface
 * does not move.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { resolveFilterSubtreeProvenance } from '@objectstack/spec/data';
import { declareTargetedTable, isMissingTableError } from '@objectstack/types';
// [#21385] The ONE driver-fault redaction the engine also calls (maintainer
// ruling of 2026-10-02, letter A: one cutter for every log face). Each refusal
// line below writes the dialect's text through it, so the line keeps its code,
// its class of fault and the dialect's own diagnostic while the statement and
// the values bound or inlined into it are cut. It lives in `@objectstack/types`,
// the lowest package every face of the family reaches.
import { redactStatementFromMessage } from '@objectstack/types';
import {
  isFilterNode,
  isUnresolvableColumnError,
  OWN_STATEMENT_FAULT,
  PRE_DDL_QUESTION_SCOPE,
  type SqlDriver,
  unsupportedFilterError,
} from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface ReadExitFaultHost {
  backendStatementFault: SqlDriver['backendStatementFault'];
  readonly deferredDdl: SqlDriver['deferredDdl'];
  readonly deferredSchemaObjects: SqlDriver['deferredSchemaObjects'];
  readonly logger: SqlDriver['logger'];
  mapSortField: SqlDriver['mapSortField'];
  readonly physicalTableByObject: SqlDriver['physicalTableByObject'];
  remoteColumn: SqlDriver['remoteColumn'];
  unresolvableAggregateColumnRefusal: SqlDriver['unresolvableAggregateColumnRefusal'];
  unresolvableDistinctColumnRefusal: SqlDriver['unresolvableDistinctColumnRefusal'];
  unresolvableFilterColumnRefusal: SqlDriver['unresolvableFilterColumnRefusal'];
}

/**
 * [#8790] The column name the dialect named, or `null` when its wording did not
 * yield one.
 *
 * The ruling requires the refusal to NAME the column, and the dialect's message
 * is the only place that name exists: the driver reaches this point precisely
 * when no local field map could answer the question (the registry-backstop case
 * the ladder below exists for), so there is nothing else to ask.
 *
 * ⛔ The name is ALL that may be taken from that message. The rest of it is the
 * compiled statement with the caller's bound literals inlined
 * (`… where \`title\`.\`x\` = 'y' - no such column: title.x`), which is the
 * predicate-text disclosure #7929 redacted elsewhere and the reason `count()`'s
 * old raw throw was a defect rather than merely an unhelpful envelope. The full
 * text goes to the server log — see
 * {@link SqlDriver.refuseUnresolvableFilterColumn} — never to the caller.
 *
 * `null` is a real answer, not a failure to handle: an unrecognised wording
 * still refuses, with the same code and status, just without the name. Reading
 * a `null` as "not an unresolvable column after all" would restore the silent
 * `[]` for every dialect message this function has not been taught.
 */
export function unresolvableColumnNameOf(error: unknown): string | null {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  if (typeof message !== 'string') return null;
  // SQLite: `… - no such column: title.x`
  const sqlite = /no such column:\s*([^\s,;)]+)/.exec(message);
  if (sqlite) return sqlite[1];
  // Postgres, quoted: `… - column "nosuchcol" does not exist`
  const pgQuoted = /column\s+"([^"]+)"\s+does not exist/.exec(message);
  if (pgQuoted) return pgQuoted[1];
  // Postgres, unquoted and possibly table-qualified: `column task.nosuchcol does not exist`
  const pgBare = /column\s+([A-Za-z0-9_$.]+)\s+does not exist/.exec(message);
  if (pgBare) return pgBare[1];
  // MySQL (ER_BAD_FIELD_ERROR), every clause position with one sentence:
  // `… - Unknown column 'nosuchcol' in 'where clause'` / `'field list'` /
  // `'order clause'` [#8926]
  const mysql = /Unknown column '([^']+)' in '/.exec(message);
  if (mysql) return mysql[1];
  return null;
}

/**
 * [#8790, maintainer ruling 2026-08-15] A WHERE the backend could not compile
 * because it names a column that does not resolve — refused, on BOTH read
 * halves, with the ADR-0112 envelope this path already declares.
 *
 * # What this replaces, and why neither old answer survived
 *
 * One predicate used to get two answers. `find()` fell to the #3821 ladder's
 * terminal `return []` — a caller reading "no records exist" for what was
 * really "your predicate never ran", the single most AI-legible failure to get
 * wrong, since an agent writes its next query on that belief. `count()`, which
 * has no ladder, threw the dialect's own error: `code: 'SQLITE_ERROR'`, no
 * `status`, and the statement's bound literals inlined in the message. A list
 * view calls both, so one query produced an empty page and a 500-shaped total.
 *
 * `INVALID_FILTER` / 400 is not minted here — it is the envelope every sibling
 * refusal on this path already answers with ({@link unsupportedFilterError}),
 * required on both SQL drivers by `cross-field-conformance-cases.ts` and pinned
 * by `sql-driver-boolean-identity.test.ts` and
 * `sql-driver-cross-field-conformance.test.ts`. What #8790 closes is a
 * declared-vs-enforced gap, not a new posture.
 *
 * # Why refusal rather than recovery, on this clause only
 *
 * The ladder around it KEEPS recovering a projection and an ORDER BY, and that
 * asymmetry is the ruling, not an oversight: "rows matter more than their
 * order" is an argument about how rows are *presented*, and it does not
 * transfer to a predicate. Dropping a WHERE would answer with records the
 * caller explicitly excluded — a wrong answer, where a dropped sort is a
 * correct answer in an unhelpful order. Recover-both was rejected for exactly
 * that reason.
 *
 * # The wording
 *
 * The middle sentence is the ingress door's, verbatim
 * (`assertFilterFieldsExist`, `@objectstack/metadata-protocol`): one condition
 * refused at two layers must not be explained two different ways. This one adds
 * what only the driver knows — that the column is missing from the TABLE, which
 * a caller whose field map declares it can only fix by syncing the schema.
 */
function unresolvableFilterColumnError(object: string, column: string | null): Error {
  return unsupportedFilterError(
    (column === null
      ? `A filter on object '${object}' names a column the database could not resolve`
      : `Filter on '${column}' names a column that object '${object}' has no column for`) +
      ', so the predicate never ran. A filter on a field that does not exist can only match ' +
      'zero records, so the query was refused instead of answered with an empty list. Check ' +
      "the name against the object's fields; if the field was declared recently, run schema " +
      'sync so the column exists before filtering on it.' +
      (column === null
        ? ' The name the database reported is in the server log.'
        : ''),
  );
}

/**
 * [#8931, maintainer ruling 2026-08-17 「同意 C」] The backend rejected the
 * statement, and the driver claims NOTHING beyond that.
 *
 * # What this envelope asserts, and what it deliberately refuses to assert
 *
 * Exactly one thing: *the backend would not run this statement*. It is not
 * `INVALID_FILTER` and carries no verdict about the filter, the projection, the
 * sort or the object. That restraint is the ruling, and it is forced by a
 * measurement rather than chosen for tone: on Postgres a dotted WHERE key
 * (`{'title.x': v}`, which knex compiles to the qualified reference
 * `"title"."x"`) and a table that was never provisioned raise the SAME
 * SQLSTATE — `42P01` — differing only in Postgres' own prose:
 *
 * ```
 * dotted key      42P01  missing FROM-clause entry for table "title"   (errorMissingRTE)
 * missing table   42P01  relation "no_such_object" does not exist      (parserOpenTable)
 * ```
 *
 * Measured on a live PostgreSQL 16.13. A driver that answered `INVALID_FILTER`
 * here would tell an operator whose schema sync had not run that their FILTER
 * was wrong; one that answered "table not provisioned" would tell a caller with
 * a dotted key that the object is missing. Neither claim is supportable from
 * the signal, so this envelope makes neither.
 *
 * # Why a catch-all rather than a predicate
 *
 * The alternative — recognise `42P01` and answer something specific — is a
 * SECOND recognizer on an error class beside {@link isUnresolvableColumnError},
 * i.e. two spellings of "the driver recognises this dialect error" with
 * different consequences in one file. That is the split-predicate shape the
 * #8926 ruling already refused, and it is refused again here. The rule stays
 * the ruled one: refuse what the backend could not resolve, and ⛔ never
 * inspect the caller's key for a `.` — the dotted-path VERDICT is #8371's, and
 * it landed there (PR #8936).
 *
 * # `DATABASE_ERROR` / 500, and why that is the honest pair
 *
 * `DATABASE_ERROR` is the catalog's own "database operation failed"
 * (`StandardErrorCode`, `## Server Errors (500)`), and it is already the verdict
 * `packages/rest` derives for this condition by sniffing the message
 * (`DATA_STORE_FAULT` — `500` + `DATABASE_ERROR`). So the wire answer a REST
 * caller sees does not move; what moves is WHERE it is decided. It is declared
 * by the producer that actually knows, per ADR-0112, instead of re-derived from
 * prose at a boundary — and every non-REST consumer (an in-process ObjectQL
 * caller, a plugin, an AI-authored action) gets the same declared answer, which
 * before this had to pattern-match a SQLSTATE that differs per backend.
 *
 * 400 was not available: it would assert the caller's request is at fault, and
 * this envelope exists precisely because the driver cannot attribute the
 * failure. 500 also keeps the answer inside `declaresServerFault`
 * (`@objectstack/types`), so both HTTP doors withhold the prose and log it.
 *
 * # The original is kept as `cause`, and that is load-bearing
 *
 * `isMissingTableError` (`@objectstack/metadata`) is the predicate three read
 * paths use to tell "the table was never provisioned" — a benign emptiness —
 * from a failure that must stay loud: `seedAutonumber` (returns 0),
 * `resolveFileReferences` (fails open silently) and the delete-dependents probe
 * (skips the relation). Wrapping WITHOUT the original attached would have
 * flipped all three to their loud branch, which is a change to what the
 * platform accepts — expressly outside this ruling.
 *
 * That predicate already follows `error.cause` up to four levels, with its own
 * pins (`packages/types/src/driver-error-classification.test.ts` — commit 6a180e42d
 * moved it there from `metadata/src/utils/schema-sync-errors.test.ts` —
 * "follows an error wrapped as `cause`"), because "drivers commonly re-throw
 * with the original attached as `cause`" is a case it was built for. So the
 * wrap is transparent to it and to every other cause-following consumer, and
 * ⛔ the predicate itself is untouched.
 *
 * The property is defined NON-ENUMERABLE, the same shape `new Error(msg, {
 * cause })` produces. An enumerable `cause` would ride out through
 * `JSON.stringify(err)` and `{ ...err }` — putting the compiled statement, and
 * on the dialects that inline them the caller's bound literals, back on any
 * wire that serialises the error. The carrier must be readable by code and
 * invisible to serialisation, which is the same reasoning
 * {@link WITHHELD_FILTER_DIAGNOSTIC} applies one refusal over.
 *
 * # The targeted table is declared on the envelope, and never in the message
 *
 * [#13438] `isMissingTableError(error, readObject)` compares the dialect phrase
 * against the name the CALLER read — its API object name — and for a federated
 * object (ADR-0015) that is not the name in the statement: {@link
 * SqlDriver.getBuilder} targets `external.remoteName`. A genuinely absent
 * remote therefore raised a phrase naming `legacy_orders` against a caller
 * naming `crm_order`, and commit 4cda78c9b's comparison read a real missing table as
 * "about something else" — loud, for the one case the licence exists for.
 * Nothing at a call site can fold that away: the mapping lives on this
 * instance.
 *
 * Maintainer ruling 2026-09-01 (option 2 on the card): the driver DECLARES the
 * table its statement targeted, and the predicate prefers the declared name
 * over the caller's. `targetedTable` is that name, resolved by
 * {@link SqlDriver.backendStatementFault} exactly as `getBuilder` resolves it,
 * so it is the table the statement was compiled against and not a
 * re-derivation. It travels under `@objectstack/types`' `DRIVER_TARGETED_TABLE`
 * symbol, non-enumerable — the same carrier discipline as `cause` above, for
 * the same reason: the physical table is precisely what the composed message
 * withholds, and a member that serialised would put it back on the wire. ⛔ It
 * is never written into the message; the disclosure clause below stands.
 *
 * @param object - the API object name the caller asked for. Its own vocabulary,
 *                 never the physical table: see the message note below.
 * @param cause  - the dialect error, kept whole for the log and for
 *                 cause-following predicates.
 * @param targetedTable - the physical table the failed statement was compiled
 *                 against: a federated object's `external.remoteName`,
 *                 otherwise the object's own name. Declared on the envelope for
 *                 `isMissingTableError`; never echoed.
 */
function backendStatementFaultError(object: string, cause: unknown, targetedTable: string): Error {
  // ⛔ No dialect text reaches the caller — not the statement, not the quoted
  // references, not the `$n` placeholders, not the backend's own prose. The
  // ruling's disclosure clause, and it is why this message is COMPOSED rather
  // than derived from the dialect's: measured on live PG 16.13, a derivation
  // that keeps the diagnostic tail (the shape `redactStatementFromMessage`
  // produces) still ships `invalid input syntax for type integer:
  // "zz-not-a-number"` — Postgres inlines the caller's value in its OWN
  // diagnostic on `22P02`, downstream of anything knex parameterised. There is
  // no cut that keeps a dialect's words and reliably drops a caller's value,
  // so none is attempted.
  //
  // The object name is the caller's own input (the API name it passed), not
  // the physical table it maps to, so echoing it discloses nothing the caller
  // did not write — the same line every sibling refusal in this file draws.
  const err = new Error(
    `The database refused to run this query for object '${object}'. The driver could not ` +
      'attribute the failure to any part of the request, so no verdict about the query is ' +
      "claimed here. The backend's own diagnostic was written to the server log for an " +
      'operator to read, with the compiled statement and its bound values cut.',
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.DATABASE_ERROR;
  err.status = 500;
  Object.defineProperty(err, 'cause', {
    value: cause,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  // [#13438] Code-readable, serialisation-invisible — see the section above.
  declareTargetedTable(err, targetedTable);
  return err;
}

/**
 * [#20020] The provenance of the predicate that named a column the BACKEND could
 * not resolve — the one refusal on the WHERE path that is raised from a dialect
 * error after the statement ran, not from a node the compiler held.
 *
 * The dialect names a column and nothing else, so the node has to be found by
 * that name: every plain-object node of `rootFilter` carrying a field key that
 * resolves to `column` (as written, through {@link SqlDriver.mapSortField}'s
 * spelling, or through an external object's column map), plus every
 * `{ $field }` reference naming it. The answer is `'author'` only when there is
 * at least one such node AND every one of them resolves `'author'` under
 * `resolveFilterSubtreeProvenance`; anything else is `null`, which withholds.
 *
 * The match is deliberately generous — the qualified spelling a dialect may
 * report (`task.nosuchcol`) matches the key `nosuchcol` too — because a false
 * match can only ADD a node to the set, and one more node can only turn an
 * `'author'` verdict into `null`. A column no node names (the tenant-scope wall
 * the driver adds itself, a mapping this walk does not replicate) finds no
 * node and is withheld. The walk visits plain objects and arrays only, the
 * shapes `resolveFilterSubtreeProvenance` itself descends, and stops on a cycle.
 */
function unresolvableColumnProvenance(
  rootFilter: unknown,
  column: string,
  namesOf: (key: string) => readonly string[],
): 'author' | null {
  const names = (key: string) => namesOf(key).some((n) => n === column || column.endsWith(`.${n}`));
  const holders: object[] = [];
  const onPath = new Set<object>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || onPath.has(node)) return;
    const isArray = Array.isArray(node);
    if (!isArray && !isFilterNode(node)) return;
    onPath.add(node);
    if (isArray) {
      for (const element of node as unknown[]) visit(element);
    } else {
      const record = node as Record<string, unknown>;
      const ref = record.$field;
      const namesColumn =
        (typeof ref === 'string' && names(ref)) ||
        Object.keys(record).some((key) => !key.startsWith('$') && names(key));
      if (namesColumn) holders.push(record);
      for (const value of Object.values(record)) visit(value);
    }
    onPath.delete(node);
  };
  visit(rootFilter);
  if (holders.length === 0) return null;
  for (const holder of holders) {
    if (resolveFilterSubtreeProvenance(rootFilter, holder) !== 'author') return null;
  }
  return 'author';
}

/** The body of `SqlDriver#unresolvableFilterColumnRefusal`; the method's docblock there is its contract. */
export function unresolvableFilterColumnRefusal(this: Pick<ReadExitFaultHost, 'logger' | 'mapSortField' | 'remoteColumn'>, object: string, error: unknown, rootFilter?: unknown): Error {
  const column = unresolvableColumnNameOf(error);
  const detail = (error as { message?: unknown } | null | undefined)?.message;
  this.logger.warn(
    `[sql-driver] INVALID_FILTER — a WHERE column could not be resolved on '${object}'` +
      (column === null ? '' : ` ('${column}')`) +
      '. The dialect diagnostic, with the statement and its bound literals cut: ' +
      redactStatementFromMessage(typeof detail === 'string' ? detail : String(error), OWN_STATEMENT_FAULT),
  );
  const disclosed =
    column !== null &&
    unresolvableColumnProvenance(rootFilter, column, (key) => {
      const local = this.mapSortField(key);
      return [key, local, this.remoteColumn(object, key, local)];
    }) === 'author';
  return unresolvableFilterColumnError(object, disclosed ? column : null);
}

/** The body of `SqlDriver#backendStatementFault`; the method's docblock there is its contract. */
export function backendStatementFault(this: Pick<ReadExitFaultHost, 'deferredDdl' | 'deferredSchemaObjects' | 'logger' | 'physicalTableByObject'>, object: string, error: unknown): Error {
  // Never re-envelope something that already declares one. Nothing on
  // today's read path can (the filter compiler's refusals are raised before
  // the statement is executed, outside the `try`), but this method is the
  // terminal of a subclassable driver — `driver-turso` and
  // `driver-sqlite-wasm` both extend `SqlDriver` — and a double wrap would
  // bury a precise refusal under a generic one. Asked over the DECLARED
  // status, the same gate `packages/rest`'s `declaredHttpStatus` reads, and
  // ⛔ not over any error CLASS: this is "is it already ours", not a second
  // recognizer for a dialect condition.
  const declared = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof declared === 'number') return error as Error;

  const detail = (error as { message?: unknown } | null | undefined)?.message;
  const code = (error as { code?: unknown } | null | undefined)?.code;
  // [#21385] Cut ONCE, here, so every line below writes the same text: the
  // warn line the ruling names and the two debug lines that demote it inside
  // a scope. A server log leaves the data's trust boundary at any level.
  const dialectText = redactStatementFromMessage(
    typeof detail === 'string' ? detail : String(error),
    OWN_STATEMENT_FAULT,
  );
  // [#13438] The table the statement was compiled against, resolved the way
  // {@link SqlDriver.getBuilder} resolves it — a federated object's
  // `external.remoteName`, otherwise the object's own name — because every
  // read exit that reaches here built its statement through `getBuilder`.
  // Declared on the envelope for `isMissingTableError`; never in the message.
  const targetedTable = this.physicalTableByObject[object] ?? object;
  const envelope = backendStatementFaultError(object, error, targetedTable);

  // [#20768] One class leaves the warn channel, and only inside one scope: a
  // table that does not exist yet, read while a driver asks its pre-DDL
  // question (the ADR-0104 media-arm resolver, asked before the schema pass
  // creates any table). On the first boot of a new database that read is
  // `sys_migration`, and its refusal is the ordinary state of the store. The
  // resolver hears the refusal and answers "not moved", as it always did.
  //
  // ⛔ Demoted, not deleted: the same dialect text goes to `debug`, which the
  // default sink does not have. ⛔ Asked through the one shared predicate,
  // over the envelope's DECLARED target, so a missing table named by some
  // other relation (a view over a dropped table) is not this class. Every
  // other refusal in the scope, and a missing table outside it, warns below.
  if (PRE_DDL_QUESTION_SCOPE.getStore() === true && isMissingTableError(envelope, object)) {
    this.logger.debug?.(
      `[sql-driver] '${object}' does not exist yet: it was read while this driver asked its ` +
        'pre-DDL question (the ADR-0104 media-arm resolver), before its schema pass created ' +
        'any table. The refusal goes back to the resolver, which answers from it: ' +
        dialectText,
    );
    return envelope;
  }

  // [#20821] The second class, keyed on a fact THIS driver recorded: a table
  // whose DDL it deferred (`os migrate plan` / `apply` boot with
  // {@link setDeferredDdl}), read before that DDL ran. On a database the dry
  // run found empty, every boot reader of `sys_metadata`,
  // `sys_metadata_activation` and `sys_migration` lands here, and each one
  // already answers from the refusal (nothing restored, nothing attached,
  // "not verified"). The plan lists the same tables as `create_table`, so
  // the refusal is the state the operator is being shown, not a fault.
  //
  // ⛔ All three conditions, or it warns below: DDL is deferred on this
  // driver; the targeted table is in its OWN deferred set (a missing table
  // nobody in this boot declared is information, not this class); and the
  // one shared predicate holds over the envelope's declared target. ⛔ The
  // set is consulted, never the reason: a table that exists answers its read
  // whatever the deferral, and any other refusal on it still warns.
  if (
    this.deferredDdl &&
    this.deferredSchemaObjects.has(targetedTable) &&
    isMissingTableError(envelope, object)
  ) {
    this.logger.debug?.(
      `[sql-driver] '${object}' does not exist yet: this driver deferred its DDL (a dry run ` +
        'records the create-table instead of performing it), so the read is refused until the ' +
        'deferred work is applied. The refusal goes back to the caller unchanged: ' +
        dialectText,
    );
    return envelope;
  }

  this.logger.warn(
    `[sql-driver] DATABASE_ERROR — the backend refused a read on '${object}'` +
      (typeof code === 'string' && code.length > 0 ? ` (${code})` : '') +
      '. The dialect diagnostic, with the compiled statement and its bound literals cut: ' +
      dialectText,
  );
  return envelope;
}

/** The body of `SqlDriver#aggregateBackendFault`; the method's docblock there is its contract. */
export function aggregateBackendFault(this: Pick<ReadExitFaultHost, 'backendStatementFault' | 'unresolvableAggregateColumnRefusal' | 'unresolvableFilterColumnRefusal'>, object: string, query: DriverQuery, error: unknown): Error {
  if (isUnresolvableColumnError(error)) {
    const column = unresolvableColumnNameOf(error);
    if (column !== null) {
      // The same reads the statement builder performed a few lines up —
      // string entries and structured `{ field }` entries for groupBy, the
      // optional `field` for each aggregation. `alias` is deliberately not
      // consulted: the backend resolves columns, and an alias is an OUTPUT
      // name, never a column reference the statement could trip on.
      const inGroupBy = (query.groupBy ?? []).some(
        (g) => (typeof g === 'string' ? g : g && typeof g === 'object' ? g.field : undefined) === column,
      );
      const inAggregations = (query.aggregations ?? []).some(
        (a) => a && typeof a === 'object' && a.field === column,
      );
      if (inGroupBy || inAggregations) {
        return this.unresolvableAggregateColumnRefusal(object, column, { inGroupBy, inAggregations }, error);
      }
      return this.unresolvableFilterColumnRefusal(object, error, query.where);
    }
    // Arm 3: recognised class, no parsed name — fall through to the terminal.
  }
  // [#8931] The terminal catch-all — see {@link SqlDriver.backendStatementFault}.
  return this.backendStatementFault(object, error);
}

/** The body of `SqlDriver#unresolvableAggregateColumnRefusal`; the method's docblock there is its contract. */
export function unresolvableAggregateColumnRefusal(this: Pick<ReadExitFaultHost, 'logger'>, object: string, column: string, namedBy: { inGroupBy: boolean; inAggregations: boolean }, error: unknown): Error {
  const detail = (error as { message?: unknown } | null | undefined)?.message;
  this.logger.warn(
    `[sql-driver] INVALID_FIELD — a groupBy/aggregation column could not be resolved on ` +
      `'${object}' ('${column}'). The dialect diagnostic, with the statement and its bound ` +
      'literals cut: ' +
      redactStatementFromMessage(typeof detail === 'string' ? detail : String(error), OWN_STATEMENT_FAULT),
  );
  const clause =
    namedBy.inGroupBy && namedBy.inAggregations
      ? `The groupBy and an aggregation of this query both name '${column}', a column`
      : namedBy.inGroupBy
        ? `The groupBy of this query names '${column}', a column`
        : `An aggregation of this query names '${column}', a column`;
  const err = new Error(
    `${clause} that object '${object}' has no column for, so the aggregate never ran. ` +
      'Grouping and aggregation run over columns that exist; over a missing one they could ' +
      'only answer blanks, so the query was refused instead of answered with an invented ' +
      "result. Check the name against the object's fields; if the field was declared " +
      'recently, run schema sync so the column exists before aggregating on it.',
  ) as Error & { code?: string; status?: number; field?: string; object?: string };
  err.code = StandardErrorCode.enum.INVALID_FIELD;
  err.status = 400;
  err.field = column;
  err.object = object;
  return err;
}

/** The body of `SqlDriver#distinctBackendFault`; the method's docblock there is its contract. */
export function distinctBackendFault(this: Pick<ReadExitFaultHost, 'backendStatementFault' | 'unresolvableDistinctColumnRefusal' | 'unresolvableFilterColumnRefusal'>, object: string, field: string, error: unknown, filters?: unknown): Error {
  if (isUnresolvableColumnError(error)) {
    const column = unresolvableColumnNameOf(error);
    if (column !== null) {
      // Arm 1: the caller's own `field` argument — the one column reference
      // this method put in the SELECT, read back exactly as it was passed.
      if (column === field) {
        return this.unresolvableDistinctColumnRefusal(object, column, error);
      }
      // Arm 2: not the listed field ⇒ a predicate named it (the caller's
      // `filters`, or the tenant-scope wall this method applied above).
      return this.unresolvableFilterColumnRefusal(object, error, filters);
    }
    // Arm 3: recognised class, no parsed name — fall through to the terminal.
  }
  // [#8931] The terminal catch-all — see {@link SqlDriver.backendStatementFault}.
  return this.backendStatementFault(object, error);
}

/** The body of `SqlDriver#unresolvableDistinctColumnRefusal`; the method's docblock there is its contract. */
export function unresolvableDistinctColumnRefusal(this: Pick<ReadExitFaultHost, 'logger'>, object: string, column: string, error: unknown): Error {
  const detail = (error as { message?: unknown } | null | undefined)?.message;
  // The withholding rule is #7929's and this door's arm is commit 9ccc4179e's — ids kept
  // in the comment, never in the emitted string: a log line reaches operators
  // and generated surfaces, where `#NNNN` resolves against nothing
  // (`pnpm check:doc-authoring`).
  this.logger.warn(
    `[sql-driver] INVALID_FIELD — the listed distinct column could not be resolved on ` +
      `'${object}' ('${column}'). The dialect diagnostic, with the statement and its bound ` +
      'literals cut: ' +
      redactStatementFromMessage(typeof detail === 'string' ? detail : String(error), OWN_STATEMENT_FAULT),
  );
  const err = new Error(
    `This query lists the distinct values of '${column}', a column that object '${object}' ` +
      'has no column for, so the read never ran. Listing the values of a field that does not ' +
      'exist can only answer an empty list, so the query was refused instead of answered with ' +
      "one. Check the name against the object's fields; if the field was declared recently, " +
      'run schema sync so the column exists before listing its values.',
  ) as Error & { code?: string; status?: number; field?: string; object?: string };
  err.code = StandardErrorCode.enum.INVALID_FIELD;
  err.status = 400;
  err.field = column;
  err.object = object;
  return err;
}
