// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13905] The discriminator that tells **"nothing ever registered this
 * service"** apart from **"the service IS registered and could not be built"**
 * on the ASYNCHRONOUS resolution path.
 *
 * ## The fault
 *
 * `PluginLoader.getService` (reached through `Kernel.getServiceAsync`) answered
 * both facts with the same bare `Error`. A caller that holds only the rejection
 * therefore could not tell an UNWIRED embedder from a BROKEN one, and the only
 * thing separating them was message text.
 *
 * That mattered one layer out. `RestServer.computeExecCtx`'s kernel branch
 * absorbs a failed `getServiceAsync('objectql')` and degrades to "no engine is
 * wired". It must keep doing so — a kernel with no data plane is a SUPPORTED
 * configuration (`rest-api-plugin.ts` declares
 * `optionalDependencies: ['com.objectstack.engine.objectql']`) — but a
 * multi-tenant host whose engine FAILED TO CONSTRUCT reached that same resolver
 * as "no engine is wired", degrading silently where it should have refused
 * loudly. The branch could not be repaired from the outside, because the fact
 * it needed had been collapsed before it arrived.
 *
 * ## Why a brand, and ⛔ not message text
 *
 * The SYNCHRONOUS accessor in `kernel.ts` already draws exactly this line, and
 * the comment there records what happened the last time someone read the fact
 * off the wrong surface: reading "not found" off the async path "reported every
 * missing service as `is async - use await` — the wrong fix, pointing at the
 * wrong layer". A second text classifier on a resolution path is the failure
 * mode this module removes, ⛔ not a repair of it.
 *
 * The sync side decides from the REGISTRY — synchronous and authoritative — and
 * raises two different messages. The async side now carries that same
 * distinction as a branded, `code`-bearing rejection: one fact, spelled for a
 * caller that only ever sees the rejection.
 *
 * ## The test is CLOSED, and its default is LOUD
 *
 * Exactly one throw in `PluginLoader.getService` means "never registered", and
 * it is the one branded here. Every other way that method can reject — a
 * factory that threw, a missing scope id, an unset loader context, a circular
 * service dependency — is a service that IS registered and could not be
 * produced, and stays unbranded. So `false` is the safe answer: a consumer that
 * absorbs only the branded rejection stays loud about everything else,
 * including rejections added to that method later.
 *
 * ## Two deliberate omissions
 *
 * - **No `status`.** An ADR-0112 envelope pairs `code` with a `status`, but
 *   the whole point of this discriminator is that the CONSUMER decides what an
 *   unwired service means — absorb and degrade (the supported no-data-plane
 *   kernel) or refuse. Carrying an HTTP status here would presuppose that
 *   decision at the layer that must not make it.
 * - **No `name` override.** The rejection stays `name: 'Error'` with a
 *   byte-identical message, so `String(err)`, logs and existing assertions
 *   render exactly as before. The only observable change is two added
 *   own-properties.
 *
 * Brand shape follows `AuthzStoreUnavailableError` (2026-08-30): a string-keyed
 * own property rather than `instanceof`, so the predicate still answers
 * correctly when two copies of `@objectstack/core` are installed (a duplicated
 * module makes `instanceof` say "no" to an error it built itself).
 *
 * ⚠️ The brand does NOT survive `structuredClone`, and no claim here depends on
 * it doing so — measured on Node 22: cloning an `Error` keeps `name`, `message`,
 * `stack` and `cause` and DROPS every other own property, brand and `code`
 * alike. This discriminator is for an in-process rejection travelling from
 * `PluginLoader.getService` to a seam that catches it, which is the only path
 * it is used on.
 */

/**
 * The code carried by the "never registered" rejection.
 *
 * ⚠️ Spelled the ADR-0112 way, but deliberately NOT wire vocabulary: this value
 * is read in-process by the seam that catches the rejection and is never
 * serialized into an `error.code` envelope. `dispatcher-error-vocabulary.ts`
 * classifies it `door: 'none'` / `boot-refusal` for exactly that reason — the
 * same class as the migration-journal runner refusals. If a transport ever
 * needs to ANSWER with this fact, that is a registration question for #8846's
 * ledger, ⛔ not something to start doing at a door.
 */
export const SERVICE_NOT_REGISTERED_CODE = 'SERVICE_NOT_REGISTERED';

/**
 * The own-property brand {@link isServiceNotRegisteredError} tests for.
 * A plain string key rather than `instanceof` or a `Symbol.for` registry key,
 * so a duplicated copy of this module still brands identically. See the module
 * doc for what it deliberately does NOT claim.
 */
const SERVICE_NOT_REGISTERED_BRAND = '__objectstackServiceNotRegistered';

/**
 * Build the rejection for "no factory and no instance is registered under this
 * name". Package-internal on purpose: `PluginLoader.getService` is the single
 * construction site, and `@objectstack/core` publishes only the two symbols a
 * CONSUMER needs ({@link SERVICE_NOT_REGISTERED_CODE} and
 * {@link isServiceNotRegisteredError}) — see `index.ts`.
 *
 * The message is kept verbatim: callers and tests that render or assert on it
 * must not move when the discriminator arrives.
 */
export function serviceNotRegisteredError(name: string): Error {
    const err = new Error(`Service '${name}' not found`) as Error & {
        [SERVICE_NOT_REGISTERED_BRAND]?: true;
        code?: string;
        serviceName?: string;
    };
    err[SERVICE_NOT_REGISTERED_BRAND] = true;
    err.code = SERVICE_NOT_REGISTERED_CODE;
    err.serviceName = name;
    return err;
}

/**
 * True when `err` is the rejection meaning **nothing was ever registered under
 * that service name** — never when a registered service failed to construct.
 *
 * The predicate a seam uses to keep absorbing the supported "no data plane"
 * composition while staying loud about a service that IS wired and broke.
 */
export function isServiceNotRegisteredError(
    err: unknown,
): err is Error & { readonly code: typeof SERVICE_NOT_REGISTERED_CODE; readonly serviceName: string } {
    return (
        typeof err === 'object'
        && err !== null
        && (err as Record<string, unknown>)[SERVICE_NOT_REGISTERED_BRAND] === true
    );
}
