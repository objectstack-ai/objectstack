// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Declaration twin of `ui-root.mjs`, so a TypeScript test under a package
// (compiled with `allowJs: false`) imports the helper typed, with no
// `@ts-expect-error` and no local annotation. `scripts/__tests__/ui-root.test.ts`
// pins that the names declared here are exactly the names the module exports.

/** Absolute path of the objectui tree: the directory that holds `scripts/`, `packages/` and `apps/`. */
export declare const UI_ROOT: string;

/** The objectui tree root, as an absolute path with no trailing separator. */
export declare function uiRoot(): string;
