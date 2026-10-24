// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { resolveFlowTriggerKind } from './flow-trigger-kind';

/**
 * # An inbound `api` hook's secret, by reference
 *
 * An `api` flow's start node arms an inbound hook that verifies every post
 * against a per-flow HMAC secret (ADR-0041). Until this key the only way to
 * declare that secret in a definition was the literal `config.secret`, so an
 * app package could not ship an `api` flow without publishing its credential:
 * a packaged flow cannot be overlaid, so the write-only flow credential store
 * the metadata save door fills is out of a package's reach.
 *
 * `config.secretRef` names the secret instead of carrying it. The deployment
 * supplies the value under that name, and the automation engine reads it at
 * every inbound post through the same credential resolver a declarative
 * connector's `auth.credentialRef` goes through (ADR-0097 §3): an environment
 * variable of that name in the open tier, a secrets service where the host
 * wires one. A post that arrives while the name resolves to no value is
 * refused as unavailable, never verified against nothing.
 *
 * The reference is NOT a credential: it is served with the definition like any
 * other key, and only the literal `config.secret` is withheld on read.
 *
 * Three refusals, each anchored on the start node's `config`:
 *
 *  - a reference that is not a name — {@link ApiTriggerSecretRefSchema};
 *  - a start node that declares both `secret` and `secretRef` — two sources for
 *    one credential, and no reader could say which one an author meant;
 *  - a reference on a flow that binds no inbound `api` trigger — nothing would
 *    ever read it, so a deployment would fill a name for nothing.
 */

/** The start-node `config` key that names an inbound hook's secret. */
export const API_TRIGGER_SECRET_REF_KEY = 'secretRef';

/**
 * The names ObjectStack owns (Prime Directive #9's `OS_` prefix). A hook secret
 * is handed to whoever signs the posts, so a platform secret named here —
 * `OS_AUTH_SECRET`, say — would be handed out with it.
 */
export const API_TRIGGER_SECRET_REF_RESERVED_PREFIX = 'OS_';

/** An environment-variable-shaped name: a letter or `_`, then letters, digits and `_`. */
const SECRET_REF_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Not {@link API_TRIGGER_SECRET_REF_RESERVED_PREFIX}, in any case. */
const NOT_RESERVED = /^(?![Oo][Ss]_)/;

/**
 * The reference itself: the name a deployment fills, never the secret. A
 * letter or `_` first, then letters, digits and `_` (an environment variable's
 * shape, which is what the open tier resolves it as), and never in the
 * platform's own `OS_` namespace.
 */
export const ApiTriggerSecretRefSchema = z
  .string()
  .regex(
    SECRET_REF_NAME,
    '`config.secretRef` names the inbound hook\'s secret — a letter or `_` first, then letters, digits and `_` ' +
      '(an environment variable\'s name, such as `SRM_HEARTBEAT_SECRET`). Write the name the deployment fills, ' +
      'never the secret itself.',
  )
  // A pattern, not a `refine`, so the published JSON Schema carries the rule too.
  .regex(
    NOT_RESERVED,
    '`config.secretRef` may not name a variable in the platform\'s `OS_` namespace: whoever signs the posts holds ' +
      'the hook secret, so a platform secret named here would be handed out with it. Name a variable of your own ' +
      '(`SRM_HEARTBEAT_SECRET`).',
  )
  .describe(
    'The name of the inbound hook\'s HMAC secret, filled by the deployment and read at every post through the ' +
      'automation credential resolver (an environment variable of that name in the open tier). In place of a ' +
      'literal `secret`, never beside it; not in the `OS_` namespace.',
  );

export type ApiTriggerSecretRef = z.infer<typeof ApiTriggerSecretRefSchema>;

/**
 * The usable reference on a start node's `config`, or `undefined` when the key
 * is absent or does not parse. The one reader the lint rule and the engine
 * share, so neither restates the grammar.
 */
export function apiTriggerSecretRefOf(config: unknown): string | undefined {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(config, API_TRIGGER_SECRET_REF_KEY)) return undefined;
  const parsed = ApiTriggerSecretRefSchema.safeParse((config as Record<string, unknown>)[API_TRIGGER_SECRET_REF_KEY]);
  return parsed.success ? parsed.data : undefined;
}

/** One refusal, at a path relative to the flow (`['nodes', 0, 'config', 'secretRef']`). */
export interface ApiTriggerSecretRefRefusal {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

/**
 * Every refusal the start nodes of `flow` raise for `config.secretRef` — the
 * three in this module's header. Structural, like {@link resolveFlowTriggerKind}:
 * a value that is not a flow yields none.
 */
export function apiTriggerSecretRefRefusals(flow: unknown): ApiTriggerSecretRefRefusal[] {
  if (!flow || typeof flow !== 'object') return [];
  const nodes = (flow as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  const bindsApi = resolveFlowTriggerKind(flow) === 'api';
  const out: ApiTriggerSecretRefRefusal[] = [];
  nodes.forEach((node, index) => {
    if (!node || typeof node !== 'object' || (node as { type?: unknown }).type !== 'start') return;
    const config = (node as { config?: unknown }).config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) return;
    if (!Object.prototype.hasOwnProperty.call(config, API_TRIGGER_SECRET_REF_KEY)) return;
    const path = ['nodes', index, 'config', API_TRIGGER_SECRET_REF_KEY];
    const parsed = ApiTriggerSecretRefSchema.safeParse((config as Record<string, unknown>)[API_TRIGGER_SECRET_REF_KEY]);
    if (!parsed.success) {
      out.push({
        path,
        message: parsed.error.issues[0]?.message ?? '`config.secretRef` must be a string naming the secret.',
      });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'secret')) {
      out.push({
        path,
        message:
          'The start node declares both `config.secret` and `config.secretRef` — two sources for one inbound hook ' +
          'secret. Keep `secretRef` (the deployment fills the name) and remove the literal `secret`, which would ' +
          'publish the credential with the flow.',
      });
      return;
    }
    if (!bindsApi) {
      out.push({
        path,
        message:
          '`config.secretRef` names an inbound hook\'s secret, but this flow binds no inbound `api` trigger, so ' +
          'nothing ever reads it. Declare `type: \'api\'` (or start-node `triggerType: \'api\'`) for a flow that ' +
          'receives signed posts, or remove `secretRef`.',
      });
    }
  });
  return out;
}
