// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { DEFAULT_BRANCH_LABEL, type AutomationEngine } from '../engine.js';
import { interpolate } from './template.js';

/**
 * Logic built-in nodes — decision / assignment.
 *
 * (The `loop` container is registered separately — see `loop-node.ts` — as a
 * structured iteration construct per ADR-0031.)
 *
 * Part of the automation engine's foundational vocabulary, so the core
 * {@link AutomationServicePlugin} seeds them directly (ADR-0018). These are NOT
 * shipped as a separately installable plugin — "plugins are plugins; the
 * platform's foundational capabilities are built in." Third-party node types
 * are still registered via `engine.registerNodeExecutor()`.
 */
export function registerLogicNodes(engine: AutomationEngine, ctx: PluginContext): void {
        // decision node — conditional branching
        engine.registerNodeExecutor({
            type: 'decision',
            descriptor: defineActionDescriptor({
                type: 'decision', version: '1.0.0', name: 'Decision',
                description: 'Branch execution based on conditions.',
                icon: 'git-branch', category: 'logic', source: 'builtin',
            }),
            /**
             * A decision routes one of two ways, and it must not pretend to the
             * other (#4414):
             *
             *  • It DECLARED `config.conditions` → the first matching entry's
             *    `label` is the branch, and traversal restricts itself to the
             *    out-edge carrying that label. If none matched, the branch is
             *    {@link DEFAULT_BRANCH_LABEL} — claimed by an out-edge labelled
             *    `'default'` or marked `isDefault: true`.
             *  • It declared NONE → it is a plain gateway: the branching lives on
             *    the out-edges (`condition` / `isDefault`) and the node reports
             *    **no** branch. It used to report `'default'` regardless — a
             *    label no out-edge in this repo ever carried — so every decision
             *    node silently fell back to "consider every out-edge", which is
             *    the state #4414 measured (0 label matches across all example
             *    apps) and, on an unconditional sibling, ran both branches.
             */
            async execute(node, variables, _context) {
                const config = node.config as Record<string, unknown> | undefined;
                const conditions = (config?.conditions ?? []) as Array<{ label: string; expression: string }>;
                if (conditions.length === 0) return { success: true };

                for (const cond of conditions) {
                    // `DecisionConditionSchema.expression` is declared BARE CEL
                    // (ADR-0032), so pin the dialect rather than let it be
                    // inferred. #4453 made `evaluateCondition` sniff a bare
                    // string — CEL unless it contains a `{var}` hole — which
                    // already fixes the #4414 case this wrap was added for.
                    //
                    // The wrap still earns its place, for a different reason: the
                    // sniff would route a BRACED predicate to the template
                    // dialect and happily run it, while #4439 put this slot on
                    // the expression ledger as a `predicate`, so `registerFlow`
                    // and `objectstack validate` reject exactly that spelling.
                    // Without the explicit envelope the two would disagree —
                    // build refuses what run time accepts, the worst of both.
                    // An explicit `dialect: 'cel'` keeps braces the #1491 trap
                    // here, which is what the contract says and what the
                    // validators enforce.
                    //
                    // Unlike `edge.condition` this slot has no `ExpressionInput`
                    // envelope of its own to carry the dialect — the decision
                    // descriptor is deliberately schemaless — so the executor
                    // supplies it.
                    if (engine.evaluateCondition({ dialect: 'cel', source: cond.expression }, variables)) {
                        return { success: true, branchLabel: cond.label };
                    }
                }
                return { success: true, branchLabel: DEFAULT_BRANCH_LABEL };
            },
        });

        // assignment node — set variables.
        //
        // Authors reach this node through three surfaces that each emit a
        // DIFFERENT config shape, so the executor normalizes all three (a
        // mismatch here silently sets a variable literally named `assignments`
        // instead of the intended ones — passes build, no-ops at run time):
        //   • Studio visual builder → `{ assignments: { <var>: <value> } }`
        //   • bundled example flows → `{ assignments: [{ variable, value }] }`
        //   • legacy / hand-authored → `{ <var>: <value> }` (config keys ARE
        //     the variables).
        // Values interpolate `{var}` against the live flow variables, matching
        // the CRUD / screen nodes (so `value: '{record.amount}'` resolves).
        engine.registerNodeExecutor({
            type: 'assignment',
            descriptor: defineActionDescriptor({
                type: 'assignment', version: '1.0.0', name: 'Assignment',
                description: 'Set flow variables.',
                icon: 'variable', category: 'logic', source: 'builtin',
                // Designer form (ADR-0018, #3304): the canonical Studio shape — a
                // single free-form `assignments` map, rendered by the designer's
                // flat keyValue editor. Values stay `true`-permissive (literals,
                // `{var}` templates, numbers…). The legacy array / bare-config
                // shapes the executor also accepts are read-compatible and not
                // offered for new authoring. No `required`: an empty node is valid.
                configSchema: {
                    type: 'object',
                    properties: {
                        assignments: { type: 'object', additionalProperties: true, title: 'Assignments', description: 'Set variables: each key is a variable, each value an expression or literal.' },
                    },
                },
            }),
            async execute(node, variables, context) {
                const config = (node.config ?? {}) as Record<string, unknown>;
                const raw = config.assignments;
                const pairs: Array<[string, unknown]> = [];

                if (Array.isArray(raw)) {
                    // [{ variable | name | key, value }, …]
                    for (const item of raw) {
                        if (item && typeof item === 'object') {
                            const e = item as Record<string, unknown>;
                            const name = (e.variable ?? e.name ?? e.key) as unknown;
                            if (typeof name === 'string' && name) pairs.push([name, e.value]);
                        }
                    }
                } else if (raw && typeof raw === 'object') {
                    // { <var>: <value>, … }
                    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) pairs.push([k, v]);
                } else {
                    // No `assignments` wrapper — top-level config keys ARE the variables.
                    for (const [k, v] of Object.entries(config)) pairs.push([k, v]);
                }

                for (const [key, value] of pairs) {
                    variables.set(key, interpolate(value, variables, context));
                }
                return { success: true };
            },
        });

        ctx.logger.info('[Logic Nodes] 2 built-in node executors registered');
}
