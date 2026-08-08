// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/state-machine
 *
 * XState-inspired State Machine Protocol — hierarchical states, guarded
 * transitions, entry/exit actions. Used to declare strict business-logic
 * constraints and lifecycle management, so an AI author cannot "hallucinate" a
 * transition the machine never declared.
 *
 * ## Where this is authored — the question #4001 had to answer first
 *
 * The ledger carried these shapes as `authorable (p)` — provisional, because
 * nobody had checked. Checking matters here more than usual, because
 * [ADR-0020](https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0020-state-machine-converge-and-enforce.md)
 * **retired this shape as a record-lifecycle declaration**: the top-level
 * `workflow` metadata type and `object.stateMachines` are both gone, and a
 * record's legal transitions are declared as a `state_machine` **validation
 * rule** (`data/validation.zod.ts`, a flat `{ from: [to] }` table — closed
 * since #4001 batch 3b). A schema whose only doors were those two would be
 * dead surface, and the campaign's own rule is that dead surface gets its
 * ledger class corrected, not tightened.
 *
 * One door survives, and it is an authoring door: **`ai/agent.zod.ts`'s
 * `lifecycle`** is `StateMachineSchema`, and `agent` is a registered metadata
 * type — so `defineStack({ agents })`, `POST /api/v1/meta/types/agent` and the
 * Studio agent form all reach this file through `AgentSchema.parse()`. Verified
 * by parse, not by reading: before this change,
 *
 * ```ts
 * AgentSchema.parse({ …, lifecycle: {
 *   id: 'probe_machine', initial: 'draft', stats: { runs: 3 },
 *   states: { draft: { onn: { APPROVE: 'done' }, meta: { labell: 'Draft', owner: 'ops' } },
 *             done: { type: 'final' } },
 * } })
 * ```
 *
 * **succeeded**, returning
 * `{ id, initial, states: { draft: { type: 'atomic', meta: {} }, done: … } }` —
 * `stats` gone, `meta`'s two keys gone, and `onn` (one keystroke from `on`)
 * gone with every transition the author declared. A state machine whose whole
 * purpose is to *deny* undeclared transitions had silently become one with no
 * transitions at all, and reported success.
 *
 * So: `authorable`, and every shape below is `strictObject`.
 *
 * ## `meta` is closed, deliberately
 *
 * XState treats `meta` as an open bag, so leaving it open was the plausible
 * call and it was checked rather than assumed (the #4909 precedent: a slot
 * whose openness is real should say `.passthrough()`, not strip). Three facts
 * say closed here: the hand-written {@link StateNodeConfig} type beside this
 * schema declares exactly four `meta` keys, so `passthrough` would open the
 * Zod while `tsc` stayed shut — a new declared-≠-enforced split; nothing in
 * this repo reads any `meta` key (`aiInstructions` has no consumer outside
 * this file's own test); and the current behaviour is not openness but
 * *strip* — the probe above shows an author's `meta` arriving as `{}`. There
 * is no openness here to preserve, only a silence to end.
 */

import { z } from 'zod';

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';

/**
 * Shared history sentence for every shape in this file — one silence, one
 * description of it, so the rejections cannot drift apart.
 */
const STATE_MACHINE_STRIP_HISTORY =
  'Until #4001 an undeclared key here was dropped silently — the machine still parsed, so a mistyped `on`/`entry`/`cond` produced a machine missing the very transition it was written to declare, reported as valid.';

// --- Primitives ---

/**
 * References a named action (side effect)
 * Can be a script, a webhook, or a field update.
 *
 * A union: the string form names a registered action, the object form
 * parameterises one. Only the OBJECT branch has keys to be strict about.
 *
 * ⚠️ **The rejection is shaped differently here than on a plain shape, and
 * that is a zod property, not a curation gap.** A failing branch does not
 * raise its own issue to the top: the union raises ONE `invalid_union` issue
 * whose `message` is the literal string `"Invalid input"`, with each branch's
 * real issues nested one level down in `issue.errors[]`. That payload survives
 * everywhere the issues are carried structurally (`ZodError.message`, the REST
 * error body); until #4971 the flatten-to-one-line consumers dropped it, and
 * `formatZodError` — what `defineStack` throws through — was one, so this
 * schema rendered a bare `✗ (root): Invalid input` where `TransitionSchema` (a plain
 * `strictObject`) rendered its full prescription. `formatZodError` now expands
 * the union's most informative branch, so both render the prescription; what
 * remains union-shaped is the extra `Invalid input` line above it.
 *
 * Strictness earned its place even before that fix: the alternative was never
 * a better message, it is `params` misspelled as `args` **accepted in
 * silence**, with the action running unparameterised. Rejection beat that even
 * at "Invalid input". Both facts are pinned in `state-machine.test.ts` so
 * neither the union's shape nor the underlying prose can regress unnoticed.
 */
export const ActionRefSchema = lazySchema(() => z.union([
  z.string().describe('Action Name'),
  strictObject(
    {
      surface: 'this action reference',
      history: STATE_MACHINE_STRIP_HISTORY,
    },
    {
      type: z.string(), // e.g., 'xstate.assign', 'log', 'email'
      params: z.record(z.string(), z.unknown()).optional(),
    },
  ),
]));

/**
 * References a named condition (guard)
 * Must evaluate to true for the transition to occur.
 */
export const GuardRefSchema = lazySchema(() => z.union([
  z.string().describe('Guard Name (e.g., "isManager", "amountGT1000")'),
  strictObject(
    {
      surface: 'this guard reference',
      history: STATE_MACHINE_STRIP_HISTORY,
    },
    {
      type: z.string(),
      params: z.record(z.string(), z.unknown()).optional(),
    },
  ),
]));
export type GuardRef = z.input<typeof GuardRefSchema>;

// --- Core Structure ---

/**
 * State Transition Definition
 * "When EVENT happens, if GUARD is true, go to TARGET and run ACTIONS"
 */
export const TransitionSchema = lazySchema(() => strictObject(
  {
    surface: 'this state transition',
    history: STATE_MACHINE_STRIP_HISTORY,
    // `guard → cond` is the alias category's textbook case, and the evidence
    // is inside this file rather than in XState release notes: the key is
    // `cond`, its value is a `GuardRefSchema`, and its own `.describe()` calls
    // it "Condition (Guard) required to take this path". An author who reads
    // the schema — or arrives with XState v5 priors, where `cond` WAS renamed
    // to `guard` — writes the word the prose uses. Edit distance never
    // connects `guard` to `cond`, so only a named entry can.
    aliases: { guard: 'cond' },
  },
  {
    target: z.string().optional().describe('Target State ID'),
    cond: GuardRefSchema.optional().describe('Condition (Guard) required to take this path'),
    actions: z.array(ActionRefSchema).optional().describe('Actions to execute during transition'),
    description: z.string().optional().describe('Human readable description of this rule'),
  },
));

// `EventSchema` (XState-style signal declaration `{ type, schema }`) was removed
// here in #4658 (dual-source ledger #4535 C6): nothing in this file — or any
// repo — ever referenced it. Event types on a state machine are the RECORD KEYS
// of `on:` (plain strings), not declared signal objects. The platform's one
// `EventSchema` is the event-bus envelope in `kernel/events/core.zod.ts`; the
// kernel-side analogue of a signal *declaration* is `EventTypeDefinitionSchema`
// in the same file.

export type ActionRef = z.input<typeof ActionRefSchema>;
export type Transition = z.input<typeof TransitionSchema>;

export type StateNodeConfig = {
  type?: 'atomic' | 'compound' | 'parallel' | 'final' | 'history';
  entry?: ActionRef[];
  exit?: ActionRef[];
  on?: Record<string, string | Transition | Transition[]>;
  always?: Transition[];
  initial?: string;
  states?: Record<string, StateNodeConfig>;
  meta?: {
    label?: string;
    description?: string;
    color?: string;
    aiInstructions?: string;
  };
};

/**
 * State Node Definition
 *
 * Both type arguments are given (#4195) so `z.input` is not `unknown` — a state
 * machine is hand-authored, and an `unknown` input type means nothing checks
 * what an author writes into `states`.
 *
 * Caveat worth knowing before trusting it: {@link StateNodeConfig} is written by
 * hand in the AUTHORING shape (`type?` is optional), while `type` is
 * `.default('atomic')` and so always present once parsed. Using it for both
 * arguments is therefore exact on the input side and slightly loose on the
 * output side — which is what this schema already claimed before, so nothing
 * regressed. Making the output exact means re-deriving `StateNodeConfig` from
 * the schema rather than maintaining it beside one; that is a separate change.
 *
 * Note the annotation also ERASES strictness from the static type: `tsc` judges
 * an author's literal against {@link StateNodeConfig}, which is a plain object
 * type, so an excess key is caught by the parse rather than the compiler. That
 * is exactly why the parse had to stop stripping.
 */
export const StateNodeSchema: z.ZodType<StateNodeConfig, StateNodeConfig> = z.lazy(() => strictObject(
  {
    surface: 'this state node',
    history: STATE_MACHINE_STRIP_HISTORY,
    guidance: {
      // A wrong-LAYER pointer, not a rename: `on` is a record keyed by EVENT
      // TYPE, so there is no `transitions` key to send the author to. Named
      // because `transitions` is the word the surviving record-lifecycle shape
      // uses (`data/validation.zod.ts`'s `state_machine` rule), which is the
      // neighbouring declaration an author is most likely to be coming from.
      transitions: 'A state node declares its transitions as `on`, a record keyed by EVENT TYPE (`on: { APPROVE: "approved" }`). `transitions` is the key on the object-level `state_machine` VALIDATION RULE (`validations[].transitions`, a flat `{ from: [to] }` table) — a different declaration, for a record\'s lifecycle rather than an agent\'s.',
    },
  },
  {
    /** Type of state */
    type: z.enum(['atomic', 'compound', 'parallel', 'final', 'history']).default('atomic'),

    /** Entry/Exit Actions */
    entry: z.array(ActionRefSchema).optional().describe('Actions to run when entering this state'),
    exit: z.array(ActionRefSchema).optional().describe('Actions to run when leaving this state'),

    /** Transitions (Events) */
    on: z.record(z.string(), z.union([
      z.string(), // Shorthand target
      TransitionSchema,
      z.array(TransitionSchema),
    ])).optional().describe('Map of Event Type -> Transition Definition'),

    /** Always Transitions (Eventless) */
    always: z.array(TransitionSchema).optional(),

    /** Nesting (Hierarchical States) */
    initial: z.string().optional().describe('Initial child state (if compound)'),
    states: z.record(z.string(), StateNodeSchema).optional(),

    /** Metadata for UI/AI — closed, see the module note on `meta`. */
    meta: strictObject(
      {
        surface: 'this state node meta block',
        history: STATE_MACHINE_STRIP_HISTORY,
      },
      {
        label: z.string().optional(),
        description: z.string().optional(),
        color: z.string().optional(), // For UI diagrams
        // Instructions for AI Agent when in this state
        aiInstructions: z.string().optional().describe('Specific instructions for AI when in this state'),
      },
    ).optional(),
  },
));
export type StateNode = z.input<typeof StateNodeSchema>;

/**
 * Top-Level State Machine Definition
 */
export const StateMachineSchema = lazySchema(() => strictObject(
  {
    surface: 'this state machine',
    history: STATE_MACHINE_STRIP_HISTORY,
    guidance: {
      // XState's `context` holds initial VALUES; this protocol's
      // `contextSchema` declares a SHAPE. Renaming one to the other would tell
      // an author to write their initial values where a schema goes — a
      // confidently wrong prescription of exactly the kind the campaign's
      // fourth finding is about. So: a pointer that states both halves.
      context: '`context` in XState holds the machine\'s INITIAL VALUES. This protocol declares only the context SHAPE, as `contextSchema` — there is no key here for seeding values, so the two are not a rename of each other.',
    },
  },
  {
    id: SnakeCaseIdentifierSchema.describe('Unique Machine ID'),
    description: z.string().optional(),

    /** Context (Memory) Schema */
    contextSchema: z.record(z.string(), z.unknown()).optional().describe('Zod Schema for the machine context/memory'),

    /** Initial State */
    initial: z.string().describe('Initial State ID'),

    /** State Definitions */
    states: z.record(z.string(), StateNodeSchema).describe('State Nodes'),

    /** Global Listeners */
    on: z.record(z.string(), z.union([z.string(), TransitionSchema, z.array(TransitionSchema)])).optional(),
  },
));

export type StateMachineConfig = z.input<typeof StateMachineSchema>;
