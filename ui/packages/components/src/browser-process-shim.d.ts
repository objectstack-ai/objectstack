/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The browser `process` shim — SOURCE-ONLY, and that is the whole reason this
// declaration lives in its own file instead of in `global.d.ts` next door.
//
// This package's source is a browser bundle: `tsconfig.json` names no `types`,
// and `@types/node` is not reachable from `packages/components/node_modules`,
// so the source program contains ZERO node typings (measured with
// `tsc --listFiles`). Five source sites still read the bundler-replaced
// `process.env.NODE_ENV` idiom — `renderers/basic/div.tsx`,
// `renderers/basic/span.tsx` and `renderers/form/form.tsx` (×3) — and without
// this declaration all five fail `TS2591: Cannot find name 'process'`. Adding
// `"types": ["node"]` to `tsconfig.json` instead would be the wrong repair: it
// would hand a browser library the whole `fs`/`path`/`child_process` surface.
//
// ⛔ But this shim must NOT reach `tsconfig.test.json`. That project DOES set
// `"types": ["node"]`, so the real node global is available there — and an
// ambient `declare const process` of this narrow shape WINS over it, and (since
// `@types/node` spells its module as `export = process`) also becomes what
// `import process from 'node:process'` resolves to. The result was a
// self-contradicting diagnostic in this package's tests: `types: ["node"]` is
// configured, the import resolves, and the compiler still says
// `TS2339: Property 'cwd' does not exist on type '{ env: { NODE_ENV: string; }; }'`
// — for `process.cwd()`, for `import process from 'node:process'`, and for a
// renamed binding alike. The plain `join(process.cwd(), …)` idiom that
// `packages/i18n` tests use happily simply did not compile here (objectui#6809).
//
// The separation is mechanical, not a convention: `tsconfig.test.json` globs in
// `src/**/*.d.ts` for the ambient declarations its tests DO rely on, and names
// THIS file — and only this file — in its `exclude`. Keep the shim here; do not
// move it back into `global.d.ts`, and do not add a second source-only ambient
// to `global.d.ts` without giving it the same treatment.
declare const process: {
  env: {
    NODE_ENV: string;
  };
};
