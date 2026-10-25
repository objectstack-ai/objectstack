// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Declaration twin of `workspace-root.mjs`, so a TypeScript test under a package
// (compiled with `allowJs: false`) or under `e2e/` imports the helper typed,
// with no `@ts-expect-error` and no local annotation.
// `scripts/__tests__/workspace-root.test.ts` pins that the names declared here
// are exactly the names the module exports.

export declare const WORKSPACE_MANIFEST: 'pnpm-workspace.yaml';
export declare const LOCKFILE: 'pnpm-lock.yaml';
export declare const ROOT_MANIFEST: 'package.json';
export declare const TURBO_CONFIG: 'turbo.json';
export declare const PARKED_TURBO_CONFIG: 'turbo.objectui.json';
export declare const TURBO_ROOT_PREFIX: '$TURBO_ROOT$/';
export declare const VIRTUAL_STORE: '.pnpm';

/** The directory whose `pnpm-workspace.yaml` governs the tree: `root`, else its parent, else a throw. */
export declare function workspaceRoot(root?: string): string;
/** Whether the workspace root is the parent of the tree (the monorepo layout). */
export declare function isNestedWorkspace(root?: string): boolean;
/** The tree's directory-name prefix in the parent's globs (`ui/`), or `''`. */
export declare function nestedPrefix(root?: string): string;
/** `<ref>:./<path>`: a file at a revision, relative to the cwd git runs in. */
export declare function revPath(ref: string, file: string): string;
export declare function workspaceManifestPath(root?: string): string;
export declare function lockfilePath(root?: string): string;
export declare function rootManifestPath(root?: string): string;
export declare function rootManifest(root?: string): {
  name?: string;
  pnpm?: { overrides?: Record<string, string>; patchedDependencies?: Record<string, string> };
} & Record<string, unknown>;
/** pnpm's `node_modules/.pnpm` at the workspace root, where every installed copy lives. */
export declare function virtualStorePath(root?: string): string;
/** The `packages:` globs of a workspace file's text; throws on every shape it does not know. */
export declare function parseWorkspaceGlobs(text: string): string[];
/** The globs that describe this tree, relative to `root` in both layouts. */
export declare function workspaceGlobs(root?: string): string[];
/** The nearest `turbo.json` upward: what turbo hashes from. */
export declare function turboConfigPath(root?: string): string;
/** objectui's own task declaration: `turbo.json` at `root`, else the parked copy. */
export declare function uiTurboConfigPath(root?: string): string;

export interface TurboConfigLike {
  globalDependencies?: string[];
  tasks?: Record<string, { inputs?: string[] } & Record<string, unknown>>;
}
/** `$TURBO_ROOT$/<prefix>x` read as `$TURBO_ROOT$/x`; other root-anchored inputs dropped. */
export declare function narrowTurboConfig<T extends TurboConfigLike>(config: T, prefix: string): T;
/** The nearest `turbo.json`, parsed and narrowed to this tree's subset when it is the parent's. */
export declare function uiScopedTurboConfig(root?: string): {
  globalDependencies?: string[];
  tasks: Record<string, { inputs?: string[]; dependsOn?: string[]; cache?: boolean; env?: string[] }>;
};
