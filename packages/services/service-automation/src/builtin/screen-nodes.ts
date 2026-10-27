// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor, isExpressionEnvelopeShaped, ScreenConfigSchema, ScriptConfigSchema } from '@objectstack/spec/automation';
import type { FlowEdgeParsed, FlowNodeParsed, FlowParsed, ScreenConfigParsed, ScriptConfigParsed } from '@objectstack/spec/automation';
import type { ScreenProgressSpec } from '@objectstack/spec/contracts';
import type { AutomationEngine } from '../engine.js';
import { flowScreenCopyKey, type FlowScreenCopyKey } from '@objectstack/spec/system';
import { renderTextSlot } from './template.js';
import { parseNodeConfig } from './parse-config.js';
import { resolveValueSlot, resolveValueSlotMap } from './value-slot-map.js';
import { judgeHeadlessScreen } from '../screen-input-contract.js';

/**
 * Screen / Script built-in nodes — 'screen' and 'script' executors.
 * Part of the core flow capability, so the {@link AutomationServicePlugin}
 * seeds them directly (ADR-0018) rather than shipping a separate plugin.
 *
 * - 'screen' nodes collect user input. A screen that declares `config.fields`
 *   (or sets `config.waitForInput === true`) suspends the run on entry via the
 *   engine's durable pause (ADR-0019), surfacing a `ScreenSpec` for the client
 *   to render; the run continues via `resume()` with the collected values (set
 *   as bare flow variables). A field-less screen — or one with
 *   `waitForInput === false` — stays a server pass-through (input vars, if any,
 *   are already injected from `context.params`). Since #15705 a screen the
 *   RUN'S CALLER already answered is a fourth pass-through: when the caller
 *   supplied this screen's own fields and every `required` one is bound, there
 *   is nothing left to collect, so the run continues rather than parking on a
 *   form a headless invoker cannot submit. `judgeHeadlessScreen` owns that
 *   verdict and refuses on every uncertainty, so an interactive run is
 *   untouched.
 * - 'script' nodes call a registered function (#1870): `config.function` names
 *   it, `engine.resolveFunction()` resolves it, and the host bridges that to
 *   `bundle.functions` / `defineStack({ functions })`. A name that resolves to
 *   nothing fails the step LOUDLY rather than the old silent "no-op handler"
 *   success, so an unwired callable can't quietly skip. The named function is
 *   contractually PURE — it returns a value and the flow graph persists it —
 *   which the descriptor publishes as `handlerContract: 'pure'` and a writing
 *   function opts out of by declaring `effect: 'writes'` where it is registered
 *   (#4396).
 *
 *   #4343 converged this node to that single path. `config.actionType`'s
 *   built-in side effects ('email' / 'slack') were logger-backed stubs that
 *   delivered nothing, inline `config.script` was never executed (no
 *   server-side JS sandbox), and any other `actionType` was a second spelling
 *   of `config.function`. All five keys are retired in the spec contract, which
 *   this executor now parses before it runs — see the note in `execute` for why
 *   that parse is what makes the retirement audible to stored metadata.
 */

/**
 * The `fields[].reference` repeater column of the `screen` designer form: the
 * object PICKER (that is what `xRef` marks) whose collected value is the target
 * object's NAME — the same string `FieldSchema.reference` carries.
 *
 * Named rather than written inline at its `reference:` key. The naming was
 * originally forced by `check:reference-carrier-shape`, a source scan that
 * classified the object HOLDING a `reference` key and had no position rule for a
 * JSON-Schema `properties` map, so an inline holder made it refuse (exit 3) with
 * none of its three site remedies spellable here. That gate has been RETIRED by
 * maintainer ruling — the contract door refuses a non-string carrier on its own
 * (`FieldSchema.reference` is `z.string().optional()`), and the defect class it
 * guarded now lives in the reader, which throws rather than reading a non-string
 * as "no target".
 *
 * The name stays. It is a designer-form column that two call sites below read,
 * and this is product surface; the retirement removed the reason it was
 * MANDATORY, not the reason it is right.
 */
const LOOKUP_TARGET_COLUMN = {
  type: 'string',
  title: 'Target object',
  xRef: { kind: 'object' },
  description: "Object whose records a `lookup` field picks from, or that a `record_link` field's record belongs to. Required on both — a picker with no target object resolves nothing, and a link with none cannot name its record.",
};

/** How a refusal names a value that is not a record id — `null`, a number (`42`), a map. */
function valueKindOf(value: unknown): string {
    if (value === null) return '`null`';
    if (value === undefined) return 'nothing';
    if (typeof value === 'string') return 'a blank string';
    if (Array.isArray(value)) return 'a list';
    if (typeof value === 'object') return 'a map';
    return `a ${typeof value} (\`${String(value)}\`)`;
}

/**
 * How one node of a flow's top-level graph counts toward the screens a run
 * serves, for {@link readScreenProgress} (#26657):
 *
 * - `'screen'` — a `screen` node that pauses whenever the run reaches it.
 * - `'maybe-screen'` — a `screen` node the run's caller may already have
 *   answered (`judgeHeadlessScreen`), so whether it pauses depends on values.
 * - `'subflow'` — a node that may serve screens of its CHILD run, any number
 *   of them or none (`subflow-node.ts` forwards the child's `screen`), and
 *   whose pause may end the stretch of screens.
 * - `'pause'` — any other node that can pause. It serves no screen (only a
 *   `screen` node sets `NodeExecutionResult.screen`, and `subflow` forwards
 *   it), so the stretch of screens may end there.
 * - `'plain'` — everything else, a `screen` that never pauses included.
 */
export type ScreenProgressRole = 'screen' | 'maybe-screen' | 'subflow' | 'pause' | 'plain';

/**
 * A paused screen's place in its run, read off the flow's top-level graph
 * (#26657) — the {@link ScreenProgressSpec} served on `ScreenSpec.progress`.
 * `undefined` only when the graph does not hold the node.
 *
 * Every out-edge is a way the run may go: the engine does not evaluate a
 * condition ahead of time, so a branch it cannot see past answers
 * `'possible'`, and a count that differs between paths is left out rather
 * than guessed. Region bodies (`loop` / `try_catch` / `parallel`) are not
 * walked: a pause inside one is refused (`region-suspension-refusal.ts`), so
 * no screen there is served.
 */
export function readScreenProgress(
    flow: Pick<FlowParsed, 'nodes' | 'edges'>,
    nodeId: string,
    roleOf: (node: FlowNodeParsed) => ScreenProgressRole,
): ScreenProgressSpec | undefined {
    const nodes = new Map(flow.nodes.map((n) => [n.id, n] as const));
    if (!nodes.has(nodeId)) return undefined;
    const roles = new Map([...nodes.values()].map((n) => [n.id, roleOf(n)] as const));
    const outEdges = new Map<string, FlowEdgeParsed[]>([...nodes.keys()].map((id) => [id, []]));
    for (const edge of flow.edges ?? []) {
        if (nodes.has(edge.source) && nodes.has(edge.target)) outEdges.get(edge.source)!.push(edge);
    }
    const successors = (id: string): string[] => outEdges.get(id)!.map((e) => e.target);
    const servesScreen = (id: string): boolean => {
        const role = roles.get(id);
        return role === 'screen' || role === 'maybe-screen' || role === 'subflow';
    };

    // How one visit of a node continues, read the way `traverseNext` walks:
    // the conditional out-edges that hold run (on an exclusive `decision`
    // only the first), a default edge only when none held, the unconditional
    // ones always, and a fault edge only when the node fails. A visit may
    // STOP when nothing is sure to follow, or when the node may pause without
    // a screen; it FANS OUT when it may continue into several successors.
    const visitShape = (id: string): { mayStop: boolean; fansOut: boolean } => {
        const node = nodes.get(id)!;
        const role = roles.get(id)!;
        const edges = outEdges.get(id)!;
        const onSuccess = edges.filter((e) => e.type !== 'fault');
        const conditional = onSuccess.filter((e) => e.condition).length;
        const fallback = onSuccess.filter((e) => !e.condition && e.isDefault).length;
        const always = onSuccess.length - conditional - fallback;
        const exclusive = node.type === 'decision'
            && (node.config as { mode?: unknown } | undefined)?.mode !== 'inclusive';
        const fansOut = edges.length - onSuccess.length > 1
            || always + fallback > 1
            || (exclusive ? always > 0 && conditional > 0 : always + conditional > 1);
        return { mayStop: role === 'subflow' || role === 'pause' || (always === 0 && fallback === 0), fansOut };
    };
    const shapes = new Map([...nodes.keys()].map((id) => [id, visitShape(id)] as const));

    // `nextScreen`. "Another screen can follow" is plain reachability, a loop
    // back to this very screen included. "Certain" is the fewest screens any
    // path from here pauses on before it may stop (a 0-1 BFS, entering a
    // screen costs 1), where only a `screen` that surely pauses counts.
    const seen = new Set<string>();
    const queue = [...successors(nodeId)];
    let reachesScreen = false;
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        if (servesScreen(id)) reachesScreen = true;
        queue.push(...successors(id));
    }
    const fewest = new Map<string, number>([[nodeId, 0]]);
    const deque: string[] = [nodeId];
    let fewestToStop = shapes.get(nodeId)!.mayStop ? 0 : Infinity;
    while (deque.length > 0) {
        const id = deque.shift()!;
        const here = fewest.get(id)!;
        for (const next of successors(id)) {
            const cost = here + (roles.get(next) === 'screen' ? 1 : 0);
            if (cost >= (fewest.get(next) ?? Infinity)) continue;
            fewest.set(next, cost);
            if (shapes.get(next)!.mayStop) fewestToStop = Math.min(fewestToStop, cost);
            if (cost === here) deque.unshift(next); else deque.push(next);
        }
    }
    const nextScreen: ScreenProgressSpec['nextScreen'] = !reachesScreen
        ? 'none'
        : fewestToStop >= 1 ? 'certain' : 'possible';

    // `step` / `stepCount` — exact counts over the strongly connected
    // components (Tarjan), so a loop collapses to one unit. Each count is the
    // SET of screen totals the paths give; it is exact when the set has one
    // member, and `null` stands for "varies": a loop holding a screen, a
    // `subflow`, a maybe-screen. A fan-out anywhere the start reaches makes a
    // run take several paths at once, so no count is exact then either.
    const start = flow.nodes.find((n) => n.type === 'start');
    if (!start) return { nextScreen };
    const component = new Map<string, number>();
    const members: string[][] = [];
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const visit = (id: string): void => {
        index.set(id, index.size);
        low.set(id, index.get(id)!);
        stack.push(id);
        onStack.add(id);
        for (const next of successors(id)) {
            if (!index.has(next)) {
                visit(next);
                low.set(id, Math.min(low.get(id)!, low.get(next)!));
            } else if (onStack.has(next)) {
                low.set(id, Math.min(low.get(id)!, index.get(next)!));
            }
        }
        if (low.get(id) !== index.get(id)) return;
        const group: string[] = [];
        let popped: string;
        do {
            popped = stack.pop()!;
            onStack.delete(popped);
            component.set(popped, members.length);
            group.push(popped);
        } while (popped !== id);
        members.push(group);
    };
    for (const id of nodes.keys()) if (!index.has(id)) visit(id);

    // Tarjan closes a component only after every component it reaches, so
    // `members` runs sinks first (reverse topological order).
    const loops = (c: number): boolean =>
        members[c].length > 1 || successors(members[c][0]).includes(members[c][0]);
    const weight = (c: number): number | null => {
        if (loops(c)) return members[c].some(servesScreen) ? null : 0;
        const role = roles.get(members[c][0]);
        return role === 'screen' ? 1 : role === 'plain' || role === 'pause' ? 0 : null;
    };
    const exits = (c: number): number[] =>
        [...new Set(members[c].flatMap(successors).map((id) => component.get(id)!))].filter((d) => d !== c);
    type Counts = Set<number> | null;
    const shift = (counts: Counts, by: number | null): Counts =>
        counts === null || by === null ? null : new Set([...counts].map((n) => n + by));
    const union = (a: Counts, b: Counts): Counts => (a === null || b === null ? null : new Set([...a, ...b]));

    // Screens strictly after a component, to wherever the run may stop.
    const after = new Map<number, Counts>();
    for (let c = 0; c < members.length; c += 1) {
        let counts: Counts = members[c].some((id) => shapes.get(id)!.mayStop) ? new Set([0]) : new Set();
        for (const d of exits(c)) counts = union(counts, shift(after.get(d)!, weight(d)));
        after.set(c, counts);
    }
    // Screens strictly before a component, from the start.
    const reached: number[] = [];
    const before = new Map<number, Counts>([[component.get(start.id)!, new Set([0])]]);
    for (let c = members.length - 1; c >= 0; c -= 1) {
        const counts = before.get(c);
        if (counts === undefined) continue;
        reached.push(c);
        for (const d of exits(c)) before.set(d, union(before.get(d) ?? new Set(), shift(counts, weight(c))));
    }
    const exact = (counts: Counts | undefined): number | undefined =>
        counts && counts.size === 1 ? [...counts][0] : undefined;

    const own = component.get(nodeId)!;
    const fansOut = reached.some((c) => members[c].some((id) => shapes.get(id)!.fansOut));
    if (fansOut || loops(own)) return { nextScreen };
    const prior = exact(before.get(own));
    if (prior === undefined) return { nextScreen };
    const remaining = exact(after.get(own));
    return {
        nextScreen,
        step: prior + 1,
        ...(remaining !== undefined ? { stepCount: prior + 1 + remaining } : {}),
    };
}

/** The `progress` member, spread in only when the graph answered — absent, never `undefined`. */
function progressMember(progress: ScreenProgressSpec | undefined): { progress?: ScreenProgressSpec } {
    return progress ? { progress } : {};
}

export function registerScreenNodes(engine: AutomationEngine, ctx: PluginContext): void {
    // screen — server-side pass-through (input vars already injected by engine).
    engine.registerNodeExecutor({
      type: 'screen',
      descriptor: defineActionDescriptor({
        type: 'screen', version: '1.0.0', name: 'Screen',
        description: 'Collect user input via a screen (human-input element).',
        icon: 'window', category: 'human', source: 'builtin',
        // Human-input nodes suspend the flow awaiting input.
        supportsPause: true,  // (`isAsync` stood here — retired in #6748, ADR-0049: nothing read it)
        // The generic resume route IS this node's intended door: the flow-runner
        // collects the inputs and hands them back as the continuation, so there
        // is no service decision to route around (#3801). Stated rather than
        // inherited from a default — an omission is now a reported fact (#5561).
        resumeAuthority: 'any',
        // Designer form (ADR-0018, #3304) — mirrors objectui's hardcoded `screen`
        // field group: flat input list OR an object form, plus title/description.
        // `visibleWhen` is bare CEL (xExpression). `defaults` is a free-form
        // keyValue map, and it, a field's `defaultValue` and `recordId` are
        // value slots (#19939): their marker rides the spec Zod
        // (`ScreenConfigSchema`, carried to the expression ledger by
        // `LEDGER_DECLARED_NODE_CONFIG_SCHEMAS`), so the form keeps the inputs
        // the Studio renders for them.
        configSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', title: 'Title', description: 'Heading shown above the screen. Renders {{ }} placeholders (e.g. {{ record.name }}).' },
            description: { type: 'string', format: 'multiline', title: 'Description', description: 'Body text. Renders {{ }} placeholders: a variable path with an optional formatter (e.g. {{ approval_path }}, {{ record.amount | currency }}).' },
            fields: {
              type: 'array',
              title: 'Fields',
              description: 'Input fields collected on this screen. Leave empty for a message-only screen.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', title: 'Name' },
                  label: { type: 'string', title: 'Label' },
                  type: { type: 'string', title: 'Type' },
                  required: { type: 'boolean', title: 'Required' },
                  // Declared in #4045 — all three are forwarded into the
                  // ScreenSpec the client renders, but no form offered them, so
                  // a select field's choices (and any prefill or hint text) were
                  // authorable only by hand. Same nested position as the
                  // `visibleWhen` gap #3528 was filed for.
                  options: {
                    type: 'array', title: 'Options',
                    description: 'Choices for a select-style field.',
                    items: {
                      type: 'object',
                      properties: {
                        value: { title: 'Value', description: 'Stored value.' },
                        label: { type: 'string', title: 'Label' },
                      },
                    },
                  },
                  defaultValue: { title: 'Default', description: 'Prefilled value: a literal, or a CEL value envelope evaluated when the screen is served.' },
                  placeholder: { type: 'string', title: 'Placeholder' },
                  // Declared in #17306 — the bound pair, the help text and the
                  // lookup target, spelled as the object field spells them.
                  // Offered here for the same reason `options`/`defaultValue`/
                  // `placeholder` were in #4045: the executor forwards them, so
                  // a form that omitted them would leave the keys authorable
                  // only by hand. `builtin-node-form-zod-ledger.test.ts`
                  // reconciles this column set against the Zod both ways.
                  min: { type: 'number', title: 'Min', description: 'Minimum accepted value (numeric fields). Enforced when the run resumes.' },
                  max: { type: 'number', title: 'Max', description: 'Maximum accepted value (numeric fields). Enforced when the run resumes.' },
                  inlineHelpText: { type: 'string', title: 'Help text', description: 'Help text shown under the input. Unlike the placeholder, it stays readable once the user types.' },
                  reference: LOOKUP_TARGET_COLUMN,
                  visibleWhen: { type: 'string', title: 'Visible when', xExpression: 'expression' },
                },
              },
            },
            waitForInput: { type: 'boolean', title: 'Wait for input', description: 'Pause to show this screen even with no fields (a message / confirmation). A field-less screen with this off is a server pass-through.' },
            objectName: { type: 'string', title: 'Object form', xRef: { kind: 'object' }, description: 'Render this object’s full create/edit form (incl. master-detail) instead of a flat field list.' },
            idVariable: { type: 'string', title: 'Saved-record variable', description: 'Object form only: variable bound to the saved record’s id, for later steps.' },
            mode: { type: 'string', enum: ['create', 'edit'], default: 'create', title: 'Form mode', description: 'Object form only.' },
            // Declared in #4045: `mode: 'edit'` needs a record to edit, and the
            // executor reads exactly this key for it — but the form declared the
            // mode while offering no way to name its target.
            recordId: { type: 'string', title: 'Record to edit', description: 'Object form only: id of the record `edit` mode opens — a string, or a CEL value envelope evaluated to the id when the screen is served.' },
            defaults: { type: 'object', additionalProperties: true, title: 'Form defaults', description: 'Object form only: prefilled values — each a literal, or a CEL value envelope evaluated when the screen is served (e.g. account → { dialect: \'cel\', source: \'account_id\' }).' },
          },
        },
      }),
      async execute(node, variables, context) {
        // Parsed before anything is resolved: the text slots refuse a
        // single-brace token (#22110), and the value slots — `recordId`,
        // `defaults.*`, a field's `defaultValue` — refuse one too (#19939), so
        // what reaches the resolution below is a `{{ }}` template, an envelope
        // or a literal.
        const parsedCfg = parseNodeConfig<ScreenConfigParsed>('screen', node.id, ScreenConfigSchema, node.config);
        if (!parsedCfg.ok) return parsedCfg.refusal;
        const cfg = parsedCfg.config;
        // Screen config resolves against the live flow variables here (the
        // engine does NOT pre-resolve node config) — so a step's
        // title/description/record id/field-default/object-form-default can pull
        // from prior nodes.
        //
        // [#22110] The two TEXT slots, `title` and `description`, render
        // `{{ }}` holes (`{{ lead_record.company }}`) through
        // {@link renderTextSlot} — the ONE text renderer the refusing `end`
        // node's `message` and a notification share (#15788: never a copy).
        // [#19939] The rest are VALUE slots, not text: `recordId` names a
        // record and `defaults` / a field's `defaultValue` hand a value over.
        // Each envelope is evaluated in the run's scope BEFORE the screen goes
        // on the wire, so the client receives the value it computes — a record
        // as a map, a list as a list, the id as a string — never the envelope;
        // every other value is a literal, served as written. ⛔ No fallback to
        // the single-brace interpolator: the dispatch is by shape
        // (`resolveValueSlot`).
        //
        // [#22507] …in the run's language. Maintainer ruling A: a user-read
        // flow string the server renders per run is translated where it is
        // rendered, in the run's locale, before its holes are filled, and a
        // client overlay never touches a server-rendered slot. So each slot
        // asks the engine for its translated TEMPLATE at
        // `flows.<flow>.screens.<node_id>.{title,description}`
        // (`flowScreenCopyKey`) — the refusing `end` node's pick, through the
        // one `i18n` channel `setI18nServiceSource` attaches — and renders the
        // authored template when none is picked. The served `ScreenSpec`
        // arrives translated and filled.
        //  - The heading is asked for even with no `config.title`: the one
        //    `title` key covers the node label the heading falls back to.
        //  - The body text is asked for only where the screen authors one: a
        //    bundle never adds body text the author did not write.
        // `context.flowName` is stamped by the engine at run setup; a call
        // with none (an executor driven outside a run) renders as authored.
        const flowName = typeof context.flowName === 'string' && context.flowName.length > 0
            ? context.flowName
            : undefined;
        const screenText = (key: FlowScreenCopyKey, authored: unknown, shownAs: string): string | undefined => {
            if (flowName === undefined) return renderTextSlot(authored, variables);
            return engine.renderFlowTextSlot(
                {
                    key: flowScreenCopyKey(flowName, node.id, key),
                    authored,
                    subject: `flow '${flowName}' screen '${node.id}'`,
                    shownAs,
                },
                variables,
                context,
            );
        };
        const heading = (): string | undefined => screenText('title', cfg.title, 'the heading');
        const body = (): string | undefined =>
            typeof cfg.description === 'string' && cfg.description.length > 0
                ? screenText('description', cfg.description, 'the body text')
                : undefined;
        // [#26657] Where this screen sits among the run's screens, read off
        // the graph of the flow this run executes (`readScreenProgress`), so
        // the runner can say "Next" or "Submit" and count steps. Asked only
        // once the screen pauses. A screen inside a CHILD run (a `subflow`)
        // sees its own graph alone: "another screen follows" still holds
        // there, but "none follows" and the counts do not, because the
        // parent may continue with screens of its own — so those are left out.
        const progress = async (): Promise<ScreenProgressSpec | undefined> => {
            if (flowName === undefined) return undefined;
            const flow = await engine.getFlow(flowName);
            if (!flow?.nodes.some((n) => n.id === node.id && n.type === 'screen')) return undefined;
            const read = readScreenProgress(flow, node.id, (n) => {
                if (n.type === 'subflow') return 'subflow';
                if (n.type !== 'screen') return engine.getActionDescriptor(n.type)?.supportsPause === true ? 'pause' : 'plain';
                // The executor's own pause rule, below: an object form always
                // pauses, `waitForInput` decides, else declared fields do.
                const raw = (n.config ?? {}) as { objectName?: unknown; fields?: unknown; waitForInput?: unknown };
                if ((typeof raw.objectName === 'string' && raw.objectName.trim()) || raw.waitForInput === true) return 'screen';
                if (!Array.isArray(raw.fields) || raw.fields.length === 0 || raw.waitForInput === false) return 'plain';
                return judgeHeadlessScreen(raw.fields, new Map(), context).supplied.length > 0 ? 'maybe-screen' : 'screen';
            });
            if (!read || (context as { $parentRunId?: unknown }).$parentRunId == null) return read;
            return read.nextScreen === 'none' ? undefined : { nextScreen: read.nextScreen };
        };
        // [#19939] The record an `edit` form opens. A literal is the contract's
        // string, served as written. An envelope must evaluate to the record's
        // id, a non-blank string: anything else — `null` included — fails the
        // node here, naming its source, ⛔ never `String(value)` and never a
        // screen served with no record (an `edit` form then opens with nothing
        // read, and its save is refused).
        const recordIdOf = (raw: unknown): string | undefined => {
            if (raw === undefined) return undefined;
            const id = resolveValueSlot(engine, raw, variables, 'recordId', context);
            if (!isExpressionEnvelopeShaped(raw)) return id as string;
            if (typeof id === 'string' && id.trim() !== '') return id;
            throw new Error(
                `recordId: the value expression evaluated to ${valueKindOf(id)}, not a record id. \`recordId\` names `
                + 'the record an `edit` form opens, so it must evaluate to that record\'s id, a non-blank string; '
                + 'where the record may be absent, route around this screen with a `decision` on the value — source: '
                + `\`${String((raw as { source?: unknown }).source ?? '')}\`.`,
            );
        };

        // ── Object-form screen (master-detail wizards) ──────────────────────
        // When the step names an `objectName`, render that object's FULL
        // create/edit form — including any inline master-detail child grids —
        // instead of a flat field list. The client persists the record (and its
        // children, atomically) and resumes the run with the new id bound to
        // `idVariable`, so a later step can reference it (e.g. an Opportunity
        // step prefilling its `account` FK from the Customer step's new id).
        const objectName =
          typeof cfg.objectName === 'string' && cfg.objectName.trim() ? cfg.objectName.trim() : undefined;
        if (objectName) {
          const defaults =
            cfg.defaults && typeof cfg.defaults === 'object'
              ? resolveValueSlotMap(engine, cfg.defaults, variables, 'defaults', context)
              : undefined;
          const idVariable =
            typeof cfg.idVariable === 'string' && cfg.idVariable.trim() ? cfg.idVariable.trim() : undefined;
          return {
            success: true,
            suspend: true,
            screen: {
              nodeId: node.id,
              kind: 'object-form',
              title: heading() ?? node.label ?? objectName,
              description: body(),
              objectName,
              mode: cfg.mode === 'edit' ? 'edit' : 'create',
              recordId: recordIdOf(cfg.recordId),
              defaults,
              idVariable,
              fields: [],
              ...progressMember(await progress()),
            },
          };
        }

        const rawFields = cfg.fields ?? [];
        const hasFields = rawFields.length > 0;
        // Suspend to collect input when the screen declares fields, or opts in
        // explicitly. `waitForInput === false` forces a server pass-through.
        const wantsPause = cfg.waitForInput === true || (hasFields && cfg.waitForInput !== false);
        // #15705 — a screen whose inputs the CALLER already supplied is
        // answered, so the run continues instead of parking on a form nobody
        // will ever submit. A headless invoker (`run_action` over MCP) seeds
        // the flow's `isInput` variables and then has no resume verb; before
        // this, every screen-typed flow action was a dead end for it.
        //
        // Three deliberate narrowings, each keeping an existing behaviour whole:
        //
        //  - `waitForInput === true` is NOT overridden. That flag is the
        //    author's explicit "show this", and its documented job is the
        //    field-less message / confirmation screen — a screen that collects
        //    nothing and would therefore be VACUOUSLY satisfiable. Honouring it
        //    keeps a confirmation step from being skipped by a bag it never
        //    asked for.
        //  - `hasFields` is required, for the same vacuity reason stated from
        //    the other side: no declared fields means no contract to satisfy.
        //  - the verdict itself refuses on every uncertainty
        //    (`judgeHeadlessScreen`), so an interactive run — which supplies
        //    none of the screen's own fields — takes the untouched path.
        //
        // ⛔ This does NOT make every screen flow completable over MCP: a call
        // that omits the inputs still parks, and nothing on that surface can
        // continue it. That half is a resume verb, and it is not this change.
        const headless = wantsPause && hasFields && cfg.waitForInput !== true
          ? judgeHeadlessScreen(rawFields, variables, context)
          : undefined;
        const shouldPause = wantsPause && headless?.satisfied !== true;
        if (!shouldPause) {
          return { success: true };
        }
        const fields = rawFields.map((f, index) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          required: f.required === true,
          options: f.options as Array<{ value: unknown; label: string }> | undefined,
          defaultValue: f.defaultValue !== undefined
            ? resolveValueSlot(engine, f.defaultValue, variables, `fields[${index}].defaultValue`, context)
            : undefined,
          placeholder: f.placeholder,
          // #17306. `min`/`max` go on the wire for the client to apply at the
          // input, and are re-checked server-side on resume
          // (`validateScreenInputs`) so the bound is not dialog-only.
          // `inlineHelpText`/`reference` are presentation and picker-target
          // hints the client alone acts on.
          min: f.min,
          max: f.max,
          inlineHelpText: f.inlineHelpText,
          reference: f.reference,
          // Forwarded RAW — deliberately not interpolated. `visibleWhen` is a
          // predicate the client re-evaluates on every keystroke against the
          // values collected SO FAR; the server has no view of those, so
          // resolving it here (to a constant, against flow variables) would
          // freeze the field visible-or-hidden for the life of the screen.
          //
          // It was declared on the designer form from the start but never put
          // on the wire, so no client could honour it: authors wrote a
          // predicate, Studio offered the input, and the field rendered
          // unconditionally. Where that field was also `required`, a runner
          // validating the full list blocked Submit on a field the user was
          // never shown — the run then sat paused with no resume request ever
          // issued (#3528).
          visibleWhen: f.visibleWhen,
        })).filter((f) => f.name.length > 0);
        return {
          success: true,
          suspend: true,
          screen: {
            nodeId: node.id,
            title: heading() ?? node.label ?? 'Input',
            description: body(),
            fields,
            ...progressMember(await progress()),
          },
        };
      },
    });

    // script — call the registered function named by `config.function`.
    engine.registerNodeExecutor({
      type: 'script',
      descriptor: defineActionDescriptor({
        type: 'script', version: '1.0.0', name: 'Script',
        description: 'Run a custom script action.',
        icon: 'code', category: 'logic', source: 'builtin',
        // #4396 — the purity rule this executor relies on, published where an
        // author, a designer and the action catalog can read it. `category:
        // 'logic'` says nothing about it, so until this field the contract
        // existed only as a comment inside the call below.
        handlerContract: 'pure',
      }),
      async execute(node, variables, context) {
        // #4343 — the contract is parsed before anything runs. A `script` node
        // calls a registered function and nothing else, so `config.function` is
        // required and a retired dispatch key refuses here with its tombstone
        // prescription (`notify` for mail, a Slack connector for slack, a
        // registered function for an inline body).
        //
        // A refusal is a GUARD, not a routable failure: a config that fails its
        // contract is wrong METADATA — re-running it unchanged can never
        // succeed — so no `fault` edge may silence it (#3863).
        //
        // What a STORED flow meets here is the required `function`, not the
        // tombstones: `registerFlow` canonicalizes data at rest through the
        // retired conversion as well (#3903), so an old `actionType: 'email'`
        // node arrives stripped of the keys nothing read, and refuses for
        // naming no callable. That is the behavioral change the retirement
        // bought — the same node used to log a line and report success.
        //
        // The historical aliases (`functionName`/`input`) are canonicalized on
        // the same seam by 'flow-node-script-config-aliases' (#3796), so only
        // the canonical keys reach the parse.
        const parsed = parseNodeConfig<ScriptConfigParsed>('script', node.id, ScriptConfigSchema, node.config);
        if (!parsed.ok) return parsed.refusal;
        const cfg = parsed.config;
        const target = cfg.function.trim();

        // Unresolvable is a RUNTIME failure, deliberately: the function
        // registry is the host's (`defineStack({ functions })`), so the same
        // metadata succeeds on a host that registers the name. Only the
        // metadata itself earns a guard.
        const registration = engine.resolveFunction(target);
        if (!registration) {
          return {
            success: false,
            error:
              `script node '${node.id}': no function named '${target}' is registered. ` +
              `Register it via \`defineStack({ functions: { '${target}': fn } })\`, or fix the name.`,
          };
        }

        // [#19939] Map declared inputs (`config.inputs`) to the function —
        // `inputs.*` is a value slot (#11182 ruling D): an envelope is
        // evaluated against the live flow variables and handed over as the raw
        // value it computes, so a function can consume a prior node's output
        // with its type kept (`{ dialect: 'cel', source: 'aiResult.id' }`);
        // every other value is a literal (`parseNodeConfig` above has already
        // refused a `{token}` of the retired template dialect).
        const input = resolveValueSlotMap(engine, cfg.inputs, variables, 'inputs', context);
        const outputVariable = cfg.outputVariable?.trim() || undefined;
        // Pure-function pattern: the function RETURNS its result; `outputVariable`
        // exposes it as a flow variable so a later declarative node persists it
        // (e.g. `update_record fields: { ai_category: { dialect: 'cel', source: 'aiResult.ai_category' } }`).
        // Data I/O stays on the flow graph — the function itself does no writes.
        // The descriptor above publishes that as `handlerContract: 'pure'`, and
        // `FlowFunctionContext` hands the function no data engine to write with.
        //
        // #4354 — which is why a pure function's step reports NO metrics: by that
        // contract every write it causes is a downstream `update_record` counting
        // itself, so "absent" (this kind of node touches no records) is the
        // accurate answer, not a guess.
        //
        // #4396 — and a function that legitimately writes DECLARES it
        // (`{ handler, effect: 'writes' }`), which is what turns this step's
        // silence into an honest "cannot count". Declaring stays per FUNCTION:
        // a blanket `unmeasuredEffect` on every script step would suppress the
        // broken-sweep signal on every flow that calls any function, to cover
        // the few that write. An UNDECLARED writer still under-reports — no
        // runtime check can catch code that closed over a client at module
        // scope, so the rule is published rather than policed.
        const unmeasured = registration.effect === 'writes';
        try {
          const result = await registration.handler({ input, variables, automation: context, logger: ctx.logger });
          if (outputVariable) variables.set(outputVariable, result);
          return {
            success: true,
            output: { function: target, result },
            ...(unmeasured ? { metrics: { unmeasuredEffect: true } } : {}),
          };
        } catch (err) {
          return {
            success: false,
            error: `script function '${target}' (node '${node.id}') failed: ${(err as Error).message}`,
            // A declared writer that threw may have written before it did, so
            // the run still cannot claim it counted everything.
            ...(unmeasured ? { metrics: { unmeasuredEffect: true } } : {}),
          };
        }
      },
    });

    ctx.logger.info('[Screen/Script Nodes] 2 built-in node executors registered');
}
