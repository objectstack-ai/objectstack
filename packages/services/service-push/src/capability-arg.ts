// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What `PushServicePlugin` is constructed with on a served boot: the stack
 * definition's `push` key, parsed by `PushServiceConfigSchema` — and refused,
 * before the kernel boots, when this package can never deliver through it.
 *
 * ## Why this lives here, and not in `@objectstack/cli` or `@objectstack/core`
 *
 * The same reason `resolveSmsCapabilityArg` lives in `@objectstack/service-sms`.
 * `objectstack serve` (`@objectstack/cli`) and `@objectstack/verify`'s
 * `bootStack` both build the providers a stack's `requires` names through ONE
 * rule, `resolveCapabilityArgument` (`@objectstack/core`), and this package
 * depends on core, so core cannot import it. The reader sits beside the
 * transports it refuses against, and `resolveCapabilityArgument` reads it off
 * this module, the module every boot already loads to reach
 * `PushServicePlugin`. ⛔ Never a second copy beside a reader.
 *
 * ## What it refuses, and why at this point
 *
 * `PushServicePlugin.init` refuses the same two things. The reader refuses
 * them first, when the capability loop builds the plugin's argument, so the
 * operator meets the refusal as the `push` capability failing to start, with
 * the reason, before any service is registered:
 *
 *  - **The relay transport on a deployment that declared it has no control
 *    plane** (`OS_CLOUD_URL=off`, …), the relay being also what an absent
 *    `push` key and an empty one read as. The relay is hosted by the cloud, so
 *    nothing could ever deliver through it there; booting would mount the
 *    `push` channel and every push would look sent.
 *    ({@link PUSH_RELAY_AIR_GAPPED_MESSAGE}.) Anywhere else the relay boots,
 *    bound or not: an unbound server binds while it runs.
 *  - **A configuration the schema refuses**, an inline secret first among
 *    them. `defineStack` refuses it at authoring, but a compiled artifact or a
 *    plain config object reaches the boot without passing it, so the boot
 *    parses again. The refusal names each path and the schema's own guidance,
 *    never the value: the value may be the secret itself.
 *
 * No environment variable is read. The vendor blocks carry no secret, and each
 * `credentialRef` names the environment variable (in the open tier) the
 * transport reads when it first signs.
 */

import { isControlPlaneDeclined } from '@objectstack/core';
import { PushServiceConfigSchema, type PushServiceConfigParsed } from '@objectstack/spec/system';
import { PUSH_RELAY_AIR_GAPPED_MESSAGE } from './push-plugin.js';

/** Constructor options for `PushServicePlugin`, as the capability loop builds them. */
export interface PushCapabilityArg {
  options: { config: PushServiceConfigParsed };
}

/**
 * Resolve `PushServicePlugin` constructor options from the stack definition's
 * `push` key. Throws on a relay configuration (absent and `{}` included) when
 * the deployment declared it has no control plane, and on any configuration
 * `PushServiceConfigSchema` refuses.
 */
export function resolvePushCapabilityArg(cfgPush: unknown = {}): PushCapabilityArg {
  const raw = cfgPush ?? {};
  const verdict = PushServiceConfigSchema.safeParse(raw);
  if (!verdict.success) {
    const issues = leafIssues(verdict.error.issues, raw)
      .map((issue) => `push${issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('')}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `the stack's push configuration cannot be delivered through, so the push service is not started: ${issues}`,
    );
  }
  const config = verdict.data;
  if (config.transport === 'relay' && isControlPlaneDeclined()) {
    throw new Error(
      `${PUSH_RELAY_AIR_GAPPED_MESSAGE} On objectstack serve this is the stack definition's push key, and an absent `
      + 'key reads as the relay too.',
    );
  }
  return { options: { config } };
}

type Issue = { code: string; path: readonly PropertyKey[]; message: string; errors?: Issue[][] };

/**
 * The issues to name, with a union's verdict opened to the transport the block
 * reads as. A block without `transport` is tried as the relay and then as
 * direct, and when both fail Zod answers one `invalid_union` reading "Invalid
 * input", which would hide the guidance (an inline APNs key, say). The schema's
 * own rule picks the member: a block with an `apns` or `fcm` block reads as
 * direct, any other as the relay.
 */
function leafIssues(issues: readonly Issue[], input: unknown): Issue[] {
  return issues.flatMap((issue) => {
    if (issue.code !== 'invalid_union' || !issue.errors || issue.errors.length !== 2) return [issue];
    const bag = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const direct = bag.apns !== undefined || bag.fcm !== undefined;
    return leafIssues(issue.errors[direct ? 1 : 0] ?? [], input);
  });
}
