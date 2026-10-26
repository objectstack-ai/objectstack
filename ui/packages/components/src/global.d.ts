/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// CSS Module declarations
declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

// Process environment for React components
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production' | 'test';
  }
}

// The browser `process` shim that used to sit here now lives in
// `browser-process-shim.d.ts`, which `tsconfig.test.json` excludes. It replaced
// (not augmented) the real node global in this package's TEST project, where
// `@types/node` IS configured — see that file's header and objectui#6809.
// Whatever stays in THIS file reaches both projects, so keep it to declarations
// that are correct in both.
