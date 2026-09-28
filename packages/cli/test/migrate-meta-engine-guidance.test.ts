// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta` — the guidance it prints for the ADR-0087 semantic entries
 * of the COVERED families (`engine-*`, `ui-*`, `plugin-*`, `driver-*`,
 * `kernel-*`, `system-*`, `datasource-*`, `filter-*`, `action-*`, `data-*`,
 * `element-*`, `field-*`, `export-*`, `api-*`, `dataset-*`, `hook-*`,
 * `metadata-*`) states each lesson in words and carries no tracker number.
 *
 * ## What this pins
 *
 * Every semantic entry the replayed chain crosses is printed to the author as
 * one block — `⚠ [protocol N] <surface> → <replacement>`, then `why:` (the
 * entry's `reason`) and `verify:` (its `acceptanceCriteria`). That is text an
 * author is shown, so it carries no tracker number: a number sends the reader
 * to a page that can be deleted (some cited pages already had been), and the
 * lesson the entry exists to teach then sits behind a dead link instead of in
 * the sentence being read. The covered families were rewritten, one staged
 * family at a time, to say what each cited ruling, measurement or fix decided;
 * ADR ids stay, because an ADR lives in this repository. The whole printed
 * block is held, so `surface` is held as well as the three prose fields.
 *
 * The chain reports every semantic entry of every hop it crosses, whatever the
 * stack authors, so the fixture only has to be a real stack the command loads;
 * it keeps the lookup and the virtual `formula` field the `engine-*` entries
 * are about. The CLI replays the chain from the support floor to the highest
 * major carrying a covered entry. Each covered block is then located VERBATIM
 * in what the terminal printed, and that printed block must hold no `#`
 * followed by four or five digits. The file keeps the name it was given when
 * `engine-*` was the only covered family.
 *
 * ## Why it cannot pass by reading nothing
 *
 * - The covered set is derived from the registry by id prefix, so an entry
 *   added later to a covered family is held to the same line on arrival — and
 *   the derived set must still contain every entry the rewrites covered, and
 *   every covered prefix must still select at least one entry, so an emptied
 *   prefix cannot turn every assertion below into a loop over nothing.
 * - Each block is asserted PRESENT in stdout before it is asserted clean, so a
 *   renderer change that stopped printing the prose fails here instead of
 *   passing on an absent string.
 * - The detector is exercised on both sides before it is trusted: it fires on
 *   a four- and a five-digit tracker id and stays dark on three or six digits
 *   and on an ADR id.
 *
 * ## Why a spawn, and why this file is QUEUE tier rather than `.e2e`
 *
 * The subject is the sentence a real terminal prints, which is assembled in the
 * command's human-output branch — above every seam an in-process test reaches.
 * So the CLI is spawned once and the one run is shared by every assertion. The
 * file deliberately does NOT carry the `.e2e` name: that name selects the
 * nightly population (`vitest-tiers.ts` → "The NIGHTLY tiers"), and a pin that
 * runs only nightly is not protected by the merge queue's required set. Queue
 * tier by name, `integration` by behaviour — the same combination
 * `migrate-meta-default-range.test.ts` records.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS_BY_MAJOR, MIGRATION_SUPPORT_FLOOR } from '@objectstack/spec';
import { childEnv } from './helpers/serve-process.js';

const execFileP = promisify(execFile);
const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** A tracker id as author-shown prose must not carry it: `#` and four or five digits. */
const TRACKER_ID = /#\d{4,5}\b/;

/** The families this pin holds, selected by entry-id prefix. */
const COVERED_PREFIXES = [
  'engine-', 'ui-', 'plugin-', 'driver-', 'kernel-', 'system-',
  'datasource-', 'filter-', 'action-', 'data-', 'element-',
  'field-', 'export-', 'api-', 'dataset-', 'hook-', 'metadata-',
];

/**
 * The entries rewritten when each family was brought to this line — the
 * anti-vacuity floor. A covered entry that carried no tracker id to begin with
 * is held by its prefix and needs no row here.
 */
const REWRITTEN = [
  'action-bulk-dispatch-contract-undeclared',
  'action-descriptor-is-async-retired',
  'action-descriptor-resume-authority-default-flip',
  'action-engine-facade-find-query-envelope',
  'action-session-roles-to-positions',
  'api-assembled-entry-split',
  'api-error-retry-after-unit-in-key',
  'api-runtime-config-durations-unit-in-key',
  'api-runtime-create-withdrawn',
  'data-driver-find-stream-retired',
  'data-driver-query-omit-object',
  'data-engine-batch-retired',
  'data-field-changed-event-retired',
  'data-file-value-duration-unit-in-key',
  'data-nosql-query-options-timeout-unit-in-key',
  'dataset-filter-nested-relation-equality-array-refused-at-save',
  'dataset-measure-aggregate-field-type-refused',
  'dataset-measure-selecting-aggregate-field-type-refused',
  'datasource-config-inline-credential-refused',
  'datasource-config-mongo-options-credential-refused',
  'datasource-config-placeholder-refused',
  'datasource-config-postgres-url-unparseable-refused',
  'datasource-config-url-query-credential-refused',
  'datasource-config-url-userinfo-refused',
  'datasource-credentialsref-mongo-composed-no-username-refused',
  'datasource-credentialsref-mongo-url-no-user-refused',
  'driver-aggregate-undeclared-key-aliases-removed',
  'driver-capabilities-inert-bits-removed',
  'driver-options-timeout-to-timeout-ms',
  'driver-sql-distinct-bare-filter-typed',
  'driver-sql-unresolvable-where-column-refused',
  'driver-sql-upsert-cross-row-identity-merge-refused',
  'driver-turso-config-local-path-wasm-retired',
  'element-data-source-and-object-block-filter-rule-array',
  'element-number-filter-rule-array',
  'element-record-picker-filter-rule-array',
  'engine-dotted-filter-refused',
  'engine-dotted-projection-refused',
  'engine-find-formula-filter-refused',
  'engine-find-formula-order-by-refused',
  'engine-update-upsert-retired',
  'export-axis-opt-in',
  'export-field-meta-constraints-retired',
  'export-job-family-retired',
  'field-currency-scale-refused',
  'field-max-length-malformed-or-misplaced-refused',
  'field-min-length-malformed-or-misplaced-refused',
  'field-multiple-non-capable-type-refused',
  'field-predicate-reference-traversal-refused',
  'field-runtime-create-withdrawn',
  'field-scale-precision-integer-refused',
  'filter-between-blank-endpoint-refused',
  'filter-between-field-reference-endpoint-refused',
  'filter-comparand-types-and-widget-nested-slots-refused-at-save',
  'filter-equality-array-comparand-refused',
  'filter-equality-array-comparand-refused-at-save',
  'filter-icontains-comparand-refused-at-parse',
  'filter-ne-array-comparand-refused',
  'filter-preset-ordering-comparand-refused',
  'filter-query-face-comparands-refused-at-save',
  'filter-regex-options-retired',
  'filter-text-operator-declared-type-refused',
  'hook-context-session-roles-retired',
  'hook-register-empty-object-target-refused',
  'hook-register-undispatched-lifecycle-event-refused',
  'kernel-compatibility-matrix-estimated-migration-time-unit-in-key',
  'kernel-context-preview-mode-retired',
  'kernel-event-bus-retention-unit-in-key',
  'kernel-health-check-and-hot-reload-durations-unit-in-key',
  'kernel-package-lifecycle-durations-unit-in-key',
  'kernel-plugin-health-report-durations-unit-in-key',
  'kernel-plugin-security-durations-unit-in-key',
  'kernel-runtime-config-timeout-unit-in-key',
  'kernel-startup-orchestrator-durations-unit-in-key',
  'metadata-customization-protocol-retired',
  'metadata-endpoints-switch-radius-repartitioned',
  'metadata-manager-config-cache-ttl-unit-in-key',
  'metadata-manager-config-inert-cache-keys-retired',
  'metadata-plugin-additional-types-retired',
  'plugin-activation-events-retired',
  'plugin-auto-restart-never-reinitialised',
  'plugin-manifest-contributes-dead-members-retired',
  'plugin-manifest-contributes-routes-retired',
  'plugin-manifest-dead-containers-retired',
  'plugin-manifest-kind-globs-retired',
  'plugin-manifest-loading-retired',
  'plugin-runtime-family-retired',
  'plugin-security-scan-result-surface-retired',
  'plugin-security-scanner-retired',
  'system-cache-durations-unit-in-key',
  'system-collaboration-durations-unit-in-key',
  'system-failover-health-check-interval-unit-in-key',
  'system-metrics-jsdoc-durations-unit-in-key',
  'system-metrics-window-durations-unit-in-key',
  'system-object-storage-durations-unit-in-key',
  'system-registry-config-durations-unit-in-key',
  'system-tracing-otel-exporter-durations-unit-in-key',
  'system-tracing-span-duration-unit-in-key',
  'system-worker-queue-rate-limit-duration-unit-in-key',
  'ui-cloud-connection-widgets-unknown-keys-refused',
  'ui-form-field-length-malformed-refused',
  'ui-form-field-precision-scale-integer-refused',
  'ui-form-view-predicate-features-root-refused',
  'ui-interaction-config-family-retired',
  'ui-list-view-groupbyfield-padded-refused',
  'ui-list-view-grouping-field-padded-refused',
  'ui-mcp-connect-agent-unknown-keys-refused',
  'ui-notification-action-embed-config-retired',
  'ui-object-grid-page-size-positive-integer-refused',
  'ui-react-list-view-binding-aliases-retired',
  'ui-record-blocks-unknown-keys-refused',
  'ui-reference-rail-unknown-keys-refused',
  'ui-widget-i18n-family-retired',
];

interface FamilyEntry {
  toMajor: number;
  id: string;
  surface: string;
  replacement: string;
  reason: string;
  acceptanceCriteria: string;
}

const FAMILY: FamilyEntry[] = Object.entries(MIGRATIONS_BY_MAJOR).flatMap(([major, step]) =>
  step.semantic
    .filter((s) => COVERED_PREFIXES.some((prefix) => s.id.startsWith(prefix)))
    .map((s) => ({ ...s, toMajor: Number(major) })),
);

/** The block the command prints for one semantic TODO, exactly as `meta.ts` lays it out. */
function printedBlock(e: FamilyEntry): string {
  return (
    `⚠ [protocol ${e.toMajor}] ${e.surface} → ${e.replacement}\n`
    + `        why:    ${e.reason}\n`
    + `        verify: ${e.acceptanceCriteria}`
  );
}

/**
 * A real stack for the command to load. It keeps the shapes the `engine-*`
 * entries are about — a relation a dotted path would follow, and a virtual
 * `formula` field no driver materialises a column for — though which blocks
 * print does not depend on it: every semantic entry of a crossed hop is
 * reported.
 */
const FAMILY_FIXTURE = `
export default {
  manifest: { id: 'com.example.engine-guidance-pin', name: 'Engine Guidance Pin', version: '1.0.0', type: 'app' },
  objects: [
    { name: 'pin_project', label: 'Project', fields: { name: { type: 'text', label: 'Name' } } },
    {
      name: 'pin_task',
      label: 'Task',
      fields: {
        title: { type: 'text', label: 'Title' },
        status: { type: 'text', label: 'Status' },
        project_id: { type: 'lookup', label: 'Project', reference: 'pin_project' },
        is_open: { type: 'formula', label: 'Open', expression: 'record.status == "open"' },
      },
    },
  ],
};
`;

let dir: string;
let stdout: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-migrate-meta-engine-guidance-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), FAMILY_FIXTURE);
  const toMajor = Math.max(...FAMILY.map((e) => e.toMajor));
  const run = await execFileP(
    TSX,
    [CLI, 'migrate', 'meta', '--from', String(MIGRATION_SUPPORT_FLOOR), '--to', String(toMajor)],
    { cwd: dir, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
  );
  stdout = run.stdout;
}, 120_000);

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('os migrate meta — the guidance of the covered families carries no tracker number', () => {
  it('the detector fires on a tracker id and stays dark on every other number shape', () => {
    expect(TRACKER_ID.test(`see #${'9'.repeat(4)}`)).toBe(true);
    expect(TRACKER_ID.test(`see #${'9'.repeat(5)}`)).toBe(true);
    expect(TRACKER_ID.test(`see #${'9'.repeat(3)}`)).toBe(false);
    expect(TRACKER_ID.test(`see #${'9'.repeat(6)}`)).toBe(false);
    expect(TRACKER_ID.test('ADR-0112')).toBe(false);
  });

  it('selects every covered family, including every entry the rewrites covered', () => {
    const ids = FAMILY.map((e) => e.id);
    for (const prefix of COVERED_PREFIXES) {
      expect(ids.some((id) => id.startsWith(prefix)), `no entry selected for ${prefix}`).toBe(true);
    }
    for (const id of REWRITTEN) expect(ids, `family lost ${id}`).toContain(id);
  });

  it('prints every covered block verbatim, and no printed block names a tracker id', () => {
    for (const e of FAMILY) {
      const block = printedBlock(e);
      expect(stdout.includes(block), `${e.id}: its block is not in the printed output`).toBe(true);
      expect(block.match(TRACKER_ID)?.[0], `${e.id}: the printed guidance cites a tracker id`)
        .toBeUndefined();
    }
  });
});
