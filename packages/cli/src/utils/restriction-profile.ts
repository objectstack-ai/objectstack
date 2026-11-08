// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate --target` — judge a stack against a target environment's
 * restriction profile (`RestrictionProfileSchema`, `@objectstack/spec/system`).
 *
 * One source of metadata-authoring knowledge serves every build channel, and a
 * hosted environment differs from a local one only by a restriction profile it
 * publishes as data (objectstack-ai/cloud#3659, ruling A). This module is the
 * reader that lets a local author see, before a deploy, what that profile
 * refuses. Three parts, each one function:
 *
 *  - {@link loadRestrictionProfile} reads the profile from a file and parses it
 *    with the spec's own schema. An invalid profile is REFUSED, naming the
 *    schema issue: a reader that judged against half a profile would be the
 *    lenient consumer Prime Directive 12 forbids.
 *  - {@link judgeRestrictionProfile} refuses every item of the stack the
 *    profile forbids, one row per item, each naming the item and the ONE
 *    dimension (`rule`) that refuses it.
 *  - {@link restrictionProfileVersionDrift} WARNS — never refuses — when the
 *    `@objectstack/spec` / `@objectstack/skills` the project builds against is
 *    not the version the target runs.
 *
 * ## What each dimension reads — the spec's vocabulary, never a list of ours
 *
 *  - `allowCode` — what `RestrictionProfileSchema` itself says it covers:
 *    in-process code — a `hooks` or `jobs` entry with no `body` that names a
 *    `handler` (the handler runs), named handler `functions` and code
 *    plugins. The non-collection keys are read from the spec's one
 *    classification of what is code, `UNMANAGED_INSTALL_KEY_DISPOSITIONS`
 *    (`@objectstack/spec/kernel`, disposition `code`), the table
 *    `defineStack`'s unmanaged-install refusal and the install door's planner
 *    already share; `hooks` and `jobs` are collections, so they are named
 *    here, as the profile's own docblock names them. A key that carries nothing (`functions: {}`, `plugins: []`) refuses nothing — the
 *    same `unmanagedInstallValueCarries` test that table's readers apply.
 *    `devPlugins` is not read: `os build` leaves it out of the artifact, so it
 *    never reaches a target (`NEVER_REACHES_TARGET` below).
 *  - `allowSandboxedJs` — every sandboxed JavaScript body (`language: 'js'`):
 *    a `hooks[].body`, an `actions[].body` on a `type: 'script'` action (the
 *    only type the runtime runs a body for; top-level and embedded on
 *    `objects[].actions`) and a `jobs[].body`. A body wins over `handler`, as
 *    at bind, so a hook or job is judged by its body when it has one. An
 *    expression body (`language: 'expression'`) is a pure formula: neither
 *    code dimension reads it.
 *  - `allowScheduledAutomation` — a flow of `type: 'schedule'` and every
 *    `jobs` entry (a job always carries a cron, interval or once `schedule`).
 *    It is judged first: under `allowScheduledAutomation: false` a job is
 *    refused by that rule alone, so its body or handler is judged only when
 *    scheduled automation is allowed.
 *  - `allowedFlowNodeTypes` — every node of every flow, at every region depth
 *    (`collectFlowGraphs`, the walk the flow schema's own id rule uses).
 *
 * ## The reader rules (contract review of the profile schema, ③/④)
 *
 *  1. `start` / `end` (`FLOW_STRUCTURAL_NODE_TYPES`) are always allowed: the
 *     engine handles them without an executor, and a profile that had to list
 *     them to allow any flow at all would be a trap. So are the ADR-0031
 *     containers `parallel` and `try_catch` ({@link FLOW_CONTAINER_NODE_TYPES}):
 *     engine built-ins that are not `FlowNodeAction` ids, so no profile could
 *     name them, and reader rule 2 would otherwise refuse them as code. A
 *     container only holds regions; every node inside it is still judged.
 *     (`loop`, the third container, IS a `FlowNodeAction` id, so
 *     `allowedFlowNodeTypes` judges it like any built-in.)
 *  2. A node type outside the profile's vocabulary
 *     (`RestrictionProfileNodeType`: the `FlowNodeAction` built-ins plus the
 *     plugin node types whose contracts the spec declares, `approval` and
 *     `approval_revise`) cannot be named by `allowedFlowNodeTypes`, so it is
 *     governed by `allowCode`, and its refusal names that rule. The approval
 *     pair IS in the vocabulary, so the list judges it.
 *  3. A `script` node calls a registered function, so under `allowCode: false`
 *     it is refused by `allowCode` alone — never by both rules.
 *
 * Every row carries exactly one `rule`, so an author fixes one thing per row.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import {
  FLOW_STRUCTURAL_NODE_TYPES,
  PARALLEL_NODE_TYPE,
  TRY_CATCH_NODE_TYPE,
  collectFlowGraphs,
  type FlowNodeParsed,
} from '@objectstack/spec/automation';
import { UNMANAGED_INSTALL_KEY_DISPOSITIONS, unmanagedInstallValueCarries } from '@objectstack/spec/kernel';
import { RestrictionProfileNodeType, RestrictionProfileSchema } from '@objectstack/spec/system';
import type { z } from 'zod';

import { artifactPackages } from './artifact-packages.js';

/** A parsed restriction profile. */
export type ParsedRestrictionProfile = z.infer<typeof RestrictionProfileSchema>;

/** The profile dimension that refuses an item. */
export type RestrictionRule = 'allowCode' | 'allowSandboxedJs' | 'allowScheduledAutomation' | 'allowedFlowNodeTypes';

/** One item of the stack the target's restriction profile refuses. */
export interface RestrictionRefusal {
  /** The ONE profile dimension that refuses the item. */
  rule: RestrictionRule;
  /** The item, named, e.g. `hook 'lead_audit'` or `flow 'nightly' › node 'call_out' (script)`. */
  where: string;
  /** Where the item sits in the parsed stack, e.g. `hooks[0]` or `packages[1].manifest.flows[0].nodes[2]`. */
  path: string;
  /** One sentence: what the item is and why the profile refuses it. */
  message: string;
}

/** A version the project builds against that is not the one the target runs. */
export interface RestrictionVersionDrift {
  /** The package compared. */
  package: '@objectstack/spec' | '@objectstack/skills';
  /** The version the project resolves, or `null` when the project does not install the package. */
  local: string | null;
  /** The version the target's profile says it runs. */
  target: string;
  /** Ready-to-print warning. */
  message: string;
}

/**
 * Whether `--target` names a URL rather than a file.
 *
 * No environment publishes its restriction profile at a defined address yet,
 * so the URL form is refused rather than fetched from a guessed route.
 */
function isUrl(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
}

/**
 * Read and parse the restriction profile `--target` names. Throws a plain
 * `Error` naming the file and the problem when the target is a URL, missing,
 * not JSON, or not a valid restriction profile.
 */
export function loadRestrictionProfile(
  target: string,
  cwd: string = process.cwd(),
): { profile: ParsedRestrictionProfile; file: string } {
  if (isUrl(target)) {
    throw new Error(
      `--target ${target}: a target environment does not publish its restriction profile at a defined `
      + 'address yet, so this command cannot fetch one. Save the environment\'s restriction profile as a '
      + 'JSON file and pass its path: os validate --target ./restriction-profile.json',
    );
  }
  const file = isAbsolute(target) ? target : resolve(cwd, target);
  if (!existsSync(file)) {
    throw new Error(`--target ${target}: no restriction profile file at ${file}.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `--target ${target}: ${file} is not JSON (${(error as Error).message}). `
      + 'A restriction profile file is one JSON object.',
    );
  }
  const parsed = RestrictionProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `--target ${target}: ${file} is not a valid restriction profile (RestrictionProfileSchema, `
      + `@objectstack/spec/system) — ${issues}`,
    );
  }
  return { profile: parsed.data, file };
}

/**
 * Reader rule 1, second half: the ADR-0031 containers the engine ships that
 * `FlowNodeAction` does not name, read off the spec's own type-id constants.
 * Structural like `start` / `end`: always allowed, while the nodes in their
 * regions are judged (`collectFlowGraphs` walks into every region).
 */
const FLOW_CONTAINER_NODE_TYPES: readonly string[] = [PARALLEL_NODE_TYPE, TRY_CATCH_NODE_TYPE];

/** Reader rule 2: the node types `allowedFlowNodeTypes` can name — the spec's derived profile vocabulary. */
const PROFILE_NODE_TYPES: ReadonlySet<string> = new Set(RestrictionProfileNodeType.options);

/**
 * The keys the spec classifies as code that never reach a target, so
 * `allowCode` does not read them. `devPlugins` is loaded only by a local
 * development boot (`os dev` / `os serve --dev`, off the config it loads), and
 * `os build` leaves it out of the artifact that `os package publish` and
 * `os deploy` send — so a target never runs it, whatever its profile says.
 * The spec table itself keeps `devPlugins: 'code'`: an unmanaged install still
 * refuses it, which is a different question from what a target runs.
 */
const NEVER_REACHES_TARGET: ReadonlySet<string> = new Set(['devPlugins']);

/** The non-collection keys the spec classifies as code, less the ones that never reach a target. */
const CODE_KEYS: readonly string[] = Object.entries(UNMANAGED_INSTALL_KEY_DISPOSITIONS)
  .filter(([key, disposition]) => disposition === 'code' && !NEVER_REACHES_TARGET.has(key))
  .map(([key]) => key);

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag => !!value && typeof value === 'object' && !Array.isArray(value);

const nameOf = (item: unknown, fallback: string): string => {
  if (typeof item === 'string' && item !== '') return item;
  if (isBag(item)) {
    for (const key of ['name', 'id']) {
      const value = item[key];
      if (typeof value === 'string' && value !== '') return value;
    }
    if (isBag(item.manifest)) return nameOf(item.manifest, fallback);
  }
  return fallback;
};

const CODE_OFF = 'the target\'s restriction profile sets `allowCode: false`';
const SCHEDULE_OFF = 'the target\'s restriction profile sets `allowScheduledAutomation: false`';
const SANDBOX_OFF = 'the target\'s restriction profile sets `allowSandboxedJs: false`';

/** The `language` of an item's `body`, or `undefined` when it carries none. */
const bodyLanguage = (item: unknown): unknown => (isBag(item) && isBag(item.body) ? item.body.language : undefined);

/** The items one code-carrying key holds, each named. */
function codeItems(key: string, value: unknown): Array<{ label: string; at: string }> {
  if (key === 'functions') {
    if (Array.isArray(value)) {
      return value.map((entry, i) => ({ label: `function '${nameOf(entry, `functions[${i}]`)}'`, at: `functions[${i}]` }));
    }
    if (isBag(value)) return Object.keys(value).map((name) => ({ label: `function '${name}'`, at: `functions.${name}` }));
  }
  if (key === 'plugins' && Array.isArray(value)) {
    return value.map((entry, i) => ({ label: `plugin '${nameOf(entry, `${key}[${i}]`)}'`, at: `${key}[${i}]` }));
  }
  return [{ label: `\`${key}\``, at: key }];
}

/**
 * Every item of the parsed stack the profile refuses, one row per item.
 *
 * Walked the way the other CLI walks are: each `packages[]` entry's body, or
 * the stack's own collections (and its `manifest`) when it declares no
 * packages.
 */
export function judgeRestrictionProfile(
  parsed: Record<string, unknown>,
  profile: ParsedRestrictionProfile,
): RestrictionRefusal[] {
  const entries = artifactPackages(parsed);
  const subjects: Array<{ bag: Bag; at: string; manifest?: Bag }> = entries.length > 0
    ? entries.map(({ index, body }) => ({ bag: body, at: `packages[${index}].manifest.` }))
    : [{ bag: parsed, at: '', manifest: isBag(parsed.manifest) ? parsed.manifest : undefined }];
  const allowed = new Set<string>(profile.allowedFlowNodeTypes);
  const rows: RestrictionRefusal[] = [];

  for (const { bag, at, manifest } of subjects) {
    // ── hooks: judged by the body they run — sandboxed JS, an expression, or (no body) the handler ──
    if (Array.isArray(bag.hooks)) {
      bag.hooks.forEach((hook, i) => {
        const where = `hook '${nameOf(hook, `hooks[${i}]`)}'`;
        const path = `${at}hooks[${i}]`;
        const language = bodyLanguage(hook);
        if (language === 'js') {
          if (!profile.allowSandboxedJs) {
            rows.push({
              rule: 'allowSandboxedJs',
              where,
              path,
              message: `An object lifecycle hook's \`body\` is sandboxed JavaScript, and ${SANDBOX_OFF}.`,
            });
          }
        } else if (language === undefined && isBag(hook) && hook.handler !== undefined && !profile.allowCode) {
          // A handler may still be an inline function before `os build`, so presence is the test.
          rows.push({
            rule: 'allowCode',
            where,
            path,
            message: `An object lifecycle hook with no \`body\` runs its \`handler\`, which is code, and ${CODE_OFF}.`,
          });
        }
      });
    }

    // ── actions: a sandboxed JavaScript body, top-level or embedded on an object ──
    if (!profile.allowSandboxedJs) {
      // `defineStack` copies each top-level action bound by `objectName` into that
      // object's `actions` and keeps it at the top level too, so a built stack
      // carries it twice. It is judged once, at its top-level path; the stack
      // schema already refuses an action key authored in both positions.
      const bound = new Set<string>();
      if (Array.isArray(bag.actions)) {
        for (const action of bag.actions) {
          if (isBag(action) && typeof action.objectName === 'string') bound.add(`${action.objectName}:${nameOf(action, '')}`);
        }
      }
      const actionLists: Array<{ list: unknown; prefix: string; owner?: string }> = [
        { list: bag.actions, prefix: `${at}actions` },
      ];
      if (Array.isArray(bag.objects)) {
        bag.objects.forEach((object, o) => {
          if (isBag(object)) {
            actionLists.push({ list: object.actions, prefix: `${at}objects[${o}].actions`, owner: nameOf(object, '') });
          }
        });
      }
      for (const { list, prefix, owner } of actionLists) {
        if (!Array.isArray(list)) continue;
        list.forEach((action, i) => {
          if (bodyLanguage(action) !== 'js') return;
          // The runtime binds an action body only for `type: 'script'` (the schema's default type).
          if (isBag(action) && action.type !== undefined && action.type !== 'script') return;
          if (owner !== undefined && bound.has(`${owner}:${nameOf(action, '')}`)) return;
          rows.push({
            rule: 'allowSandboxedJs',
            where: `action '${nameOf(action, `actions[${i}]`)}'`,
            path: `${prefix}[${i}]`,
            message: `An action's \`body\` is sandboxed JavaScript, and ${SANDBOX_OFF}.`,
          });
        });
      }
    }

    // ── allowCode: the keys the spec classifies as code ──
    if (!profile.allowCode) {
      const scopes: Array<{ keys: Bag; prefix: string }> = [{ keys: bag, prefix: at }];
      if (manifest) scopes.push({ keys: manifest, prefix: `${at}manifest.` });
      for (const { keys, prefix } of scopes) {
        for (const key of CODE_KEYS) {
          const value = keys[key];
          if (!unmanagedInstallValueCarries(value)) continue;
          for (const item of codeItems(key, value)) {
            rows.push({
              rule: 'allowCode',
              where: item.label,
              path: `${prefix}${item.at}`,
              message: `\`${key}\` is code, and ${CODE_OFF}.`,
            });
          }
        }
      }
    }

    // ── jobs: scheduled automation first; then the body (sandboxed JS) or, with none, the handler (code) ──
    if (Array.isArray(bag.jobs)) {
      bag.jobs.forEach((job, i) => {
        const where = `job '${nameOf(job, `jobs[${i}]`)}'`;
        const path = `${at}jobs[${i}]`;
        if (!profile.allowScheduledAutomation) {
          rows.push({
            rule: 'allowScheduledAutomation',
            where,
            path,
            message: `A background job runs on a schedule, and ${SCHEDULE_OFF}.`,
          });
          return;
        }
        if (bodyLanguage(job) === 'js') {
          if (!profile.allowSandboxedJs) {
            rows.push({
              rule: 'allowSandboxedJs',
              where,
              path,
              message: `A background job's \`body\` is sandboxed JavaScript, and ${SANDBOX_OFF}.`,
            });
          }
          return;
        }
        const handler = isBag(job) ? job.handler : undefined;
        if (typeof handler === 'string' && handler !== '' && !profile.allowCode) {
          rows.push({
            rule: 'allowCode',
            where,
            path,
            message: `A background job with no \`body\` runs its \`handler\`, which is code, and ${CODE_OFF}.`,
          });
        }
      });
    }

    // ── flows: the schedule dimension, then every node ──
    if (!Array.isArray(bag.flows)) continue;
    bag.flows.forEach((flow, f) => {
      if (!isBag(flow)) return;
      const flowName = nameOf(flow, `flows[${f}]`);
      const flowPath = `${at}flows[${f}]`;
      if (!profile.allowScheduledAutomation && flow.type === 'schedule') {
        rows.push({
          rule: 'allowScheduledAutomation',
          where: `flow '${flowName}'`,
          path: flowPath,
          message: `A flow of \`type: 'schedule'\` is scheduled automation, and ${SCHEDULE_OFF}.`,
        });
      }
      const graphs = collectFlowGraphs(flow as { nodes?: readonly FlowNodeParsed[] });
      for (const graph of graphs) {
        graph.nodes.forEach((node, n) => {
          const type = (node as { type?: unknown }).type;
          if (typeof type !== 'string') return;
          const refusal = judgeNodeType(type, profile.allowCode, allowed);
          if (!refusal) return;
          const id = typeof (node as { id?: unknown }).id === 'string' ? (node as { id: string }).id : `nodes[${n}]`;
          const scope = graph.scope ? ` › ${graph.scope}` : '';
          rows.push({
            rule: refusal.rule,
            where: `flow '${flowName}'${scope} › node '${id}' (${type})`,
            path: [flowPath, ...graph.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`)), `.nodes[${n}]`]
              .join(''),
            message: refusal.message,
          });
        });
      }
    });
  }
  return rows;
}

/** The one rule (if any) that refuses a node of `type` — the reader rules in the module header. */
function judgeNodeType(
  type: string,
  allowCode: boolean,
  allowed: ReadonlySet<string>,
): { rule: RestrictionRule; message: string } | undefined {
  // Reader rule 1: structural types and the ADR-0031 containers are always allowed.
  if (FLOW_STRUCTURAL_NODE_TYPES.includes(type) || FLOW_CONTAINER_NODE_TYPES.includes(type)) return undefined;
  // Reader rule 3: a `script` node calls code; under `allowCode: false` that rule alone refuses it.
  if (type === 'script' && !allowCode) {
    return {
      rule: 'allowCode',
      message: `A \`script\` node calls a registered function, which is code, and ${CODE_OFF}.`,
    };
  }
  // Reader rule 2: a type outside the profile vocabulary is governed by `allowCode`.
  if (!PROFILE_NODE_TYPES.has(type)) {
    if (allowCode) return undefined;
    return {
      rule: 'allowCode',
      message:
        `Node type '${type}' is not in the restriction profile's node vocabulary (the built-in FlowNodeAction `
        + 'ids and the plugin node types the spec declares), so a code plugin registers it, '
        + '`allowedFlowNodeTypes` cannot name it and it is governed by `allowCode`; '
        + `${CODE_OFF}.`,
    };
  }
  if (allowed.has(type)) return undefined;
  return {
    rule: 'allowedFlowNodeTypes',
    message: `Node type '${type}' is not in the target's \`allowedFlowNodeTypes\`.`,
  };
}

/** The installed version of `name`, resolved by `from` (a directory's `package.json` or a module URL), or `null`. */
function resolveInstalledVersion(name: string, from: string): string | null {
  try {
    // Read off disk rather than `require`d: a module-cached manifest would outlive the install it describes.
    const pkg = JSON.parse(readFileSync(createRequire(from).resolve(`${name}/package.json`), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * The version warnings for a profile: one per package whose locally resolved
 * version is not the one the target runs. Never a refusal.
 *
 * Resolved from the project directory (the config's), the way the protocol
 * drift advisory resolves the app's spec; `@objectstack/spec` falls back to
 * the copy this CLI validates with when the project does not hoist one.
 * `@objectstack/skills` has no fallback — the CLI does not depend on it — so a
 * project without it gets a warning saying the version could not be compared.
 */
export function restrictionProfileVersionDrift(
  profile: ParsedRestrictionProfile,
  projectDir: string,
): RestrictionVersionDrift[] {
  const out: RestrictionVersionDrift[] = [];
  const pairs = [
    {
      package: '@objectstack/spec' as const,
      target: profile.versions.spec,
      local: resolveInstalledVersion('@objectstack/spec', join(projectDir, 'package.json'))
        ?? resolveInstalledVersion('@objectstack/spec', import.meta.url),
    },
    {
      package: '@objectstack/skills' as const,
      target: profile.versions.skills,
      local: resolveInstalledVersion('@objectstack/skills', join(projectDir, 'package.json')),
    },
  ];
  for (const { package: name, target, local } of pairs) {
    if (local === target) continue;
    out.push({
      package: name,
      local,
      target,
      message: local === null
        ? `${name} is not installed in this project, so its version could not be compared with the `
          + `${target} the target runs.`
        : `This project builds against ${name} ${local}, and the target runs ${target}: `
          + 'what passes here may not be what the target accepts.',
    });
  }
  return out;
}
