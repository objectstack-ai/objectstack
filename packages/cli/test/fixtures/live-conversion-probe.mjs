// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A LIVE ADR-0087 D2 conversion for a spawned CLI — test-only, loaded with
 * `node --import` (as `NODE_OPTIONS`), and never part of the published
 * registry.
 *
 * The door suites that pin how `os validate` / `os build` / `os lint` report
 * load-time conversions (`--json` `conversions`, `--strict`, the record a
 * refusal carries) need a conversion that is LIVE on the load path. Until
 * #23543 F5-http that was `flow-node-http-callout-rename`, the last real entry
 * below 18 left live; it retired with the reservation of its old names, so no
 * real entry is live any more. In-process suites append a probe with
 * `vi.mock`; a spawned CLI is out of `vi.mock`'s reach, so this module does the
 * same before the CLI's first line runs.
 *
 * It appends one conversion — flow node `type: 'probe_old_callout'` → `'http'`
 * — to `ALL_CONVERSIONS`, the table `applyConversions` reads, in BOTH builds of
 * `@objectstack/spec` the child can load: the CLI imports the ESM build, and a
 * fixture's `defineStack` config can be loaded through `require`, the CJS
 * build. The two are distinct module instances (measured: two arrays), and the
 * pass that records a conversion runs in whichever one the config loaded. The
 * specifier resolves from `packages/cli`, and pnpm's symlink realpaths to the
 * same `packages/spec/dist` file a fixture's `node_modules` link reaches, so
 * each build is the instance the CLI and the config share.
 *
 * Nothing else changes: every real entry stays as published, so a suite using
 * this probe still meets every real refusal (the reserved `http_request`
 * included).
 */
import { createRequire } from 'node:module';

import { ALL_CONVERSIONS as ESM_CONVERSIONS } from '@objectstack/spec';

export const PROBE_CONVERSION_ID = 'cli-live-conversion-probe';
export const PROBE_OLD_TYPE = 'probe_old_callout';

const probe = {
  id: PROBE_CONVERSION_ID,
  toMajor: 18,
  surface: 'flow.node.type (test probe)',
  summary: `test-only probe: a live load-path rename, node type '${PROBE_OLD_TYPE}' → 'http'`,
  apply(stack, emit) {
    if (!Array.isArray(stack.flows)) return stack;
    let changed = false;
    const flows = stack.flows.map((flow, f) => {
      if (!flow || !Array.isArray(flow.nodes)) return flow;
      let hit = false;
      const nodes = flow.nodes.map((node, n) => {
        if (!node || node.type !== PROBE_OLD_TYPE) return node;
        hit = true;
        emit({ from: PROBE_OLD_TYPE, to: 'http', path: `flows[${f}].nodes[${n}].type` });
        return { ...node, type: 'http' };
      });
      if (!hit) return flow;
      changed = true;
      return { ...flow, nodes };
    });
    return changed ? { ...stack, flows } : stack;
  },
  fixture: { before: {}, after: {}, expectedNotices: 0 },
};

const cjs = createRequire(import.meta.url)('@objectstack/spec');
for (const table of new Set([ESM_CONVERSIONS, cjs.ALL_CONVERSIONS])) {
  if (!table.some((c) => c.id === PROBE_CONVERSION_ID)) table.push(probe);
}
