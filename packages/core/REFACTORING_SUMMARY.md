# Kernel Refactoring Summary

This document summarizes the critical architectural improvements made to the `packages/core` module to address stability, performance, and correctness issues.

## 1. Dependency Injection Context Fix
**Problem:** Service factories were receiving an empty object `{}` instead of the real `PluginContext`.
**Fix:**
- Updated `PluginLoader.createServiceInstance` to ensure `this.context` is passed to factories.
- Added `PluginLoader.setContext` method to inject the context from the Kernel.
- Kernel now properly injects itself and the loader into the context before initialization.

## 2. Sync/Async Gap (Service Availability)
**Problem:** Services created asynchronously (via `awaitFactory`) were not accessible synchronously immediately after initialization, breaking code that expected `getService` to return an instance if the plugin was loaded.
**Fix:**
- Implemented L2 caching via `PluginLoader.getServiceInstance<T>(name: string)`.
- Kernel's `getService` now checks this synchronous cache first before falling back to the async path.
- Ensured singleton instances are stored in `serviceInstances` immediately upon creation.

## 3. Runtime Circular Dependency Detection
**Problem:** Complex service graphs could deadlock or crash the stack if factories recursively requested each other. Static analysis was insufficient for dynamic factories.
**Fix:**
- Added a `creating` Set to `PluginLoader`.
- `createServiceInstance` now tracks which services are currently being built.
- Throws a descriptive error if a loop is detected (e.g., `Circular dependency detected: serviceA -> serviceB -> serviceA`).

## 4. Enhanced Error Handling
**Problem:** The Kernel swallowed errors from service factories (like database connection failures) and threw a generic "Service not found" error, making debugging impossible.
**Fix:**
- Refined `Kernel.getService` to distinguish between "service registration missing" and "factory execution failed".
- Factory errors are now re-thrown with their original stack trace and message.

## 5. Configuration Validation — retracted; the surface has since been retired

**Problem:** Configuration validation was a scaffold without implementation.

**Claimed fix — never took effect.** This section originally recorded that
`PluginConfigValidator` (Zod-based) had been integrated into `PluginLoader`, and that
`validatePluginConfig` performed real schema validation against `plugin.configSchema`.
It did not. The loader's only call site passed no config, so `validatePluginConfig`
always returned from its `config === undefined` branch — logging "config validation
postponed" — without ever reaching the validator. The kernel validated no plugin config
on any commit in this repository's recorded history, and no caller could have supplied
one: plugin factories close over their own config, so the kernel never receives it. The
scaffold stayed a scaffold.

**Actual resolution (2026-08-27).** The surface was retired rather than implemented, under
ADR-0049 (enforce-or-remove) and recorded in ADR-0025 §3.7: `PluginMetadata.configSchema`,
`PluginConfigValidator` and `createPluginConfigValidator` are gone, and plugins parse their
own config at their own seam. Tombstones marking the decision live in `src/plugin-loader.ts`,
`src/security/index.ts` and `src/plugin-loader.retired-fields.pin.test.ts`. Re-declaring a
kernel-owned config-validation surface is a fresh decision for the day the ADR-0025
distribution layer lands.

## Verification
- **Build:** Clean build of `dist` artifacts.
- **Tests:** 100% Pass rate (380/380 tests) across 22 test suites.
