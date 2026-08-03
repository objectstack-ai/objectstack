// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4700 — availability of the enterprise `@objectstack/organizations` package
 * (ADR-0081 D2), for the dogfood gates that can only run multi-org.
 *
 * ── The defect this replaces ─────────────────────────────────────────────────
 *
 * Two dogfood files each carried their own copy of:
 *
 *   const organizationsAvailable = await import('@objectstack/organizations')
 *     .then(() => true).catch(() => false);
 *   describe.skipIf(!organizationsAvailable)(...)
 *
 * Node ESM resolves a bare specifier against the IMPORTER's own realpath —
 * `packages/qa/dogfood`, inside the framework workspace — while the package is
 * cloud-private and lives in the host app's `node_modules`. The probe was
 * therefore **constant-false**: not "false because the package is absent", but
 * false by construction, in every environment, including the enterprise/cloud CI
 * whose comment claimed it "runs this". Two whole multi-org gates — the #1994
 * cross-tenant RLS proof and the attachments cross-tenant isolation block — had
 * never executed, and the suite was green the entire time. That is Prime
 * Directive #10's "declared ≠ enforced" in its test-suite form, and a constant-
 * false capability probe is strictly worse than no probe: it manufactures the
 * appearance of coverage.
 *
 * ── What replaces it ─────────────────────────────────────────────────────────
 *
 * 1. **Resolve like production does** — through the shared host-app resolver
 *    (`@objectstack/types/node`), the same one `objectstack serve` (cloud#1013)
 *    and `bootStack` use. The probe can now be true, which it previously could
 *    not.
 *
 * 2. **Make the skip falsifiable** — `OS_TEST_MULTI_ORG_ENABLED=1` declares that
 *    this run is *supposed* to have the package. Declared-and-missing is then a
 *    hard, loud failure instead of a silent skip, so the run that intends to
 *    exercise these gates can no longer pass by quietly not running them
 *    ("Absence must be loud"). Undeclared-and-missing still skips, but the
 *    warning names the switch, so the skip is discoverable rather than folklore.
 *
 * The honest state after this change, stated plainly: in the FRAMEWORK repo the
 * package genuinely is not installed, so these gates still skip here — that is
 * correct and unavoidable for a cloud-private package. What changed is that the
 * skip is now a fact about the environment rather than an artefact of the
 * resolver, and a cloud/enterprise run that ships the package will actually
 * execute the blocks (and will fail loudly if it thinks it ships the package but
 * does not).
 */

import { createHostImporter, createHostRequire } from '@objectstack/types/node';

/** The cloud-private enterprise package (ADR-0081 D2). */
export const ORGANIZATIONS_PKG = '@objectstack/organizations';

/**
 * Env switch declaring the enterprise package IS expected in this run.
 * `OS_TEST_*` per the Prime Directive #9 test/CI-only shape, `_ENABLED` because
 * it is a boolean opt-in.
 */
export const MULTI_ORG_ENV = 'OS_TEST_MULTI_ORG_ENABLED';

export interface OrganizationsProbe {
  available: boolean;
  /** Human-readable reason to log when unavailable. */
  reason?: string;
}

/**
 * Resolve the enterprise package the way the runtime does.
 *
 * @param hostRoot Root of the app under test (default: CWD, which is where the
 * dogfood suite runs and where a linked enterprise package would be declared).
 * @param declared Whether the run asserts the package is present; defaults to
 * reading {@link MULTI_ORG_ENV}. When true, absence THROWS instead of skipping.
 */
export async function probeOrganizations(
  hostRoot?: string,
  declared: boolean = process.env[MULTI_ORG_ENV] === '1',
): Promise<OrganizationsProbe> {
  const importFromHost = createHostImporter(createHostRequire(hostRoot));
  try {
    await importFromHost(ORGANIZATIONS_PKG);
    return { available: true };
  } catch (e) {
    const detail = (e as Error).message;
    if (declared) {
      throw new Error(
        `${MULTI_ORG_ENV}=1 declares that ${ORGANIZATIONS_PKG} (enterprise, ADR-0081 D2) is ` +
          `installed for this run, but it could not be resolved from ${hostRoot ?? process.cwd()}. ` +
          'Refusing to skip the multi-org dogfood gates silently: a run that believes it is ' +
          'exercising cross-tenant isolation and is not would report green over gates that ' +
          `never executed. Install/link ${ORGANIZATIONS_PKG} into the app under test, or unset ` +
          `${MULTI_ORG_ENV} to accept the skip. (${detail})`,
      );
    }
    return {
      available: false,
      reason:
        `${ORGANIZATIONS_PKG} (enterprise) is not resolvable from ${hostRoot ?? process.cwd()} — ` +
        `skipping the multi-org gate. Set ${MULTI_ORG_ENV}=1 in a run that ships the package to ` +
        'turn this skip into a failure. ' +
        `(${detail})`,
    };
  }
}

/**
 * Module-level verdict shared by the multi-org dogfood files. Throws at import
 * time when {@link MULTI_ORG_ENV} is declared but the package is missing — the
 * loud half of the contract.
 */
const probe = await probeOrganizations();

export const organizationsAvailable: boolean = probe.available;

/** Log the skip once, naming the switch that makes it fail instead. */
export function warnIfUnavailable(gate: string): void {
  if (probe.available) return;
  // eslint-disable-next-line no-console
  console.warn(`[dogfood] ${gate}: ${probe.reason}`);
}
