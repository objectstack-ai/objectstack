// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The deployment notice: what a production deployment keeps on its own disk
 * because nobody set it, stated to ADMINISTRATORS (ruling A3, record
 * 6634240777).
 *
 * ## Why administrators, and why here
 *
 * `os start` in production mode boots on a SQLite file under its home and on
 * secrets it generates there, and the boot log says so — to whoever reads the
 * terminal. The administrator who owns the data signs in to the Console, and
 * may not be the person who deployed. So the same facts are served to them,
 * and the Console draws them as a standing notice on its home page and at the
 * top of Setup's System Overview, with the variables to hand to the deployer.
 *
 * The settings service serves it because it already owns every part the read
 * needs: the deployment-configuration door (verified caller, anonymous floor,
 * held-session gate, the `manage_platform_settings` capability every
 * infrastructure namespace is gated on), the data key whose file it reads, the
 * storage adapter setting, and the `config_change` row on the platform audit
 * ledger. ⛔ Never on the public auth config: the state names server paths and
 * is for administrators alone.
 *
 * ## The findings
 *
 * - `database_local_file` and `auth_secret_generated` — decided by `os start`,
 *   which resolved the database and generated the secret, and handed to this
 *   process on the CLI's internal channel {@link BOOT_FINDINGS_CHANNEL_ENV}
 *   (`packages/cli/src/commands/start.ts`). A boot that did not come through
 *   `os start` sets no channel and states neither.
 * - `data_key_file` — this package's own fact: no `OS_SECRET_KEY` (nor a usable
 *   dev key) answers, so the provider reads its key from a file on this
 *   server ({@link resolvePersistedKeyFile}).
 * - `file_storage_local` (lower severity) — the live `storage.adapter` setting
 *   is `local`, on a composition that mounts the storage service.
 * - `email_not_configured` (lower severity) — `IEmailService.isConfigured()`
 *   does not answer `true`: the deliverability signal the auth plugin's public
 *   `features.emailDelivery` reads too.
 *
 * Production mode only (`NODE_ENV=production`, the signal `os start` sets and
 * the data key's own posture reads): outside it the notice has nothing to say.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import { recordDeploymentConfigChange } from './config-change-audit.js';
import { resolvePersistedKeyFile } from './local-crypto-provider.js';
import type { SettingsContext } from './settings-service.types.js';

/**
 * The CLI's internal parent-to-child channel the two boot facts arrive on.
 * Written by `os start` (`INTERNAL_DEPLOYMENT_FINDINGS_ENV` in
 * `packages/cli/src/commands/start.ts`); spelled here rather than imported,
 * because this package publishes no constant for a channel the CLI owns. The
 * CLI's end-to-end pin reads the notice a real `os start` serves, so a rename
 * on one side reds there.
 */
const BOOT_FINDINGS_CHANNEL_ENV = 'OS_INTERNAL_DEPLOYMENT_FINDINGS';

/** The capability that reads the notice and hides it — the infrastructure namespaces' gate. */
export const DEPLOYMENT_NOTICE_CAPABILITY = 'manage_platform_settings';

/** One thing a production deployment keeps on its own disk, or cannot do, because nobody set it. */
export type DeploymentFindingId =
  | 'database_local_file'
  | 'auth_secret_generated'
  | 'data_key_file'
  | 'file_storage_local'
  | 'email_not_configured';

export interface DeploymentFinding {
  id: DeploymentFindingId;
  /** `high`: lost with the disk. `low`: works, but not the way a production deployment should. */
  severity: 'high' | 'low';
  /** The variable that removes the finding, when one does. */
  variable?: 'OS_DATABASE_URL' | 'OS_AUTH_SECRET' | 'OS_SECRET_KEY';
  /** The file on this server the finding is about, when there is one. */
  file?: string;
}

/** `GET /api/settings/deployment/notice`'s answer. */
export interface DeploymentNoticeState {
  /** Whether the deployment runs in production mode; outside it `findings` is always empty. */
  production: boolean;
  /** In display order: the three `high` findings first, then the two `low` ones. */
  findings: DeploymentFinding[];
  /**
   * The findings' ids joined with `+`, `''` when there are none. A hide names
   * the fingerprint it acknowledges, so a finding that appears later is not
   * hidden by an acknowledgement of the earlier set.
   */
  fingerprint: string;
}

/** Where the notice reads its live facts. Each is asked on every read; none is cached. */
export interface DeploymentNoticeSources {
  /** The process environment. */
  env: () => Record<string, string | undefined>;
  /** `IEmailService.isConfigured()`, or `undefined` when no email service is composed. */
  emailDeliveryLive: () => boolean | undefined;
  /** The live `storage.adapter` value, or `undefined` when no storage service is composed. */
  storageAdapter: () => Promise<string | undefined>;
}

interface BootFindings {
  databaseFile?: string;
  authSecretFile?: string | null;
}

/** Read the CLI's channel. A value that does not parse states nothing, rather than a guess. */
function readBootFindings(env: Record<string, string | undefined>): BootFindings {
  const raw = env[BOOT_FINDINGS_CHANNEL_ENV];
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const p = parsed as Record<string, unknown>;
    return {
      ...(typeof p.databaseFile === 'string' ? { databaseFile: p.databaseFile } : {}),
      ...(typeof p.authSecretFile === 'string' || p.authSecretFile === null
        ? { authSecretFile: p.authSecretFile as string | null }
        : {}),
    };
  } catch {
    return {};
  }
}

/** The notice as it stands now. */
export async function readDeploymentNotice(sources: DeploymentNoticeSources): Promise<DeploymentNoticeState> {
  const env = sources.env();
  const production = env.NODE_ENV === 'production';
  if (!production) return { production, findings: [], fingerprint: '' };

  const findings: DeploymentFinding[] = [];
  const boot = readBootFindings(env);
  if (boot.databaseFile !== undefined) {
    findings.push({ id: 'database_local_file', severity: 'high', variable: 'OS_DATABASE_URL', file: boot.databaseFile });
  }
  if (boot.authSecretFile !== undefined) {
    findings.push({
      id: 'auth_secret_generated',
      severity: 'high',
      variable: 'OS_AUTH_SECRET',
      ...(boot.authSecretFile ? { file: boot.authSecretFile } : {}),
    });
  }
  const keyFile = resolvePersistedKeyFile({ env });
  if (keyFile) {
    findings.push({ id: 'data_key_file', severity: 'high', variable: 'OS_SECRET_KEY', file: keyFile.path });
  }
  if ((await sources.storageAdapter()) === 'local') {
    findings.push({ id: 'file_storage_local', severity: 'low' });
  }
  if (sources.emailDeliveryLive() !== true) {
    findings.push({ id: 'email_not_configured', severity: 'low' });
  }
  return { production, findings, fingerprint: findings.map((f) => f.id).join('+') };
}

/** What a hide asked of the door came to. */
export type DeploymentNoticeHideOutcome =
  /** The row is on the audit ledger; `state` is what was acknowledged. */
  | { outcome: 'recorded'; state: DeploymentNoticeState }
  /** There is nothing to hide: the notice states no finding. */
  | { outcome: 'nothing-to-hide'; state: DeploymentNoticeState }
  /** The notice no longer has the fingerprint the caller read. */
  | { outcome: 'changed'; state: DeploymentNoticeState }
  /** No audit ledger is mounted, so the hide cannot be recorded and is not made. */
  | { outcome: 'no-ledger' };

/**
 * What the deployment notice's two routes call (`registerSettingsRoutes`),
 * once per request, with the caller's verified context. The routes refuse a
 * caller without {@link DEPLOYMENT_NOTICE_CAPABILITY} before the door is asked.
 */
export interface DeploymentNoticeDoor {
  /** The notice as it stands now. */
  read(context: SettingsContext): Promise<DeploymentNoticeState>;
  /**
   * Hide the notice whose fingerprint the caller read: record it on the
   * platform audit ledger, by `context.userId`. A failed write throws.
   */
  hide(input: { context: SettingsContext; fingerprint: string }): Promise<DeploymentNoticeHideOutcome>;
}

/**
 * The `sys_audit_log` row a hide writes: a deployment-level `config_change`
 * (no organization, no record), by the administrator, naming the findings
 * they acknowledged. The Console keeps the hide in the administrator's own
 * browser, keyed by the fingerprint; this row is the record that they did.
 */
export function deploymentNoticeHideRow(input: { userId: string; state: DeploymentNoticeState }): Record<string, unknown> {
  const findings = input.state.findings.map((f) => f.id);
  return {
    user_id: input.userId,
    actor: input.userId,
    object_name: null,
    record_id: null,
    tenant_id: null,
    new_value: JSON.stringify({ hidden: true, fingerprint: input.state.fingerprint, findings }),
    metadata: JSON.stringify({ event: 'deployment_notice.hide', fingerprint: input.state.fingerprint, findings }),
  };
}

/** The door `SettingsServicePlugin` hands the routes. */
export function buildDeploymentNoticeDoor(deps: {
  sources: DeploymentNoticeSources;
  /** The data engine, read at the hide; `null` when the composition has none. */
  engine: () => IDataEngine | null;
}): DeploymentNoticeDoor {
  return {
    read: () => readDeploymentNotice(deps.sources),
    async hide({ context, fingerprint }) {
      const state = await readDeploymentNotice(deps.sources);
      if (state.findings.length === 0) return { outcome: 'nothing-to-hide', state };
      if (state.fingerprint !== fingerprint) return { outcome: 'changed', state };
      const engine = deps.engine();
      // The routes admit no caller without a principal, so `userId` is set.
      const recorded = engine
        ? await recordDeploymentConfigChange(engine, deploymentNoticeHideRow({ userId: context.userId!, state }))
        : 'no-ledger';
      return recorded === 'recorded' ? { outcome: 'recorded', state } : { outcome: 'no-ledger' };
    },
  };
}
