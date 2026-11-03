// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `flow-region-shape-invalid` — a flow the automation engine refuses to
 * register for its ADR-0031 region shape, refused at every authoring command.
 * The runtime authoring gate reads it too, at the save of an active flow and
 * at both publish doors (the per-item publish and the package publish), and
 * judges the body the engine registers: the flow in its ADR-0087 D2-converted
 * spelling (#21982, #29557).
 *
 * ## What it reports
 *
 * One `error` per flow whose structured regions (`loop` bodies, `parallel`
 * branches, `try_catch` try/catch regions, at every depth) are not
 * single-entry/single-exit and acyclic, or whose `parallel` has fewer than two
 * branches. The engine's `registerFlow` refuses such a flow: it logs
 * `[Automation] failed to register flow` and the boot goes on without it, so
 * its trigger never fires.
 *
 * ## ⛔ The verdict is the engine's — nothing here restates the region rules
 *
 * Each flow goes through the same two calls `registerFlow` makes: `FlowSchema`,
 * then the spec's `validateControlFlow` (`@objectstack/spec/automation`). The
 * finding's message is the engine's refusal, verbatim, behind the flow's name.
 * Like the engine, it stops at a flow's first malformed region; every flow is
 * judged.
 *
 * ## A flow `FlowSchema` refuses is a finding, never a skip
 *
 * The region verdict is computed on the parsed flow. Under `os validate` and
 * `os build` the stack schema has already parsed every flow, and `FlowSchema`
 * accepts its own output, so a refused parse cannot happen there today; if
 * that ever stops being true, a silent skip would pass a flow nobody judged,
 * the false-clean direction this rule exists to close. Under `os lint`, which
 * never parses, the flow really can fail the schema, and the engine refuses to
 * register it too. Either way the finding says the flow could not be judged
 * and carries the schema's issues.
 *
 * An entry that is not a record at all (an empty YAML list item, a string) is
 * skipped, as every registry reader skips it (`non-record-object-entry.test.ts`):
 * no author wrote a flow there, and `os validate` refuses the collection with
 * the stack schema's own sentence. Its index is kept, so the paths of the
 * flows around it stay the author's.
 *
 * ## Not judged here
 *
 * A cycle in the flow's TOP-LEVEL graph. The engine refuses it with
 * `detectCycles`, which lives in `@objectstack/service-automation` and is not
 * exported; region bodies ARE cycle-checked, by `validateControlFlow`.
 */

import { FlowSchema, validateControlFlow } from '@objectstack/spec/automation';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** The rule id every finding of this rule carries. */
export const FLOW_REGION_SHAPE_INVALID = 'flow-region-shape-invalid';

export interface FlowRegionShapeFinding {
  /** Always an error: the engine refuses the flow. */
  severity: 'error';
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `flow 'lead_time'`. */
  where: string;
  /** Config path of the flow, e.g. `flows[0]`. */
  path: string;
  /** `Flow '<name>' would be refused at registration: ` and the engine's refusal. */
  message: string;
  /** How to fix it. */
  hint: string;
}

const HINT =
  'Give the region one entry and one exit (add one node every exit of the region leads to), remove any edge '
  + 'that loops back inside it, and give a parallel at least two branches.';

const SCHEMA_HINT =
  'Fix the flow so the flow schema accepts it (`os validate` names each issue); its regions are judged then.';

/**
 * The container the engine's refusal names, read off the refusal itself:
 * `validateControlFlow` throws `FlowRegionShapeError`, carrying the
 * container's node id and its path inside the flow. Anything else it throws
 * names no container, and the flow stays the anchor.
 */
function containerAtFault(err: unknown): { nodeId: string; path: readonly (string | number)[] } | undefined {
  // PLACEHOLDER: reads the spec's FlowRegionShapeError once that export lands.
  void err;
  return undefined;
}

/** `['nodes', 1, 'config', 'try']` → `.nodes[1].config.try`, the lint path spelling. */
const spellPath = (segments: readonly (string | number)[]): string =>
  segments.map((s) => (typeof s === 'number' ? `[${s}]` : `.${s}`)).join('');

/**
 * Every flow of `stack.flows` the automation engine would refuse to register
 * for its region shape, one finding each. Pure.
 */
export function validateFlowRegionShape(stack: AnyRec): FlowRegionShapeFinding[] {
  const flows = stack.flows;
  if (!Array.isArray(flows)) return [];
  const findings: FlowRegionShapeFinding[] = [];
  flows.forEach((raw, i) => {
    if (!isRec(raw)) return;
    const path = `flows[${i}]`;
    const result = FlowSchema.safeParse(raw);
    if (!result.success) {
      const declared = raw.name;
      const name = typeof declared === 'string' && declared !== '' ? declared : path;
      const issues = result.error.issues
        .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
        .join('; ');
      findings.push({
        severity: 'error',
        rule: FLOW_REGION_SHAPE_INVALID,
        where: `flow '${name}'`,
        path,
        message: `Flow '${name}' could not be judged for its region shape: the flow schema refused it (${issues})`,
        hint: SCHEMA_HINT,
      });
      return;
    }
    try {
      validateControlFlow(result.data);
    } catch (err) {
      const name = result.data.name;
      const container = containerAtFault(err);
      findings.push({
        severity: 'error',
        rule: FLOW_REGION_SHAPE_INVALID,
        where: container ? `flow '${name}' › node '${container.nodeId}'` : `flow '${name}'`,
        path: container ? `${path}${spellPath(container.path)}` : path,
        message: `Flow '${name}' would be refused at registration: ${err instanceof Error ? err.message : String(err)}`,
        hint: HINT,
      });
    }
  });
  return findings;
}
