// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one shape a datasource-admin refusal takes: a short `message`, the reason
 * a client branches on, and the rationale beside it.
 *
 * ## Why a refusal carries three parts
 *
 * Every refusal of the `datasource-admin` service answers `400
 * DATASOURCE_ADMIN_ERROR` (ADR-0112: the code attributes the refusal to the
 * service, so it does not move). Before this helper the code was all a client
 * could read, and the reason lived in a `message` of up to 1,300 characters:
 * the rule, its history and the remedy in one string, which a toast cannot
 * show and a client cannot branch on.
 *
 * So the refusal is split by audience, the shape the bound-object refusal
 * already had:
 *
 *  - `message`: one line that names what was refused (the datasource and the
 *    key), short enough to show as it is (`DATASOURCE_REFUSAL_MESSAGE_MAX`);
 *  - `details.reason`: the snake_case discriminator, one per condition
 *    ({@link DatasourceRefusalReason}), which a client branches on instead of
 *    matching prose;
 *  - `details.hint`: the rationale and the remedy, unchanged in substance from
 *    what `message` used to carry, present when there is more to say than the
 *    line does.
 *
 * Further `details` members carry what the reason is about, as data
 * (`count` and `objects` for `objects_bound`, `keys` for `undeclared_key`).
 *
 * ## The envelope is declared here, so the route relays it
 *
 * `code` and `status` are set on the thrown error so the admin routes'
 * `badRequest` recognises a refusal that declared its own envelope and relays
 * its `details`; both are required there, so an unrelated error carrying a
 * stray `details` keeps answering the bare message. The code stays the
 * service's registered one: a reason is a member of `details`, never a new
 * code.
 *
 * ⛔ Nothing here may carry a credential: every reason is judged on key names
 * or on what the platform owns, never on a submitted value, and neither the
 * line nor the hint echoes one.
 */

/** The longest `message` a datasource refusal answers; the rest goes to `details.hint`. */
export const DATASOURCE_REFUSAL_MESSAGE_MAX = 160;

/**
 * Every condition a `datasource-admin` door refuses, as `details.reason`.
 * snake_case, like the other `details.reason` values of the ADR-0112
 * envelope.
 */
export type DatasourceRefusalReason =
  /** The name does not match the datasource name pattern. */
  | 'invalid_name'
  /** The name is the host's primary datasource, or a literal route of the admin API. */
  | 'reserved_name'
  /** A runtime datasource of this name exists. */
  | 'already_exists'
  /** The datasource is defined in code: it cannot be created over, edited or removed at runtime. */
  | 'code_defined'
  /** No `driver` was sent. */
  | 'driver_required'
  /** `config` fails the driver's own config schema. */
  | 'invalid_config'
  /** The record as it would be stored fails `DatasourceSchema`. */
  | 'invalid_record'
  /** The body carries a top-level key `DatasourceSchema` does not declare. */
  | 'undeclared_key'
  /** The `secret` is empty or blank. */
  | 'empty_secret'
  /** A create names `external.credentialsRef`. */
  | 'credentials_ref_on_create'
  /** The body carries `ssl.key`, a TLS client private key. */
  | 'inline_ssl_key'
  /** A `pool` block, or a key of one, the driver does not read. */
  | 'pool_unsupported'
  /** The datasource is managed while objects bind it with `external`. */
  | 'external_binding_conflict'
  /** `external.connector` names a connector instance that lends no credential. */
  | 'connector_not_lendable'
  /** Objects are still bound to the datasource being removed. */
  | 'objects_bound';

/** A refusal before it is thrown: what {@link datasourceAdminRefusal} builds from. */
export interface DatasourceRefusalParts {
  reason: DatasourceRefusalReason;
  /** One line naming what was refused, at most {@link DATASOURCE_REFUSAL_MESSAGE_MAX} characters. */
  message: string;
  /** The rationale and the remedy, when the line does not carry them. */
  hint?: string;
  /** Further `details` members: the facts the reason is about. */
  extra?: Record<string, unknown>;
}

/** The thrown form: an `Error` carrying the envelope the admin routes relay. */
export type DatasourceRefusalError = Error & {
  code: 'DATASOURCE_ADMIN_ERROR';
  status: 400;
  details: { reason: DatasourceRefusalReason; hint?: string } & Record<string, unknown>;
};

/** The `datasource-admin` service's refusal of `parts`, ready to throw (a `400` at the route). */
export function datasourceAdminRefusal(parts: DatasourceRefusalParts): DatasourceRefusalError {
  const err = new Error(parts.message) as DatasourceRefusalError;
  err.code = 'DATASOURCE_ADMIN_ERROR';
  err.status = 400;
  err.details = {
    reason: parts.reason,
    ...(parts.extra ?? {}),
    ...(parts.hint ? { hint: parts.hint } : {}),
  };
  return err;
}

/**
 * The single string a door that answers no envelope serves for `parts`: the
 * line, then the hint. Used where a refusal is reported as text rather than
 * thrown (the connection test's `{ ok: false, error }`), so that answer keeps
 * the whole account it carried before.
 */
export function datasourceRefusalText(parts: Pick<DatasourceRefusalParts, 'message' | 'hint'>): string {
  return parts.hint ? `${parts.message}\n${parts.hint}` : parts.message;
}

/**
 * `heading` (`Invalid datasource 'x'.`) as the lead of a one-line refusal
 * (`Invalid datasource 'x': …`): the trailing full stop becomes a colon.
 */
export function refusalLead(heading: string): string {
  return heading.endsWith('.') ? `${heading.slice(0, -1)}:` : `${heading}:`;
}

/**
 * A refusal whose substance is a list of findings (schema issues, bound
 * objects): the line names the subject and, when it is the only one and fits,
 * the finding; otherwise how many there are. The hint lists every finding,
 * one per line, as the message used to.
 */
export function listedRefusal(
  reason: DatasourceRefusalReason,
  lead: string,
  findings: readonly string[],
  extra?: Record<string, unknown>,
): DatasourceRefusalParts {
  const single = findings.length === 1 ? `${lead}: ${findings[0]}` : undefined;
  const fits = single !== undefined && !single.includes('\n') && single.length <= DATASOURCE_REFUSAL_MESSAGE_MAX;
  return {
    reason,
    message: fits ? (single as string) : `${lead}: ${findings.length} issue(s) found.`,
    ...(fits ? {} : { hint: findings.join('\n') }),
    ...(extra ? { extra } : {}),
  };
}

/**
 * The text form of a thrown refusal ({@link datasourceRefusalText}) for a door
 * that reports refusals as text: the line and, when the refusal carries one,
 * its hint. Any other error answers its own message.
 */
export function thrownRefusalText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const hint = (err as { details?: { hint?: unknown } }).details?.hint;
  return typeof hint === 'string' ? datasourceRefusalText({ message: err.message, hint }) : err.message;
}

/**
 * Every condition an `external-datasource` door refuses, as `details.reason`:
 * the federation doors' half of {@link DatasourceRefusalReason}, under that
 * service's own registered code.
 */
export type ExternalDatasourceRefusalReason =
  /** The platform's primary datasource is never a federation source. */
  | 'primary_not_federated'
  /** A managed datasource (declared or by default) is not a federation source. */
  | 'not_federation_source'
  /** A schema filter is in force and the driver named no schema for some tables. */
  | 'schema_filter_unattributed'
  /** The draft door's body names no `table`. */
  | 'table_required';

/**
 * Give an `external-datasource` refusal its `details` (`reason`, then the
 * facts, then `hint`). The error keeps the `code` and `status` its throw site
 * stamped, so each site still spells its codes as literals.
 */
export function withRefusalDetails<E extends Error>(
  err: E,
  reason: ExternalDatasourceRefusalReason,
  hint?: string,
  extra?: Record<string, unknown>,
): E & { details: { reason: ExternalDatasourceRefusalReason; hint?: string } & Record<string, unknown> } {
  const out = err as E & { details: { reason: ExternalDatasourceRefusalReason; hint?: string } & Record<string, unknown> };
  out.details = { reason, ...(extra ?? {}), ...(hint ? { hint } : {}) };
  return out;
}
