// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export * from './degraded-boot.js';
export * from './env.js';
export * from './error-leak.js';
// Seek-based pagination for batch walks — the offset alternative that neither
// skips rows when the walk mutates as it goes, nor costs O(n²/p) (#4363).
export * from './keyset-walk.js';
export * from './module-not-found.js';
export * from './response-envelope.js';
// [#8016] The one rule for "what HTTP answer does a THROWN error declare?",
// plus the validation-failure recogniser it reads. Both doors of
// `/api/v1/packages` call it: the runtime dispatcher's `errorFromThrown` and the
// direct-mount REST registrar, which used to answer 500 INTERNAL_ERROR for a
// coded 4xx the dispatcher mapped correctly.
export * from './thrown-http-error.js';
export * from './validation-failure.js';
// [#6615] The one home for Postgres' `«sub-object» "x" of relation "y"` phrase,
// whose missing-COLUMN spelling contains a legal missing-TABLE phrase as a
// substring. Three packages had each repaired that superstring hole separately.
export * from './relation-sub-object.js';
// [#6250] The one named "is this a unique-constraint violation?" predicate.
// Four hand-written vocabularies used to answer it and disagreed about MySQL,
// which is why every MySQL conflict came back 500 instead of 409.
export * from './unique-violation.js';
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
