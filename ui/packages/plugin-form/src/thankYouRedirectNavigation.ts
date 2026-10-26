/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * WHO travels to an ACCEPTED `thankYouPage.redirectUrl` — objectui#5112, the
 * mount-blindness of `EmbeddableForm`'s thank-you redirect.
 *
 * `EmbeddableForm.isRedirectUrlSafe` answers WHETHER a destination may be
 * followed. This module answers who performs the navigation, and it is a
 * separate question for the reason objectui#4989 defect 4 established: a rooted
 * path such as `/thanks` handed to a browser-level navigation resolves against
 * the ORIGIN root, so under a host mounted at a sub-path (the framework CLI
 * configures one for every embedded deployment; the console runs at basename
 * `/_console`) a same-origin in-app destination leaves the application. Only the
 * host knows its mount, and it offers its mount-aware navigate through
 * `HostNavigationContext` (`@object-ui/react`, landed by PR #5111).
 *
 * ## Why this is a sibling of `submitRedirectNavigation.ts` and not a call into it
 *
 * That module serves `submitBehavior.url`, whose accepted set objectstack#7496
 * ruled **relative-only**: every destination it ever holds is already in-app, so
 * it hands the seam whatever it was given. This key is deliberately more
 * permissive — same-origin OR a host in the author's `allowedRedirectHosts`
 * allowlist — because a public form's thank-you page is often a real external
 * marketing page. So this key needs an arm the other one does not have, and
 * putting that arm inside the shared hook would make every `submitBehavior`
 * consumer carry a branch its contract can never reach. The acceptance set
 * itself is untouched here (objectui#5112 is explicitly not the card that
 * revisits it, and objectstack#7496's relative-only rule is NOT imported onto
 * this key).
 *
 * ## The arm split, and the invariant it buys
 *
 * - **an app-relative destination** goes through the host's navigate when a
 *   host supplied one, and falls back to today's browser navigation when none
 *   was supplied;
 * - **anything else** — an external destination admitted by the allowlist, and
 *   equally an ABSOLUTE same-origin URL the author spelled out in full — keeps
 *   browser-level navigation unconditionally.
 *
 * The second arm is not a conservatism, it is the seam's own declared input
 * contract: `HostNavigationValue.navigate` documents `to` as "an already-resolved,
 * application-relative path, never an absolute URL: a renderer that holds an
 * external destination must not launder it through the host's router". A host
 * navigate is a client-side router transition; an absolute URL is not a path a
 * router can match, and a cross-origin one is not the router's to attempt at
 * all. So the discriminant is the seam's admission rule restated as a predicate
 * on the string, which yields the invariant worth stating out loud and pinning:
 * **the host seam can never be handed a cross-origin URL**, because a relative
 * reference cannot carry an authority (RFC 3986) and therefore always resolves
 * to the base's origin.
 *
 * An absolute same-origin URL landing in the browser arm is a deliberate call,
 * not an oversight. It is the one destination shape the card's two named arms do
 * not cover, and routing it through the seam would mean this package rewriting
 * `https://forms.example/thanks` into `/thanks` for a router that would then
 * place it at `/_console/thanks` — a DIFFERENT address from the one the author
 * wrote. An author who spelled the whole address asked for that address; the
 * mount-blindness this card fixes is the one where the author wrote no origin at
 * all and had no way to express the mount.
 *
 * ## Absent seam is not a degraded mode
 *
 * With no provider the behaviour is byte-for-byte what it was: one
 * `window.location.href` assignment of the authored destination after the
 * declared delay. A host with no router has no basename, so origin-rooted
 * resolution is already correct there.
 */

import { useEffect, useRef } from 'react';
import { useHostNavigation } from '@object-ui/react';

/**
 * An accepted thank-you destination plus the delay declared with it, captured at
 * the moment the write was accepted (objectui#5049) — see the state's own
 * comment in `EmbeddableForm`.
 */
export interface PendingThankYouRedirect {
  url: string;
  delayMs: number;
}

/**
 * Two bases that share nothing but their scheme. A relative reference takes its
 * authority from whichever base it is resolved against; anything carrying its
 * own scheme or its own authority ignores the base and answers the same origin
 * for both. `.invalid` is reserved by RFC 2606, so neither can collide with a
 * real deployment origin, and comparing against BOTH means an author who
 * literally writes one of these sentinels is still classified as absolute.
 */
const PROBE_BASE_A = 'https://a.invalid/';
const PROBE_BASE_B = 'https://b.invalid/';

/**
 * Is `rawUrl` an application-relative reference — i.e. a destination the host's
 * router can be asked to place?
 *
 * True for `/thanks`, `thanks`, `?ok=1`, `#done`. False for `https://x/y`,
 * `//x/y` (protocol-relative carries an authority), `javascript:…`, and for a
 * same-origin ABSOLUTE URL — see the module docblock for why that last one is
 * deliberate.
 *
 * The question is answered by the URL parser rather than by a hand-written
 * scheme grammar, so leading whitespace and C0 controls are handled exactly the
 * way the parser handles them and there is no second spelling of RFC 3986 in
 * this repo to drift from the first.
 *
 * This predicate does NOT judge whether a destination may be followed —
 * `isRedirectUrlSafe` already did that, and this runs only on values it
 * accepted. It picks who travels, nothing more.
 */
export function isAppRelativeDestination(rawUrl: string): boolean {
  try {
    return (
      new URL(rawUrl, PROBE_BASE_A).origin === 'https://a.invalid'
      && new URL(rawUrl, PROBE_BASE_B).origin === 'https://b.invalid'
    );
  } catch {
    // Unparseable against any base is not a path a router can place. It is also
    // already refused upstream, so this is a fail-closed default rather than a
    // reachable branch.
    return false;
  }
}

/**
 * Own the delayed leg of an accepted thank-you redirect: wait the declared
 * `delayMs`, then travel to `pending.url` through the host's navigate if one was
 * injected AND the destination is app-relative, else through
 * `window.location.href`.
 *
 * Unmounting, or dropping the destination, cancels the wait — the property
 * objectui#5049 bought, preserved here unchanged: this hook is the effect
 * `EmbeddableForm` used to declare inline, with the seam added and nothing else
 * moved.
 *
 * Pass `null` when nothing is pending.
 */
export function useThankYouRedirectNavigation(pending: PendingThankYouRedirect | null): void {
  const { navigate: hostNavigate } = useHostNavigation();

  // Latest-wins ref, so the injected function's IDENTITY is not a dependency of
  // the wait below. A host that rebuilds its callback each render (the ordinary
  // shape of an inline arrow in JSX) would otherwise re-run that effect on every
  // parent re-render, and its cleanup would restart the declared pause under the
  // submitter — the same "the wait must not be restartable mid-flight" property
  // the captured `delayMs` protects on the other side. Same reasoning, same
  // shape, as `submitRedirectNavigation.ts`.
  const hostNavigateRef = useRef(hostNavigate);
  useEffect(() => {
    hostNavigateRef.current = hostNavigate;
  }, [hostNavigate]);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      // Read at fire time, not at arm time: a host that mounts its provider
      // asynchronously (auth/router settling) still gets its navigate used, and
      // a seam that goes away mid-wait falls back rather than calling a stale
      // closure.
      const navigate = isAppRelativeDestination(pending.url) ? hostNavigateRef.current : undefined;
      if (navigate) {
        navigate(pending.url);
        return;
      }
      window.location.href = pending.url;
    }, pending.delayMs);
    return () => clearTimeout(timer);
  }, [pending]);
}
