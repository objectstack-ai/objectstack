// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The delivery of a boot upgrade report (ADR-0126 §6): who is told, and through
 * which channel, once a report has a finding set to raise. The access upgrade
 * report (`access-upgrade-report.ts`) hands its findings here; so can any
 * other boot report whose findings are deployment-level.
 *
 * ## Under `single`
 *
 * Through the existing notification ingress (`messaging.emit()`, ADR-0030: a
 * `sys_notification` event in Setup's Notification Events, and the in-app
 * inbox), stamped with the Default Organization, to its `admin_full_access`
 * holders and any `OS_PLATFORM_OWNER_EMAIL` address. The notification's
 * `dedupKey` is the finding set's digest, so an unchanged set notifies once,
 * not once per boot. No messaging service, nobody to tell, or a refused emit:
 * one log line says so, with the fix for that cause.
 *
 * ## Under a wall (`group`, `isolated`)
 *
 * The findings are deployment-level, and only the operator can act on them.
 * One `error` line addressed to the operator is written, always. The
 * notification family is organization-scoped: a walled system write that names
 * no organization is refused (ADR-0131 D9), and stamping a tenant's
 * organization would hand the findings to that tenant. So:
 *
 *  - **`OS_PLATFORM_OWNER_ORGANIZATION` unset:** the operator line only. No
 *    notification is attempted.
 *  - **Set** (#25413): the value is an organization id, else a slug, read from
 *    `sys_organization` at this boot. The same notification (same topic, same
 *    `dedupKey`) is emitted, stamped with that organization and addressed to
 *    the configured operators. The operator line stays beside it. No other
 *    organization is told.
 *  - **Set, naming no organization:** one `error` naming the value and the
 *    fix, and the operator line. It never falls back to another organization.
 *  - **A configured operator who is not a member of it**, or who has no
 *    verified account: a `warn` that the in-app copy will not be visible to
 *    them.
 *  - **An administrator of it who is not a configured operator:** a `warn`. The
 *    organization must hold operators only. Any administrator of it can read
 *    the event in Setup, Diagnostics, Notification Events, and the findings can
 *    name other organizations' ids and rule names. "Administrator" here is an
 *    `owner`/`admin` membership grade, or an `admin_full_access` or
 *    organization-admin grant scoped to it. Both are read with two `find`s,
 *    the same two that answer the membership check. A set authored to read
 *    `sys_notification` some other way is not read.
 *
 * ## Never throws
 *
 * A read or a delivery that did not happen is said in the log with its cause.
 * The caller's report has already been logged in full by then.
 */

import {
  readDefaultOrganizationId,
  resolvePlatformAdminEmails,
  type PlatformAdminEmailConfig,
} from '@objectstack/core';
import { ORGANIZATION_ADMIN, ORGANIZATION_ADMIN_NO_BYPASS } from '@objectstack/spec';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { PLATFORM_OWNER_ORGANIZATION_ENV, resolvePlatformOwnerOrganization } from '@objectstack/types';
import { isAdminRole } from './auto-org-admin-grant.js';
import { GRANT_OBJECT, GRANT_SET_NAME_FIELD } from './grant-permission-set-name.js';
import { resolvePlatformAdminStanding } from './platform-admin-service.js';

const ORGANIZATION_OBJECT = 'sys_organization';
const MEMBER_OBJECT = 'sys_member';
const SYSTEM_CTX = { isSystem: true } as const;

/** The grants that make their holder an administrator of the organization they are scoped to. */
const ADMINISTRATOR_SETS: ReadonlySet<string> = new Set([ADMIN_FULL_ACCESS, ORGANIZATION_ADMIN, ORGANIZATION_ADMIN_NO_BYPASS]);

/** The engine surface the delivery reads through — ObjectQL satisfies it as it stands. */
export interface UpgradeReportEngine {
  getObject(name: string): unknown;
  find(object: string, options: Record<string, unknown>): Promise<unknown>;
}

/** The kernel logger, as the delivery uses it. */
export interface UpgradeReportLogger {
  info?: (message: string, meta?: Record<string, any>) => void;
  warn: (message: string, meta?: Record<string, any>) => void;
  error?: (message: string, cause?: Error, meta?: Record<string, any>) => void;
}

/** The notification ingress, as the delivery uses it — service-messaging's `emit`. */
export interface UpgradeReportNotifier {
  emit(input: {
    topic: string;
    audience: readonly string[];
    severity: 'warning';
    dedupKey: string;
    organizationId?: string;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface UpgradeReportDeliveryDeps {
  logger?: UpgradeReportLogger;
  /** The `messaging` service; absent when the composition has none. */
  messaging?: UpgradeReportNotifier;
  /** `true` under `group` / `isolated`. */
  walled: boolean;
}

/** One report's finding set, as the delivery raises it. */
export interface UpgradeReportNotice {
  /** The notification topic, e.g. `security.access_upgrade`. */
  topic: string;
  /** The finding set's digest: the notification's `dedupKey`, and the field the log lines carry. */
  findingSet: string;
  /** What the log lines call the findings, e.g. `the access upgrade findings above`. */
  subject: string;
  /**
   * Why only the operator can act on them, completing "<subject> are
   * deployment-level — ": one sentence ending in a full stop.
   */
  operatorReason: string;
  /** The notification's payload: its title and body, and the report's own data. */
  payload: { title: string; body: string } & Record<string, unknown>;
}

/** What the delivery did with a finding set. */
export interface UpgradeReportDelivery {
  /**
   * `notified`: handed to the ingress (`single`, or walled with the owner
   * organization set). `operator-log`: walled, and the operator's line in this
   * log is the only channel. `undelivered`: `single` findings that reached no
   * administrator, said in the log with the cause.
   */
  outcome: 'notified' | 'operator-log' | 'undelivered';
  recipients: string[];
  findingSet: string;
  /** The organization the notification was stamped with, when one was. */
  organizationId?: string;
  reason?: string;
}

/** Who a `single` delivery is addressed to, and the organization it is stamped with. */
export interface UpgradeReportAudience {
  recipients: string[];
  organizationId?: string;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function idOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
}

function logError(logger: UpgradeReportLogger | undefined, message: string, meta: Record<string, unknown>): void {
  if (logger?.error) logger.error(message, undefined, meta);
  else logger?.warn(message, meta);
}

/**
 * The people who can act on a deployment-level finding under `single`: any
 * configured platform operator and every holder of the Default Organization's
 * `admin_full_access` grant. A read that throws propagates.
 */
export async function resolveUpgradeReportAudience(engine: UpgradeReportEngine): Promise<UpgradeReportAudience> {
  const recipients = [...resolvePlatformAdminEmails().emails];
  const organizationId = await readDefaultOrganizationId(engine);
  if (organizationId === undefined || !engine.getObject(GRANT_OBJECT)) return { recipients };
  const grants = await engine.find(GRANT_OBJECT, {
    where: { [GRANT_SET_NAME_FIELD]: ADMIN_FULL_ACCESS, organization_id: organizationId },
    fields: ['user_id'],
    limit: 10000,
    context: SYSTEM_CTX,
  });
  for (const row of rowsOf(grants)) {
    const userId = idOf(row.user_id);
    if (userId !== undefined && !recipients.includes(userId)) recipients.push(userId);
  }
  return { recipients, organizationId };
}

/**
 * The organization `OS_PLATFORM_OWNER_ORGANIZATION` names: by id first, then by
 * slug. `undefined` when neither matches, or when this composition has no
 * `sys_organization`. A read that throws propagates.
 */
export async function resolvePlatformOwnerOrganizationId(
  engine: UpgradeReportEngine,
  value: string,
): Promise<string | undefined> {
  if (!engine.getObject(ORGANIZATION_OBJECT)) return undefined;
  for (const field of ['id', 'slug'] as const) {
    const rows = rowsOf(await engine.find(ORGANIZATION_OBJECT, {
      where: { [field]: value },
      fields: ['id'],
      limit: 1,
      context: SYSTEM_CTX,
    }));
    const id = idOf(rows[0]?.id);
    if (id !== undefined) return id;
  }
  return undefined;
}

/** A configured operator the in-app copy will not be visible to, and why. */
export interface UnreachedOperator {
  email: string;
  state: 'no-account' | 'unverified' | 'not-member';
}

/** What the boot reads of the owner organization's people, for the two warnings. */
export interface OwnerOrganizationAudit {
  unreachedOperators: UnreachedOperator[];
  /** User ids of the organization's administrators who are not configured operators. */
  nonOperatorAdministrators: string[];
}

/**
 * Read the owner organization's members and admin grants against the
 * configured operators. The operator half reads `sys_user` the way the
 * platform-admin standing does (both spellings, the config's normalization);
 * an operator counts as reached when a verified account of theirs is a member.
 * A read that throws propagates.
 */
export async function auditOwnerOrganization(
  engine: UpgradeReportEngine,
  organizationId: string,
  config: PlatformAdminEmailConfig,
): Promise<OwnerOrganizationAudit> {
  const members = engine.getObject(MEMBER_OBJECT)
    ? rowsOf(await engine.find(MEMBER_OBJECT, {
      where: { organization_id: organizationId },
      fields: ['user_id', 'role'],
      limit: 10000,
      context: SYSTEM_CTX,
    }))
    : [];
  const grants = engine.getObject(GRANT_OBJECT)
    ? rowsOf(await engine.find(GRANT_OBJECT, {
      where: { organization_id: organizationId },
      fields: ['user_id', GRANT_SET_NAME_FIELD],
      limit: 10000,
      context: SYSTEM_CTX,
    }))
    : [];
  const memberIds = new Set(members.map((m) => idOf(m.user_id)).filter((id): id is string => id !== undefined));

  const operatorIds = new Set<string>();
  const unreachedOperators: UnreachedOperator[] = [];
  for (const entry of await resolvePlatformAdminStanding(engine, config)) {
    if (entry.userId !== undefined) operatorIds.add(entry.userId);
    const state: UnreachedOperator['state'] | undefined = !entry.registered
      ? 'no-account'
      : !entry.verified || entry.userId === undefined
        ? 'unverified'
        : memberIds.has(entry.userId) ? undefined : 'not-member';
    if (state !== undefined) unreachedOperators.push({ email: entry.email, state });
  }

  const administrators = new Set<string>();
  for (const m of members) {
    const userId = idOf(m.user_id);
    if (userId !== undefined && isAdminRole(m.role)) administrators.add(userId);
  }
  for (const g of grants) {
    const userId = idOf(g.user_id);
    const set = g[GRANT_SET_NAME_FIELD];
    if (userId !== undefined && typeof set === 'string' && ADMINISTRATOR_SETS.has(set)) administrators.add(userId);
  }
  const nonOperatorAdministrators = [...administrators].filter((id) => !operatorIds.has(id)).sort();
  return { unreachedOperators, nonOperatorAdministrators };
}

/**
 * Raise a report's finding set to the people who can act on it (see the module
 * header for each posture). Never throws.
 */
export async function deliverUpgradeReport(
  engine: UpgradeReportEngine,
  deps: UpgradeReportDeliveryDeps,
  notice: UpgradeReportNotice,
): Promise<UpgradeReportDelivery> {
  return deps.walled ? deliverWalled(engine, deps, notice) : deliverSingle(engine, deps, notice);
}

async function deliverSingle(
  engine: UpgradeReportEngine,
  deps: UpgradeReportDeliveryDeps,
  notice: UpgradeReportNotice,
): Promise<UpgradeReportDelivery> {
  const { findingSet } = notice;
  const undelivered = (reason: string, fix: string, recipients: string[] = []): UpgradeReportDelivery => {
    logError(
      deps.logger,
      `[security] ${notice.subject} reached no administrator: ${reason}. They are in this log only. Fix: ${fix}`,
      { findingSet },
    );
    return { outcome: 'undelivered', recipients, findingSet, reason };
  };
  if (!deps.messaging || typeof deps.messaging.emit !== 'function') {
    return undelivered('this composition has no messaging service', 'compose the messaging service.');
  }

  let audience: UpgradeReportAudience;
  try {
    audience = await resolveUpgradeReportAudience(engine);
  } catch (e) {
    return undelivered(
      `the administrators could not be read (${errorText(e)})`,
      'restore the store the grants are read from; the next boot reads them again.',
    );
  }
  if (audience.recipients.length === 0) {
    return undelivered(
      'no administrator is configured or granted',
      'grant admin_full_access in the Default Organization, or set OS_PLATFORM_OWNER_EMAIL.',
    );
  }
  try {
    await deps.messaging.emit({
      topic: notice.topic,
      audience: audience.recipients,
      severity: 'warning',
      dedupKey: findingSet,
      ...(audience.organizationId !== undefined ? { organizationId: audience.organizationId } : {}),
      payload: notice.payload,
    });
  } catch (e) {
    return undelivered(
      `the notification ingress refused it (${errorText(e)})`,
      'repair the cause the ingress names; the next boot raises the same findings again.',
      audience.recipients,
    );
  }
  return {
    outcome: 'notified',
    recipients: audience.recipients,
    findingSet,
    ...(audience.organizationId !== undefined ? { organizationId: audience.organizationId } : {}),
  };
}

async function deliverWalled(
  engine: UpgradeReportEngine,
  deps: UpgradeReportDeliveryDeps,
  notice: UpgradeReportNotice,
): Promise<UpgradeReportDelivery> {
  const { findingSet } = notice;
  const config = resolvePlatformAdminEmails();
  const operators = [...config.emails];
  const noOperator = 'No operator is configured: set OS_PLATFORM_OWNER_EMAIL to name the platform operator.';
  const value = resolvePlatformOwnerOrganization();

  /** The line addressed to the operator — always written; its wording says whether a copy went in-app. */
  const operatorLine = (organizationId?: string): void => {
    logError(
      deps.logger,
      `[security] platform operator: ${notice.subject} are deployment-level — ${notice.operatorReason} ` +
        (organizationId === undefined
          ? 'This tenancy posture has no in-app channel for a deployment-level notification, so this log is where ' +
            'they are raised; no organization is told. '
          : `A copy is raised in-app in the organization ${PLATFORM_OWNER_ORGANIZATION_ENV} names, addressed to ` +
            'the configured operator(s); no other organization is told. ') +
        (operators.length > 0 ? 'The configured operator(s) are named in this line.' : noOperator),
      { findingSet, operators, ...(organizationId !== undefined ? { organizationId } : {}) },
    );
  };
  const logOnly = (reason?: string): UpgradeReportDelivery => {
    operatorLine();
    return { outcome: 'operator-log', recipients: operators, findingSet, ...(reason !== undefined ? { reason } : {}) };
  };
  /** The setting is set, but the in-app copy cannot go: one `error` with the cause and the fix, then the operator line. */
  const notRaisedInApp = (reason: string, fix: string): UpgradeReportDelivery => {
    logError(
      deps.logger,
      `[security] ${PLATFORM_OWNER_ORGANIZATION_ENV} is set, but ${notice.subject} are not raised in-app: ${reason}. ` +
        `The operator line below is the only channel for this boot. Fix: ${fix}`,
      { findingSet, value },
    );
    return logOnly(reason);
  };

  if (value === undefined) return logOnly();

  let organizationId: string | undefined;
  try {
    organizationId = await resolvePlatformOwnerOrganizationId(engine, value);
  } catch (e) {
    return notRaisedInApp(
      `the organizations could not be read (${errorText(e)})`,
      'restore the store sys_organization is read from; the next boot reads it again.',
    );
  }
  if (organizationId === undefined) {
    return notRaisedInApp(
      `"${value}" names no organization by id or by slug`,
      `set ${PLATFORM_OWNER_ORGANIZATION_ENV} to the id or slug of an existing organization that holds the ` +
        'platform operators only, or unset it.',
    );
  }
  if (!deps.messaging || typeof deps.messaging.emit !== 'function') {
    return notRaisedInApp('this composition has no messaging service', 'compose the messaging service.');
  }
  if (operators.length === 0) {
    return notRaisedInApp(
      'no operator is configured to address it to',
      'set OS_PLATFORM_OWNER_EMAIL to name the platform operator.',
    );
  }

  try {
    const audit = await auditOwnerOrganization(engine, organizationId, config);
    if (audit.unreachedOperators.length > 0) {
      deps.logger?.warn(
        `[security] ${audit.unreachedOperators.length} configured operator(s) are not verified members of the ` +
          `organization ${PLATFORM_OWNER_ORGANIZATION_ENV} names, so the in-app copy of ${notice.subject} will not ` +
          'be visible to them; the operator line in this log still reaches them. Fix: add each to that ' +
          `organization (and verify the account), or point ${PLATFORM_OWNER_ORGANIZATION_ENV} at an organization ` +
          'they belong to.',
        { organizationId, operators: audit.unreachedOperators },
      );
    }
    if (audit.nonOperatorAdministrators.length > 0) {
      deps.logger?.warn(
        `[security] ${audit.nonOperatorAdministrators.length} administrator(s) of the organization ` +
          `${PLATFORM_OWNER_ORGANIZATION_ENV} names are not configured operators, and every administrator of it ` +
          `can read the in-app copy of ${notice.subject} in Setup, Notification Events. The findings are ` +
          "deployment-level and can name other organizations' ids. Fix: keep that organization for the platform " +
          'operators only: remove the others, or name them in OS_PLATFORM_OWNER_EMAIL if they operate the platform.',
        { organizationId, administrators: audit.nonOperatorAdministrators },
      );
    }
  } catch (e) {
    deps.logger?.warn(
      `[security] the members of the organization ${PLATFORM_OWNER_ORGANIZATION_ENV} names could not be read ` +
        `(${errorText(e)}), so whether the operators can see the in-app copy, and whether anyone else can, is not ` +
        'checked at this boot.',
      { organizationId },
    );
  }

  try {
    await deps.messaging.emit({
      topic: notice.topic,
      audience: operators,
      severity: 'warning',
      dedupKey: findingSet,
      organizationId,
      payload: notice.payload,
    });
  } catch (e) {
    return notRaisedInApp(
      `the notification ingress refused it (${errorText(e)})`,
      'repair the cause the ingress names; the next boot raises the same findings again.',
    );
  }
  operatorLine(organizationId);
  return { outcome: 'notified', recipients: operators, findingSet, organizationId };
}
