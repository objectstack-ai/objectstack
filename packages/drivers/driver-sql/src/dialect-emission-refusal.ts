// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The DDL-emission scope boundary, said out loud (#11991, landing the #11756
 * ruling).
 *
 * ## The ruling this implements
 *
 * Maintainer, 2026-08-25, verbatim 「同意」 on 「C，但 pgnative 归入 Postgres
 * 家族」 (#11756, comment 5404884704). Three databases speak the Postgres wire
 * protocol without being the Postgres this driver emits DDL for. The ruling
 * split them:
 *
 *   - `pgnative` — the same knex dialect and the same query compiler as `pg`,
 *     differing only in which npm binding carries the bytes. It JOINS the
 *     Postgres family for emission.
 *   - `redshift` / `cockroachdb` — wire recognition stays (connection and
 *     result parsing, #11389, deliberate); emission identity is refused. A
 *     configuration of theirs that reaches the DDL path is told so, by name,
 *     at once.
 *
 * ## Why a refusal rather than "just emit Postgres and see"
 *
 * Because the alternative fails silently and late. Measured on the pinned knex
 * (#11991), one `CREATE TABLE` compiled by each client:
 *
 * ```
 * pg / pgnative   "body" text            primary key inline in the CREATE
 * redshift        "body" varchar(max)    primary key in a separate ALTER TABLE
 * ```
 *
 * Emitting Postgres DDL at a Redshift therefore does not throw — it builds a
 * table of a different shape, and the deployment finds out when it writes data
 * into it. That is the failure this refusal exists to convert into a sentence
 * an operator reads at boot, on the axis the ruling weighed most: an author
 * whose configuration is wrong should be told at the moment they get it wrong.
 *
 * ## Why the platform still connects
 *
 * The boundary is drawn where behaviour was actually verified — wire yes,
 * emission no — rather than at the package boundary. Connection, the connect
 * bound and the #11389 calendar-day parser all still apply, so a deployment
 * that manages its schema out-of-band (`skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1`,
 * the documented posture after running migrations manually) keeps working on
 * these databases. That escape hatch is named in the message, because a refusal
 * that does not say what to do instead is only half of "loud".
 *
 * ## Reopening
 *
 * Recorded on #11756: no customer is known on either database, and evidence of
 * a real one reopens this toward recognition — starting with a MEASURED DDL
 * difference and the two databases judged separately (CockroachDB's Postgres
 * compatibility is visibly higher: knex already compiles it with the
 * `postgresql` dialect, where `redshift` has a dialect of its own).
 */

/**
 * ADR-0112 D3 extension code, registered by `@objectstack/driver-sql` in
 * `ERROR_CODE_LEDGER`.
 *
 * Registered rather than parked as a driver-local string because this refusal
 * IS wire-reachable: publishing a drafted object calls `engine.syncObjectSchema`
 * → `SqlDriver.syncSchema` → the DDL gate, on a server that is already serving
 * HTTP. That is the test the ledger applies (the class `MONGODB_MULTI_TENANT_UNSUPPORTED`
 * was UNregistered for failing — a boot refusal the CLI rethrows pre-HTTP, which
 * no response envelope could ever carry). This one can be carried, so it is
 * registered and the door serves it under its own name instead of demoting it
 * to `declaredCode` behind a 500.
 *
 * No standard-catalog member covers the condition: `NOT_IMPLEMENTED` says "not
 * yet", and the whole content of the ruling is that this is a decided, stated
 * boundary rather than an unfinished one.
 */
export const DIALECT_EMISSION_UNSUPPORTED_CODE = 'SQL_DIALECT_EMISSION_UNSUPPORTED';

/**
 * 501 — the status `HttpStatusErrorCodeMap` already names for "this server does
 * not do that". Deliberately not 400 (the caller's request is well-formed and
 * would succeed unchanged on a supported database) and not 500 (nothing
 * faulted; the driver declined on purpose and said why).
 */
export const DIALECT_EMISSION_UNSUPPORTED_STATUS = 501;

/**
 * Thrown by `SqlDriver.assertDialectEmits` when a knex client this driver
 * recognises on the wire — and only those — reaches the DDL path.
 *
 * The structured fields are the reason this is a class and not a bare `Error`:
 * a host that wants to render its own message (Studio, the CLI's migrate
 * plan, an installer) reads `client` and `supportedClients` instead of parsing
 * the sentence back out of `message`.
 */
export class UnsupportedDialectEmissionError extends Error {
  readonly code = DIALECT_EMISSION_UNSUPPORTED_CODE;
  readonly status = DIALECT_EMISSION_UNSUPPORTED_STATUS;

  constructor(
    /** The knex `client` spelling as configured. */
    readonly client: string,
    /** The DDL operation that was refused, e.g. `initObjects`. */
    readonly operation: string,
    /** Every client spelling this driver DOES emit DDL for, sorted. */
    readonly supportedClients: readonly string[],
  ) {
    super(renderDialectEmissionRefusal(client, operation, supportedClients));
    this.name = 'UnsupportedDialectEmissionError';
  }
}

/**
 * The refusal's prose, rendered from the driver's own tables.
 *
 * Exported so the pin suite asserts the SAME renderer the driver throws through
 * — a message pinned by copying its text into a test is a pin on the test.
 *
 * Three things it must carry, in this order, because that is the order an
 * operator needs them: what was refused and why, what IS supported, and what to
 * do to keep this database.
 */
export function renderDialectEmissionRefusal(
  client: string,
  operation: string,
  supportedClients: readonly string[],
): string {
  return (
    `DDL operation '${operation}' was refused: knex client '${client}' speaks the PostgreSQL wire ` +
    `protocol, but ObjectStack does not emit schema DDL for it, so no table was created or altered. ` +
    `Emitting PostgreSQL DDL there would not fail loudly — it would build a table of the wrong shape, ` +
    `and the deployment would find out when it writes data into it. ` +
    `Supported clients for schema emission: ${supportedClients.join(', ')}. ` +
    `To keep using this database, manage its schema out-of-band and boot with ` +
    `\`skipSchemaSync\` / OS_SKIP_SCHEMA_SYNC=1 — connection, the connect bound and result parsing ` +
    `are unaffected by this refusal.`
  );
}
