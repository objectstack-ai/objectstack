// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11825 — `kernel/GracefulDegradation` left with
// `kernel/AdvancedPluginLifecycleConfig`: its ONLY consumer was the retired
// container's `degradation` key (the #3950 rule — an exported value schema
// with no consumer reads as a capability). Unlike the `health` / `hotReload`
// vocabularies, which survive as the input types of the kept host-driven
// classes, NO implementation body exists for any of its keys — `fallbackMode`,
// `criticalDependencies`, `optionalDependencies`, `degradedFeatures`,
// `autoRecovery` were never read by anything in objectstack or objectui
// (measured with positive controls; the bare-name collisions —
// plugin-ordering's `optionalDependencies`, auth-manager's private
// `degradedFeatures` map — are different surfaces, verified structurally).
// An author declaring a degraded-mode contract got a clean parse and no
// degradation behaviour of any kind. The vocabulary returns only via the
// ENFORCE route of ADR-0049 through a new ADR — the implementation first.
// See `18.kernel__AdvancedPluginLifecycleConfig.ts` for the family record.
export const entry = 'kernel/GracefulDegradation';
