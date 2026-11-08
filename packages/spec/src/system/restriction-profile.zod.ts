// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { APPROVAL_NODE_TYPE, APPROVAL_REVISE_NODE_TYPE } from '../automation/approval.zod';
import { FlowNodeAction } from '../automation/flow.zod';
import { SEMVER_2_0_0_VERSION_PATTERN } from '../kernel/version-grammar';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * The plugin node types whose contracts the spec itself declares
 * (`automation/approval.zod.ts`): the ADR-0019 approval node and its ADR-0044
 * revise window, both registered by `plugin-approvals`. Not engine built-ins,
 * so not {@link FlowNodeAction} ids; whether an environment runs them depends
 * on whether it installs that plugin, which is exactly what a profile states.
 */
const SPEC_DECLARED_PLUGIN_NODE_TYPES = [APPROVAL_NODE_TYPE, APPROVAL_REVISE_NODE_TYPE] as const;

/**
 * The flow node types a restriction profile can list in
 * `allowedFlowNodeTypes` — the profile's own vocabulary, derived from two
 * spec declarations and never hand-copied:
 *
 * - every {@link FlowNodeAction} id, the engine's built-in seed set
 *   (`FLOW_BUILTIN_NODE_TYPES` is the same list), so a built-in the registry
 *   gains is listable the release it lands; and
 * - the plugin node types whose contracts the spec declares: `approval` and
 *   `approval_revise`, which a hosted plan or a self-hosted kernel runs only
 *   when it installs the approvals plugin.
 *
 * `FlowNodeAction` itself is not widened: it is the set of executors the
 * engine registers at boot, and lint reads it as that.
 *
 * Disjoint from the structural types a reader always allows (`start` / `end`
 * aside, which are `FlowNodeAction` ids): the ADR-0031 containers `parallel`
 * and `try_catch` run on every engine, so a profile never lists them. `loop`,
 * the third container, is a `FlowNodeAction` id and so stays listable and
 * judged by the list — a known asymmetry, kept because moving it out of the
 * enum would be a protocol removal.
 */
export const RestrictionProfileNodeType = z.enum([
  ...FlowNodeAction.options,
  ...SPEC_DECLARED_PLUGIN_NODE_TYPES,
]).describe(
  'Flow node types a restriction profile can list: every FlowNodeAction id plus the spec-declared plugin node '
  + 'types approval and approval_revise',
);
export type RestrictionProfileNodeType = z.input<typeof RestrictionProfileNodeType>;

/**
 * # Restriction Profile
 *
 * What a target environment does NOT let metadata do, published by that
 * environment as data (objectstack-ai/cloud#3659, ruling A: one source of
 * metadata-authoring knowledge for every build channel — the published
 * `@objectstack/skills` + `@objectstack/spec` — where a hosted environment
 * differs from a local one only by a restriction profile).
 *
 * ## An absent profile means no restriction
 *
 * The local / open default is **no profile at all**, not a profile with every
 * dimension switched on. A reader that holds no profile for an environment
 * applies no restriction; a reader that holds one applies every dimension
 * below, because every dimension is required. There is no per-dimension
 * "absent = allowed": a profile that omits a dimension is refused at parse, so
 * an environment can never publish a restriction it did not spell out.
 *
 * ## What it is
 *
 * - **Data, not a gate.** This schema is the shape only. Nothing in
 *   `@objectstack/spec` enforces it: `os validate --target` reads it to refuse
 *   metadata before a deploy, and the environment publishes it.
 * - **Closed.** Unknown keys are refused at every level, so a dimension a
 *   reader does not know cannot be published and silently ignored.
 * - **The node vocabulary is the spec's own.** `allowedFlowNodeTypes` is an
 *   array of {@link RestrictionProfileNodeType}, derived — never hand-copied —
 *   from the spec's own node type declarations: see there.
 * - **Code is two dimensions.** `allowCode` governs code that runs in the
 *   process (a handler-form hook or job, named `functions`, code plugins, the
 *   `script` flow node); `allowSandboxedJs` governs the sandboxed JavaScript
 *   bodies (`language: 'js'`) that travel inside the metadata itself. A
 *   pure-formula expression body (`language: 'expression'`) is neither.
 */
export const RestrictionProfileSchema = lazySchema(() => strictObject(
  {
    surface: 'a restriction profile',
    history:
      'This shape is new and strict from birth: an unknown key here was never accepted.',
    aliases: {
      codeAllowed: 'allowCode',
      allowHooks: 'allowCode',
      allowScripts: 'allowCode',
      allowPlugins: 'allowCode',
      allowSandboxedHooks: 'allowSandboxedJs',
      allowSandboxedBodies: 'allowSandboxedJs',
      allowScriptBodies: 'allowSandboxedJs',
      allowJs: 'allowSandboxedJs',
      sandboxedJsAllowed: 'allowSandboxedJs',
      scheduledAutomationAllowed: 'allowScheduledAutomation',
      allowSchedules: 'allowScheduledAutomation',
      allowCron: 'allowScheduledAutomation',
      allowJobs: 'allowScheduledAutomation',
      flowNodeTypes: 'allowedFlowNodeTypes',
      allowedNodeTypes: 'allowedFlowNodeTypes',
      nodeTypes: 'allowedFlowNodeTypes',
      specVersion: 'versions',
      skillsVersion: 'versions',
      version: 'versions',
    },
  },
  {
    /**
     * Whether metadata that carries in-process code is allowed: a lifecycle
     * hook or a background job in its `handler` form (a named function that
     * travels in the artifact's runtime module, not in the metadata), named
     * handler `functions`, code plugins, and the `script` flow node.
     *
     * `false` refuses every one of them; `true` allows them. A sandboxed
     * JavaScript `body` is not governed here but by `allowSandboxedJs`, and an
     * expression `body` by neither key.
     *
     * ## Reader rule
     *
     * A hook or job is judged by the body it runs: when it carries a `body`,
     * the body wins over `handler` (as at bind), so only a hook or job with no
     * `body` is in-process code. Besides those, a reader takes what is code
     * from the spec's one classification of a package body's keys,
     * `UNMANAGED_INSTALL_KEY_DISPOSITIONS` (`@objectstack/spec/kernel`,
     * disposition `code`), and a key that carries nothing refuses nothing.
     * `devPlugins` is not judged by `allowCode`: it is loaded only by a local
     * development boot, and `os build` leaves it out of the artifact a target
     * installs, so it never reaches a target; `UNMANAGED_INSTALL_KEY_DISPOSITIONS`
     * still classifies it as `code` for an unmanaged install.
     * A `script` flow node is also subject to this rule (see
     * `allowedFlowNodeTypes`).
     */
    allowCode: z
      .boolean()
      .describe(
        'Whether metadata that carries in-process code is allowed (handler-form hooks and jobs, named handler functions, '
        + 'code plugins, the script flow node); sandboxed JS bodies are governed by allowSandboxedJs',
      ),

    /**
     * Whether a sandboxed JavaScript body is allowed: every L2 body
     * (`language: 'js'`, the `ScriptBodySchema` member of `HookBodySchema`)
     * wherever metadata carries one — a lifecycle hook's `body`, an action's
     * `body` and a background job's `body`.
     *
     * Such a body is metadata, not code that travels beside it: it rides in
     * the artifact JSON and runs in the QuickJS sandbox under its declared
     * `capabilities`, so a kernel that binds no runtime module still binds it.
     * It is its own dimension because established platforms gate sandboxed
     * customer code separately from in-process code, and often per plan.
     *
     * `false` refuses every such body; `true` allows them. An expression body
     * (`language: 'expression'`, L1) is a pure formula and is governed by
     * neither this key nor `allowCode`. A hosted kernel that binds sandboxed
     * bodies but no runtime module publishes `allowCode: false` with
     * `allowSandboxedJs: true`.
     *
     * ## Reader rule
     *
     * A job is scheduled automation first: under
     * `allowScheduledAutomation: false` every job is refused by that rule
     * alone, whatever its body, so a reader judges a job's body only when
     * scheduled automation is allowed.
     */
    allowSandboxedJs: z
      .boolean()
      .describe(
        "Whether a sandboxed JavaScript body (language 'js') is allowed on hooks, actions and jobs; "
        + 'expression bodies are governed by neither this key nor allowCode',
      ),

    /**
     * Whether scheduled automation is allowed: a flow of `type: 'schedule'`
     * and a background `jobs` entry run on a cron, interval or once schedule.
     *
     * `false` refuses both; `true` allows them.
     */
    allowScheduledAutomation: z
      .boolean()
      .describe(
        "Whether scheduled automation is allowed (flows of type 'schedule' and scheduled background jobs)",
      ),

    /**
     * The flow node types a flow may use, from the profile's own vocabulary
     * ({@link RestrictionProfileNodeType}): every built-in
     * {@link FlowNodeAction} id plus the plugin node types whose contracts the
     * spec declares (`approval`, `approval_revise`). A type in the vocabulary
     * that is not listed is forbidden; a type the vocabulary does not name is
     * refused here.
     *
     * An empty array allows no node type of the vocabulary.
     *
     * ## Reader rules
     *
     * A reader judges every node of every flow, at every region depth, by
     * these rules, and names exactly one dimension per refused node:
     *
     * - `start` / `end` are structural and always allowed, listed or not: the
     *   engine runs them without an executor, so a profile never has to list
     *   them for a flow to run at all.
     * - The ADR-0031 containers `parallel` and `try_catch` are structural too
     *   and always allowed: engine built-ins that are not `FlowNodeAction` ids,
     *   so no profile could list them. A container only holds regions, and
     *   every node inside them is still judged. (`loop`, the third container,
     *   is a `FlowNodeAction` id and is judged by this list.)
     * - A `script` node calls a registered function, so it is also subject to
     *   `allowCode`: under `allowCode: false` it is refused by `allowCode`
     *   alone, and under `allowCode: true` by this list.
     * - `approval` / `approval_revise` are in this vocabulary, so this list
     *   judges them: an environment that runs the approvals plugin lists
     *   them, and one that does not leaves them out.
     * - A node type outside the profile's vocabulary cannot be named by this
     *   list (a code plugin the spec declares no contract for registered it),
     *   so `allowCode` governs it: refused under `allowCode: false`, allowed
     *   under `allowCode: true`.
     */
    allowedFlowNodeTypes: z
      .array(RestrictionProfileNodeType)
      .describe(
        'Flow node types a flow may use (FlowNodeAction ids plus the spec-declared plugin node types approval and '
        + 'approval_revise); a type of that vocabulary not listed is forbidden',
      ),

    /**
     * The `@objectstack/spec` and `@objectstack/skills` versions the
     * environment runs, so a local author can see that they build against a
     * different version than the target.
     */
    versions: strictObject(
      {
        surface: 'a restriction profile `versions` block',
        history:
          'This shape is new and strict from birth: an unknown key here was never accepted.',
        aliases: {
          specVersion: 'spec',
          skillsVersion: 'skills',
        },
      },
      {
        spec: z
          .string()
          .regex(SEMVER_2_0_0_VERSION_PATTERN)
          .describe('The @objectstack/spec version the environment runs (SemVer 2.0.0, e.g. 18.4.0)'),
        skills: z
          .string()
          .regex(SEMVER_2_0_0_VERSION_PATTERN)
          .describe('The @objectstack/skills version the environment runs (SemVer 2.0.0, e.g. 18.4.0)'),
      },
    ).describe('The @objectstack/spec and @objectstack/skills versions the environment runs'),
  },
).describe(
  'What a target environment does not let metadata do, published by that environment; '
  + 'an absent profile means no restriction',
));

export type RestrictionProfile = z.input<typeof RestrictionProfileSchema>;
