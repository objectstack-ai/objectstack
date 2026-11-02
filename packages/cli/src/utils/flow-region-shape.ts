// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28893 — the ADR-0031 region-shape check at `os validate` and `os build`.
 *
 * The automation engine refuses to register a flow whose structured regions
 * (`loop` bodies, `parallel` branches, `try_catch` try/catch regions, at every
 * depth) are not single-entry/single-exit and acyclic, or whose `parallel` has
 * fewer than two branches: `registerFlow` parses the body with `FlowSchema`
 * and calls the spec's `validateControlFlow`. Before this module validate and
 * build passed such a flow, and the first sign of it was a boot warning
 * (`[Automation] failed to register flow`) with the flow silently absent.
 *
 * The verdict here is that same call — `FlowSchema` then `validateControlFlow`
 * from `@objectstack/spec/automation` — so there is no second copy of the
 * region rules, and its message (`<where>: <errors>`) is the engine's,
 * verbatim, behind the flow's name. Like the engine it stops at a flow's first
 * malformed region; each flow is judged.
 *
 * Walked the way `findExtensionFieldSuffixRefusals` (`./extension-field-suffix.ts`)
 * walks: each `packages[]` entry's flows, or the stack's own flows when it
 * declares no packages. A flow the schema refuses is left to the schema step,
 * which has already reported it.
 *
 * Not judged here: a cycle in the flow's TOP-LEVEL graph. The engine refuses it
 * with `detectCycles`, which lives in `@objectstack/service-automation` and is
 * not exported; region bodies ARE cycle-checked, by `validateControlFlow`.
 */

import { FlowSchema, validateControlFlow } from '@objectstack/spec/automation';

import { artifactPackages } from './artifact-packages.js';

/** One refused flow, located. */
export interface FlowRegionRefusalRow {
  /** Where the flow sits in the parsed stack, e.g. `flows[0]` or `packages[1].manifest.flows[0]`. */
  path: string;
  /** The code the CLI's other author-time refusals carry. */
  code: 'VALIDATION_ERROR';
  /** The flow's name. */
  flow: string;
  /** `Flow '<name>' …: ` followed by the engine's refusal, verbatim. */
  message: string;
}

/** Every flow of the parsed stack the engine would refuse to register for its region shape. */
export function findFlowRegionRefusals(parsed: Record<string, unknown>): FlowRegionRefusalRow[] {
  const entries = artifactPackages(parsed);
  const subjects = entries.length > 0
    ? entries.map(({ index, body }) => ({ flows: body.flows, at: `packages[${index}].manifest.` }))
    : [{ flows: parsed.flows, at: '' }];
  const rows: FlowRegionRefusalRow[] = [];
  for (const { flows, at } of subjects) {
    if (!Array.isArray(flows)) continue;
    flows.forEach((raw, i) => {
      const result = FlowSchema.safeParse(raw);
      if (!result.success) return;
      try {
        validateControlFlow(result.data);
      } catch (err) {
        const name = result.data.name;
        rows.push({
          path: `${at}flows[${i}]`,
          code: 'VALIDATION_ERROR',
          flow: name,
          message: `Flow '${name}' would be refused at registration: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  }
  return rows;
}
