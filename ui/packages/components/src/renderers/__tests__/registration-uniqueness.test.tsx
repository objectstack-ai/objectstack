/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5125 — the registry is SILENT when a later `register()` overwrites an
 * earlier one under the same namespaced key. `Registry.register` even carries a
 * deliberately empty hook for it:
 *
 *   if (this.components.has(fullType)) {
 *     // console.warn(`Component type "${fullType}" is already registered. Overwriting.`);
 *   }
 *
 * The consequence is not a crash but a shadowed renderer: the loser keeps
 * compiling, keeps passing type-check, and never runs. Both instances on `main`
 * were found by accident, one of them by an unrelated probe:
 *
 *   - `ui:table`  — `data-display/table.tsx` (`SimpleTableRenderer`, the only
 *     table renderer that read `bind`) lost to `complex/table.tsx`, because
 *     `renderers/index.ts` imports `./data-display` before `./complex`.
 *   - `ui:kbd`    — `basic/html-elements.tsx` registered a plain `<kbd>`
 *     pass-through from its `TAGS` loop and lost to `data-display/kbd.tsx`,
 *     even though that file's own comment states the list "deliberately
 *     excludes anything already registered".
 *
 * This gate is the class-level guard for that defect: it fails on ANY
 * same-namespace duplicate this package's production barrel introduces, not
 * just on the two keys above.
 *
 * Why a gate test rather than filling in that runtime `console.warn`:
 * re-registering an existing key is a SUPPORTED pattern here — 72 test files
 * call `ComponentRegistry.register`, many to swap a production renderer for a
 * stub, and `Registry.unregister` exists specifically so they can restore it.
 * A runtime warning would therefore fire mostly on legitimate overrides, next
 * to the two warnings `register()` already emits (the meta-less-registration
 * deprecation and the bare-name fallback collision). A third console channel
 * that cries wolf would train readers to ignore all three. Scoping the check to
 * what `renderers/index.ts` registers puts it exactly where deliberate
 * overrides do not happen — and makes it FAIL rather than scroll past.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';

type RegisterFn = typeof ComponentRegistry.register;

// Count every register() call the production barrel makes. Installed BEFORE the
// import below, because the barrel registers at module scope.
const callsByKey = new Map<string, number>();
const originalRegister = ComponentRegistry.register.bind(ComponentRegistry) as RegisterFn;

(ComponentRegistry as unknown as { register: RegisterFn }).register = ((
  type: string,
  component: Parameters<RegisterFn>[1],
  meta?: Parameters<RegisterFn>[2],
) => {
  const fullType = meta?.namespace ? `${meta.namespace}:${type}` : type;
  callsByKey.set(fullType, (callsByKey.get(fullType) ?? 0) + 1);
  return originalRegister(type, component, meta);
}) as RegisterFn;

// Top-level await so the barrel is evaluated after the counter is installed and
// before any test body runs. `../index` is the real production entry point —
// the same module `packages/components/src/index.ts` imports for side effects.
await import('../index');

// Restore immediately: later registrations (tests, lazy plugins) are not part
// of what this gate measures.
(ComponentRegistry as unknown as { register: RegisterFn }).register = originalRegister;

describe('renderer registration uniqueness (objectui#5125)', () => {
  it('registers no key twice within the same namespace', () => {
    const duplicates = [...callsByKey.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => `${key} (registered ${count}x)`)
      .sort();

    expect(
      duplicates,
      duplicates.length === 0
        ? ''
        : `Same-namespace duplicate registration(s): ${duplicates.join(', ')}.\n` +
          'The registry silently keeps the LAST registration, so the earlier renderer is\n' +
          'unreachable dead code — it still compiles and type-checks but never runs.\n' +
          'Fix by deleting the shadowed registration, or give one of them its own\n' +
          'namespace. Do not suppress this by allow-listing the key.',
    ).toEqual([]);
  });

  it('measures a non-trivial number of registrations (the probe reaches the barrel)', () => {
    // Guards the guard: if the barrel import ever stops registering — a moved
    // entry point, a bundler change, a spy that no longer wraps the real
    // method — the duplicate check above would pass vacuously over an empty
    // map. `main` registers 158 distinct keys; this floor only has to be high
    // enough that an empty or near-empty reading cannot slip through.
    expect(callsByKey.size).toBeGreaterThan(100);
  });
});
