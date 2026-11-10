// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inbound automation hook's one refusal, and the admission of its
 * qualified address (ADR-0150 D5, epic child G1).
 *
 * ## One refusal, rendered in one place
 *
 * Every post the hook door does not serve gets ONE answer, `401
 * INVALID_SIGNATURE`: an unknown flow, a wrong hook id, an absent or bad
 * signature (`@objectstack/trigger-api`, `ApiTrigger.handleRequest`), and an
 * address that does not name the hook's flow. One status and one body, so the
 * answer tells no armed flow name from an unarmed one and no installed
 * namespace from another. The cause goes to the server log only.
 *
 * {@link inboundHookRefusal} is that answer, and {@link inboundHookJsonResponse}
 * is the one way the door answers over a web-standard `Response` (Hono's
 * `c.json`: the JSON body and one `Content-Type: application/json` header).
 * The trigger's own refusal and the hosted face's refusal of an unadmitted
 * address both render through them, so the two are the same bytes.
 *
 * ## The admission of a qualified address
 *
 * `POST /automation/hooks/:qualifier/:flowName/:hookId` is served only when
 * the qualifier names the package that holds the flow, read from the
 * automation engine (`packagedFlowOwner`: the package that ships the flow by
 * its bare name, whose environment overlay is still that package's item, D4):
 *
 *  - `_env` names the environment's own flow: one no package ships;
 *  - a namespace names a flow one of its packages ships.
 *
 * The engine arms one flow per bare name and the hook is keyed by it, so the
 * admitted address reaches exactly the hook the bare route reaches, and never
 * another. {@link admitInboundHookAddress} is the predicate; each face reads
 * the owner and the namespace's packages from its own kernel and asks it.
 */

import { ENVIRONMENT_ADDRESS_SEGMENT } from '@objectstack/spec/kernel';

/** The inbound hook door's refusal status: every post it does not serve. */
export const INBOUND_HOOK_REFUSAL_STATUS = 401;

/**
 * The ONE answer every inbound post the door does not serve gets. A fresh
 * object per call, so no caller can alter the next answer.
 */
export function inboundHookRefusal(): { status: number; body: Record<string, unknown> } {
  return {
    status: INBOUND_HOOK_REFUSAL_STATUS,
    body: { success: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } },
  };
}

/**
 * The door's answer as a web-standard `Response`, answering the way Hono's
 * `c.json` answers: the body is `JSON.stringify(body)` and the one header is
 * `Content-Type: application/json`.
 */
export function inboundHookJsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** {@link inboundHookRefusal}, rendered by {@link inboundHookJsonResponse}. */
export function inboundHookRefusalResponse(): Response {
  const { status, body } = inboundHookRefusal();
  return inboundHookJsonResponse(body, status);
}

/** What {@link admitInboundHookAddress} judges. */
export interface InboundHookAddress {
  /** The qualifier the path carried (`_env`, or a namespace), as the route matched it. */
  readonly qualifier: string;
  /** The package that ships the flow by its bare name, or `undefined` when none does. */
  readonly flowOwner: string | undefined;
  /** The installed packages of the namespace the qualifier names (empty for `_env` or none). */
  readonly namespaceOwners: readonly string[];
}

/**
 * Does the qualified address name the hook's flow? `_env`: a flow no package
 * ships. A namespace: a flow one of the namespace's packages ships. Anything
 * else is refused with {@link inboundHookRefusal}: judged before the
 * signature is read, and answered only once the body has been read in full, as
 * the door reads every post's body before it answers, so the refusal's timing
 * tells no installed namespace from another.
 */
export function admitInboundHookAddress(address: InboundHookAddress): boolean {
  if (address.qualifier === ENVIRONMENT_ADDRESS_SEGMENT) return address.flowOwner === undefined;
  return address.flowOwner !== undefined && address.namespaceOwners.includes(address.flowOwner);
}
