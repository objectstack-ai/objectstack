// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0029 D7 / ADR-0130 — the diagnostic for a `navigationContributions[]`
 * entry whose `group` names no group in the target app (#14553).
 *
 * ## What the platform does, and why this file exists
 *
 * `SchemaRegistry.applyNavContributions` RELOCATES such a contribution to the
 * app's top level and carries on. That is deliberate and unchanged: the merge
 * is a read-time fold precisely so registration order does not matter
 * (`registerAppNavContribution` does not require the target app to exist yet),
 * and a contribution into an OPTIONAL group must keep working. Refusing would
 * trade both away — Option A of the card, not taken.
 *
 * What was wrong is that the relocation was INVISIBLE. The only trace was one
 * `this.log(...)` line gated at `info`/`debug`, so a deployment running at
 * `OS_REGISTRY_LOG=warn` — the level `OS_REGISTRY_LOG` exists to select, and
 * the level this package's own vitest config pins — saw nothing at all while
 * the information architecture silently changed underneath it. For a module
 * split (hotcrm's 17-node navigation conversion) that is the WORSE of the two
 * failures the card weighed: a dropped entry is missing and someone notices; a
 * relocated one is present, passes a smoke test, and sits one level up from
 * where its author put it. A typo'd group id is exactly what an AI author
 * emits, so the failure had to become visible without becoming a refusal.
 *
 * Maintainer ruling, 2026-09-02 (verbatim: 「同意」) — option B: keep the
 * relocation, make the trace a real diagnostic emitted at `warn`, and check the
 * same condition at COMPILE time when both halves are composed into one
 * artifact, where an AI author sees it first.
 *
 * ## One derivation, two halves — the reason this is a module and not two
 * ## call sites
 *
 * The runtime half (`SchemaRegistry.applyNavContributions`) and the
 * compile-time half (`os build`, `packages/cli/src/commands/compile.ts`) must
 * answer "does this group id resolve?" the SAME way. Two copies of the
 * predicate is the drift this card is about, one layer up: a build that says
 * "fine" over a fold that relocates is indistinguishable, to the author, from
 * the silence being fixed here. So {@link findNavGroup} is the single
 * resolution — the registry's own private lookup now delegates to it — and
 * {@link navContributionGroupDiagnostic} is the single message, formatted once
 * by {@link formatNavContributionGroupDiagnostic} so both doors print the same
 * line.
 *
 * ## Why the code is lowercase, and why no ledger entry
 *
 * ADR-0112 D6c, by name: "Diagnostics codes are not error codes." The ADR
 * classifies a record that travels as payload of a success, describes an
 * ARTIFACT rather than a request, carries a severity that can be `warning`, and
 * is never routed to `error.code` — all four true here — as a separate
 * vocabulary that "stays lowercase and out of the ledger". This entry is
 * shaped after the ADR-0038 `BuildIssue` family that D6c names first
 * (`{ severity, artifact, ref, code, message, fix }`,
 * `metadata-protocol/src/build-probes.ts`), which is also what lets one stream
 * carry the runtime and the build finding.
 *
 * ⛔ So: no `ERROR_CODE_LEDGER` registration and no `UNREGISTERED_CODE_SITES`
 * row. `check:dispatcher-error-vocabulary` delegates a lowercase literal in an
 * object-literal `code:` position to `check:error-code-casing`, which owns the
 * D6/D6b/D6c discrimination through its `EXEMPT_FILES` list — this file is
 * registered there with that reason, the same way `build-probes.ts` and
 * `metadata-diagnostics.ts` are.
 */

/**
 * The diagnostics code for a contribution relocated past a missing group.
 *
 * Exported so consumers branch on the constant instead of re-spelling the
 * literal — the D6c vocabulary is a contract even though it is not the error
 * catalog's.
 */
export const NAV_CONTRIBUTION_GROUP_MISSING = 'nav_contribution_group_missing';

/** One relocated-contribution finding (ADR-0038 BuildIssue family; ADR-0112 D6c). */
export interface NavContributionGroupDiagnostic {
  /** Always {@link NAV_CONTRIBUTION_GROUP_MISSING}. */
  readonly code: typeof NAV_CONTRIBUTION_GROUP_MISSING;
  /** Never `error`: the platform relocates and carries on — no refusal (option A not taken). */
  readonly severity: 'warning';
  /** The app whose navigation tree was changed. */
  readonly app: string;
  /** The contributing package, when the registration carried one. */
  readonly packageId?: string;
  /** The `group` id that resolved to no `type: 'group'` node in {@link app}. */
  readonly group: string;
  /** Ids of the items moved to the app's top level, in contribution order. */
  readonly relocated: readonly string[];
  readonly message: string;
  readonly fix: string;
}

/** The shape this module needs from an app — its name and its nav tree. */
export interface NavGroupHostApp {
  readonly name?: unknown;
  readonly navigation?: unknown;
}

/** The shape this module needs from one contribution. */
export interface NavGroupContribution {
  readonly app?: unknown;
  readonly group?: unknown;
  readonly items?: unknown;
  readonly packageId?: string;
}

/** How an item with no `id` is named in {@link NavContributionGroupDiagnostic.relocated}. */
const UNNAMED_ITEM = '(unnamed)';

/**
 * Depth-first search for a `type: 'group'` nav item by id.
 *
 * ⚠️ BOTH conditions, and the pair is load-bearing: an `object`-type nav item
 * that happens to share the id is not a container, so naming it is the same
 * authoring error as naming nothing and must reach the same diagnostic. The
 * registry's fold and `os build` call THIS function, so the two doors cannot
 * disagree about what "the group exists" means.
 */
export function findNavGroup(items: unknown, groupId: string): Record<string, unknown> | undefined {
  if (!Array.isArray(items)) return undefined;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    if (node.id === groupId && node.type === 'group') return node;
    const found = findNavGroup(node.children, groupId);
    if (found) return found;
  }
  return undefined;
}

/** The ids a contribution's items are reported under. */
function relocatedIds(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const id = (item as { id?: unknown } | null)?.id;
    return typeof id === 'string' && id !== '' ? id : UNNAMED_ITEM;
  });
}

/**
 * Build the diagnostic for one contribution already known to name a missing
 * group. Callers decide reachability (see {@link checkNavContributionGroups}
 * and the registry fold); this only words the finding.
 */
export function navContributionGroupDiagnostic(input: {
  app: string;
  group: string;
  packageId?: string;
  items?: unknown;
}): NavContributionGroupDiagnostic {
  const relocated = relocatedIds(input.items);
  const who = input.packageId ?? '(unknown package)';
  const what = relocated.length === 1 ? '1 navigation item' : `${relocated.length} navigation items`;
  return {
    code: NAV_CONTRIBUTION_GROUP_MISSING,
    severity: 'warning',
    app: input.app,
    ...(input.packageId === undefined ? {} : { packageId: input.packageId }),
    group: input.group,
    relocated,
    message:
      `Package "${who}" contributes ${what} [${relocated.join(', ')}] into group ` +
      `"${input.group}" of app "${input.app}", but that app declares no such group — ` +
      `the item(s) were RELOCATED to the app's top level. Nothing is lost and nothing ` +
      `is refused, but the app's information architecture is not the one that was authored.`,
    fix:
      `Correct the group id to one the app declares as a \`type: "group"\` navigation node, ` +
      `or declare "${input.group}" in app "${input.app}"'s own navigation.`,
  };
}

/** One line carrying the whole finding — the text both doors print. */
export function formatNavContributionGroupDiagnostic(d: NavContributionGroupDiagnostic): string {
  return `[Registry] [${d.code}] ${d.message} Fix: ${d.fix}`;
}

/**
 * The COMPILE-TIME half: every contribution in one composed artifact whose
 * `group` names no group in the target app.
 *
 * ⚠️ A contribution whose target app is NOT among `apps` yields nothing, and
 * that silence is a decision rather than an oversight. A package may legally
 * contribute into an app shipped by a DIFFERENT artifact installed separately —
 * that is what makes the merge a read-time fold in the first place — so the
 * only artifacts this can judge are the ones carrying both halves. Reporting
 * the absent-app case here would refuse the supported cross-artifact case at
 * build time, which is Option A wearing a warning's clothes.
 */
export function checkNavContributionGroups(
  apps: readonly NavGroupHostApp[],
  contributions: readonly NavGroupContribution[],
): NavContributionGroupDiagnostic[] {
  const byName = new Map<string, NavGroupHostApp>();
  for (const app of apps) {
    if (typeof app?.name === 'string' && app.name !== '') byName.set(app.name, app);
  }

  const found: NavContributionGroupDiagnostic[] = [];
  for (const c of contributions) {
    if (typeof c?.app !== 'string' || typeof c?.group !== 'string' || c.group === '') continue;
    if (!Array.isArray(c.items) || c.items.length === 0) continue;
    const target = byName.get(c.app);
    if (!target) continue;
    if (findNavGroup(target.navigation, c.group)) continue;
    found.push(navContributionGroupDiagnostic({
      app: c.app,
      group: c.group,
      ...(c.packageId === undefined ? {} : { packageId: c.packageId }),
      items: c.items,
    }));
  }
  return found;
}
