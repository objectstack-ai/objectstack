/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Node-type spellings this package USED to publish and no longer does
 * (objectui#9533), and the widget each one renders now.
 *
 * ## Why a tombstone rather than nothing
 *
 * `view:dashboard` was this package's own full type until objectui#9533
 * converged the bare `dashboard` key onto `plugin-dashboard`. Simply deleting
 * the registration would leave an authored `{ "type": "view:dashboard" }` node
 * resolving to nothing, and "nothing" reads to an author as the same OBJUI-001
 * panel a typo produces — it names the spelling they wrote and says nothing
 * about the spelling that replaced it. The maintainer-approved ruling on
 * objectui#9533 (director summon #24, batch #152 item 5, letter 1) requires
 * the refusal to be BY NAME and to point at `plugin-dashboard:dashboard`, so
 * the key stays registered and answers with a visible refusal carrying its own
 * migration.
 *
 * ## Shape
 *
 * Borrowed whole from `@object-ui/fields`' `RetiredFieldTombstone`
 * (objectui#4814), which is this repository's settled answer to "an authored
 * entry this renderer will not honour": an inline alert that NAMES the
 * offending spelling plus a `console.error` whose text doubles as the fix
 * instruction. Nothing is thrown — one retired node must not take down the
 * dashboard around it — and nothing is silently substituted, which is the
 * point: the author sees a refusal where they expected a dashboard, not a
 * dashboard that quietly taught them a dead spelling.
 *
 * ⛔ The registration that consumes this table passes `skipFallback: true`: a
 * tombstone must never claim the bare `dashboard` key, which
 * `plugin-dashboard:dashboard` owns.
 */
import React from 'react';

/**
 * The bare name of every retired spelling, mapped to the refusal text the
 * tombstone renders and logs. Keyed by the BARE name because that is what
 * `ComponentRegistry.register` takes; the namespace is spelled at the call.
 *
 * The message names BOTH halves deliberately — the spelling that was written
 * and the spelling that replaces it. A refusal that only says "unknown" is the
 * one this table exists to stop being.
 */
export const RETIRED_DASHBOARD_NODE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  dashboard:
    '[object-ui] Node type `view:dashboard` was RETIRED (objectui#9533). This package ' +
    'registers the dashboard renderer as `plugin-dashboard:dashboard`, the namespace the ' +
    "console's lazy stubs and the CLI's known-type whitelist already declare. Write " +
    '`{ "type": "plugin-dashboard:dashboard" }`, or the bare `{ "type": "dashboard" }`, ' +
    'which resolves to the same renderer.',
});

/** Spellings already reported, so one retired node logs once per session. */
const reported = new Set<string>();

/**
 * Log a retired node-type spelling once. Exported for the pin test, which has
 * to be able to observe a SECOND occurrence being suppressed without inventing
 * its own copy of the set.
 */
export function reportRetiredDashboardNodeType(spelling: string): void {
  if (reported.has(spelling)) return;
  reported.add(spelling);
  console.error(
    RETIRED_DASHBOARD_NODE_TYPES[spelling] ??
      `[object-ui] Node type \`${spelling}\` was retired by @object-ui/plugin-dashboard.`,
  );
}

/** Test seam: forget what has been reported, so a pin can measure the first one. */
export function resetRetiredDashboardNodeTypeReports(): void {
  reported.clear();
}

/**
 * The widget a RETIRED dashboard node-type spelling renders.
 *
 * The rendered text and the logged text are the SAME string, read from
 * {@link RETIRED_DASHBOARD_NODE_TYPES}. A pin that asserts only "nothing
 * rendered" cannot tell this refusal apart from the key having been deleted
 * outright, which is why the text is part of the contract and not decoration.
 */
export const RetiredDashboardNodeTombstone: React.FC<Record<string, unknown>> = (props) => {
  const schema = props?.schema as { type?: unknown } | undefined;
  const fromSchema = typeof schema?.type === 'string' ? schema.type : undefined;
  const fromProps = typeof props?.type === 'string' ? (props.type as string) : undefined;
  const written = fromSchema ?? fromProps ?? 'view:dashboard';
  // The table is keyed by the BARE name; an author reaches this component by
  // either spelling, so the lookup drops any namespace prefix before reading it.
  const bare = written.includes(':') ? written.slice(written.indexOf(':') + 1) : written;
  const prescription =
    RETIRED_DASHBOARD_NODE_TYPES[bare] ??
    `[object-ui] Node type \`${written}\` was retired by @object-ui/plugin-dashboard.`;
  React.useEffect(() => {
    reportRetiredDashboardNodeType(bare);
  }, [bare]);
  return (
    <div
      role="alert"
      data-testid="dashboard-retired-node-tombstone"
      data-retired-node-type={written}
      className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {prescription}
    </div>
  );
};
