// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export * from './env.js';

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
