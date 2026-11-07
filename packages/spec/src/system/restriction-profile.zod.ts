// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { FlowNodeAction } from '../automation/flow.zod';
import { SEMVER_2_0_0_VERSION_PATTERN } from '../kernel/version-grammar';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

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
 *   array of {@link FlowNodeAction} — the built-in node type registry in
 *   `automation/flow.zod.ts` (`FLOW_BUILTIN_NODE_TYPES` is the same list) —
 *   so a type the registry gains is allowable the release it lands and a type
 *   it does not name is refused here, with no second list to keep in step.
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
     * Whether metadata that carries code is allowed: object lifecycle `hooks`,
     * named handler `functions`, and code plugins.
     *
     * `false` refuses every one of them; `true` allows them.
     *
     * ## Reader rule
     *
     * Besides `hooks`, a reader takes what is code from the spec's one
     * classification of a package body's keys, `UNMANAGED_INSTALL_KEY_DISPOSITIONS`
     * (`@objectstack/spec/kernel`, disposition `code`), and a key that carries
     * nothing refuses nothing. `devPlugins` is not judged by `allowCode`: it
     * is loaded only by a local development boot, and `os build` leaves it out
     * of the artifact a target installs, so it never reaches a target;
     * `UNMANAGED_INSTALL_KEY_DISPOSITIONS` still classifies it as `code` for an
     * unmanaged install. A `script` flow node is also subject to this rule (see
     * `allowedFlowNodeTypes`).
     */
    allowCode: z
      .boolean()
      .describe(
        'Whether metadata that carries code is allowed (object lifecycle hooks, named handler functions, code plugins)',
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
     * The built-in flow node types a flow may use, read from the spec's node
     * registry ({@link FlowNodeAction}). A built-in type not listed is
     * forbidden; a type the registry does not name is refused here.
     *
     * An empty array allows no built-in node type.
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
     * - A node type outside this vocabulary exists because a code plugin
     *   registered it, so this list cannot name it and `allowCode` governs it:
     *   refused under `allowCode: false`, allowed under `allowCode: true`.
     */
    allowedFlowNodeTypes: z
      .array(FlowNodeAction)
      .describe(
        'Built-in flow node types a flow may use (FlowNodeAction ids); a built-in type not listed is forbidden',
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
