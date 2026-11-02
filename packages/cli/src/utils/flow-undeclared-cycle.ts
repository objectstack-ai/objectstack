// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29051 — an undeclared cycle in a flow's TOP-LEVEL graph, at `os validate`
 * and `os build` (ADR-0044).
 *
 * The automation engine refuses to register a flow whose graph, once its
 * `type: 'back'` edges are set aside, still has a cycle. It asks
 * `findUndeclaredFlowCycle` (`@objectstack/metadata-core`) at registration, and
 * so does the runtime authoring gate every publish door runs. Before this
 * module `os validate` and `os build` passed such a flow with exit 0; it then
 * published or booted, the engine refused it, and it never ran.
 *
 * The verdict here is that same call on the same parsed body (`FlowSchema`,
 * then the judge), so there is no second copy of the DFS, and the message is
 * the engine's sentence, verbatim, behind the flow's name. It lives in the CLI,
 * not in the `@objectstack/lint` rule table beside `flow-region-shape-invalid`,
 * because lint does not depend on `@objectstack/metadata-core`.
 *
 * Order: the engine judges the cycle before the ADR-0031 region shape. The
 * commands run the rule table first, so a flow that has both a malformed
 * region and an undeclared cycle is refused for its region; once that is
 * fixed, this step refuses the cycle. Both are refusals; only which one an
 * author reads first differs.
 *
 * Walked the way the other CLI flow walks are: each `packages[]` entry's flows,
 * or the stack's own flows when it declares no packages.
 *
 * A flow `FlowSchema` refuses here is not judged: `flow-region-shape-invalid`
 * already refused it at the rule-table step, which exits before this one, so
 * no flow reaches this walk unjudged.
 */

import { findUndeclaredFlowCycle } from '@objectstack/metadata-core';
import { FlowSchema } from '@objectstack/spec/automation';

import { artifactPackages } from './artifact-packages.js';

/** One refused flow, located. */
export interface FlowCycleRefusalRow {
  /** Where the flow sits in the parsed stack, e.g. `flows[0]` or `packages[1].manifest.flows[0]`. */
  path: string;
  /** The code the CLI's other author-time refusals carry. */
  code: 'VALIDATION_ERROR';
  /** The flow's name. */
  flow: string;
  /** `Flow '<name>' would be refused at registration: ` followed by the engine's refusal, verbatim. */
  message: string;
}

/** Every flow of the parsed stack the engine would refuse to register for an undeclared top-level cycle. */
export function findFlowCycleRefusals(parsed: Record<string, unknown>): FlowCycleRefusalRow[] {
  const entries = artifactPackages(parsed);
  const subjects = entries.length > 0
    ? entries.map(({ index, body }) => ({ flows: body.flows, at: `packages[${index}].manifest.` }))
    : [{ flows: parsed.flows, at: '' }];
  const rows: FlowCycleRefusalRow[] = [];
  for (const { flows, at } of subjects) {
    if (!Array.isArray(flows)) continue;
    flows.forEach((raw, i) => {
      const result = FlowSchema.safeParse(raw);
      if (!result.success) return;
      const cycle = findUndeclaredFlowCycle(result.data);
      if (!cycle) return;
      const name = result.data.name;
      rows.push({
        path: `${at}flows[${i}]`,
        code: 'VALIDATION_ERROR',
        flow: name,
        message: `Flow '${name}' would be refused at registration: ${cycle.message}`,
      });
    });
  }
  return rows;
}
