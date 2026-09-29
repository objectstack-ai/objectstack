// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A forced local mode beside a remote to replicate from, refused at both doors
// together: the datasource contract (on mode) and the turso driver's
// constructor, in one message. The driver used to label it local and run it as
// an embedded replica anyway. The twin of
// turso-config-forced-replica-without-sync-url-refused, the other way round. A
// structured TODO, not a D2 conversion: whether the author meant an embedded
// replica of that remote or a plain local file is intent no artifact records.
export const entry: SemanticMigration = {
  id: 'turso-config-forced-local-with-sync-url-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'data.TursoConfig (a turso / libsql datasource.config) and the TursoDriver constructor of '
    + '@objectstack/driver-turso — mode local beside a non-empty syncUrl is now refused, on mode at '
    + 'authoring and at construction. The published TursoConfigSchema mirror of '
    + '@objectstack/driver-turso carries the same text for parity but declares no mode key and strips '
    + 'an authored one, so it cannot see a forced mode and still accepts the config as a replica',
  replacement:
    'the configuration the author meant. An embedded replica drops mode: keep the file: url and '
    + 'syncUrl, for example url file:./data/replica.db with syncUrl naming the remote, and the url '
    + 'and syncUrl select the replica. A plain local database drops syncUrl and sync: a file: url '
    + '(or :memory:) with no syncUrl is a local database, with or without mode local',
  reason:
    'A syncUrl names the remote an embedded replica syncs with, and the turso driver syncs whenever '
    + 'it is set on a local engine, whatever mode says. The triage ruling of 2026-09-29 weighed '
    + 'refusing this shape against honouring mode local by skipping the sync, and refused it: '
    + 'honouring it would ignore a declared syncUrl, the same defect with the keys swapped, and a '
    + 'loud contradiction is the author\'s to resolve. A forced mode local beside a syncUrl parsed '
    + 'clean at authoring, and the driver built it with a local transport label and then ran it as '
    + 'a replica: it synced on connect, started the sync interval and answered true to the '
    + 'sync-enabled check, exactly as the same config with no mode did (measured on the driver '
    + 'source). A declared mode the runtime ignores is the declared-but-not-enforced shape ADR-0049 '
    + 'does not ship, so the datasource contract and the constructor now refuse it together, with '
    + 'one message, which names both ways out. The sibling refusals keep their order: a forced '
    + 'local mode on a remote url or a bare path meets its url refusal first. An empty syncUrl is '
    + 'unset and is not refused. Stored datasource rows are not re-parsed when they load, so a '
    + 'stored row in this shape now fails when its driver is built: the connection service records '
    + 'it as failed-degraded, a test connection answers ok false, and under ADR-0062 D5 the boot '
    + 'fails fast when objects bind to that datasource, unless OS_ALLOW_DRIVER_CONNECT_FAILURE is '
    + 'set. Measured on this tree at the change: no example, template, published skill or '
    + 'hand-written doc authors the shape, and no host default or environment variable sets mode '
    + 'or syncUrl. ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Validate every stack and re-save every turso datasource: os validate or defineStack, and a '
    + 'save or test connection through the datasource admin service, report a forced local mode '
    + 'beside a syncUrl at config.mode with both ways out. Decide per datasource whether it is an '
    + 'embedded replica (drop mode) or a local file (drop syncUrl and sync). Done when every turso '
    + 'datasource parses, the driver builds from it, and no datasource that declares mode local '
    + 'carries a syncUrl.',
};
