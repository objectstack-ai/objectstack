// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export * from './degraded-boot.js';
export * from './env.js';
export * from './error-leak.js';
// Seek-based pagination for batch walks — the offset alternative that neither
// skips rows when the walk mutates as it goes, nor costs O(n²/p) (#4363).
export * from './keyset-walk.js';
export * from './module-not-found.js';
export * from './response-envelope.js';
// [ADR-0120 D5e] The `isolated`-posture install gate for `'global'` uniques —
// the pure enumerator both the hard stop (install seam) and the advisories
// (`os doctor` / `os migrate plan`) read, so the three cannot drift apart.
export * from './unique-scope-install-gate.js';

// Placeholder for Kernel interface to avoid circular dependency
// The actual Kernel implementation will satisfy this interface.
export interface IKernel {
    // We can add specific methods here that plugins are allowed to call
    // forcing a stricter contract than exposing the whole class.
    ql?: any; // ObjectQL instance (optional to support initialization phase)
    start(): Promise<void>;
    // ... expose other needed public methods
    [key: string]: any; 
}

export interface RuntimeContext {
    engine: IKernel;
}

export interface RuntimePlugin {
    name: string;
    install?: (ctx: RuntimeContext) => void | Promise<void>;
    onStart?: (ctx: RuntimeContext) => void | Promise<void>;
}
