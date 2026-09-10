// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The CLI half of the degraded-boot data path (#16630).
 *
 * ## The defect this closes
 *
 * `✓ Server is ready` and `System started with degraded capabilities. Missing
 * core services: …` came from two different packages — `printServerReady` here
 * in `@objectstack/cli`, `ObjectKernel.validateSystemRequirements()` in
 * `@objectstack/core` — with **no data path between them**. So the banner could
 * not report the degradation: it never learned of it. It printed a green tick
 * over a boot the kernel had just called degraded, on objectui CI run
 * `34056438855` and again on this repo's own published-artifact canary, run
 * `34084559243`, where the tick printed directly ABOVE the four boot warnings
 * that said otherwise. That canary is the only pipeline validating the
 * published on-ramp from outside, and the ready signal carried no weight in its
 * verdict at all — it was present, green, wrong, and believed by nobody.
 *
 * ## What this module is, and what it deliberately is NOT
 *
 * It is a READER. The kernel decides which services are `core`
 * (`ServiceRequirementDef`, `@objectstack/spec/system`) and which of them are
 * missing; this function fetches that answer and hands it on unchanged.
 *
 * ⛔ It must never re-derive that judgement. A second implementation of "which
 * services count as core" on this side is free to disagree with the kernel's,
 * and then the banner is wrong in a new way instead of the old one — with two
 * plausible answers on one screen and nothing to say which is authoritative.
 * That is why nothing here reads `ServiceRequirementDef`, counts services, or
 * inspects plugins: the ONLY input is the list the kernel published.
 *
 * ## Absent means healthy, and why a throw is the healthy path
 *
 * The kernel publishes the readout only when a boot IS degraded, so on a
 * healthy boot `getService` throws `Service '…' not found` — the same shape
 * `serve` already handles for the `auth` and `seed-summary` reads next to this
 * one. The throw is caught and reported as `undefined`, which the banner
 * renders as today's unchanged output, byte for byte.
 */

/**
 * The kernel service the degraded conclusion is published on.
 *
 * ⚠️ The producer's copy of this string is `DEGRADED_CAPABILITIES_SERVICE` in
 * `packages/core/src/kernel.ts`. They are two literals for one name, which is
 * how every kernel-service name crossing this boundary is already spelled
 * (`auth`, `seed-summary`, `driver.*`, `app.*` are all bare literals on both
 * sides). What holds them equal is not a shared constant but a test that drives
 * a REAL degraded kernel boot through this reader —
 * `format.server-ready-degraded-boot.test.ts` — so a rename on either side
 * reddens instead of silently restoring the green tick.
 */
const DEGRADED_CAPABILITIES_SERVICE = 'kernel.degraded-capabilities';

/** The shape `ObjectKernel` publishes. Structural — nothing is imported for it. */
interface DegradedCapabilitiesReadout {
  missingCoreServices?: unknown;
}

/** Just enough of the kernel to ask it a question. */
interface ServiceReader {
  getService?: (name: string) => unknown;
}

/**
 * The core services the kernel reported missing on this boot, or `undefined`
 * when it reported none — i.e. when the boot was not degraded.
 *
 * Returns a fresh array: the stored value is frozen on purpose (it is the
 * kernel's own record), and the banner's options are ordinary mutable data.
 *
 * Never throws. A readout that cannot be read is reported as "nothing to say",
 * exactly as an absent one is — this is a diagnostic, and a diagnostic that can
 * abort a boot the kernel already approved would be a worse defect than the one
 * it exists to fix.
 */
export function readMissingCoreServices(kernel: unknown): string[] | undefined {
  try {
    const readout = (kernel as ServiceReader | null | undefined)?.getService?.(
      DEGRADED_CAPABILITIES_SERVICE,
    ) as DegradedCapabilitiesReadout | undefined;
    const list = readout?.missingCoreServices;
    if (!Array.isArray(list)) return undefined;
    const names = list.filter((n): n is string => typeof n === 'string' && n.length > 0);
    return names.length > 0 ? [...names] : undefined;
  } catch {
    // Healthy boot: the kernel published nothing and `getService` threw.
    return undefined;
  }
}
