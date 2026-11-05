// Types for `sql-driver-split-source.mjs`, which the `@objectstack/cli`
// migration-generator pins import (#30147). Declared rather than inferred (no
// `allowJs`) for the reason `js-comment-mask.d.mts` gives: the module sits at
// the repo root, outside the consuming program's `rootDir`, and an untyped
// `.mjs` import there is TS7016. Keep this file in step with the module by hand.

/** The file that holds `SqlDriver` and its stubs. */
export declare const SQL_DRIVER_HOST: 'sql-driver.ts';

/** The module the top-level declarations ahead of the class moved to. */
export declare const SQL_DRIVER_LEAF: 'sql-driver-top-level.ts';

/**
 * `SqlDriver` as one text: `sql-driver.ts` with each codemod stub's body
 * replaced by the body of the facet method it calls, and the leaf ahead of the
 * class. Throws on a marked stub it cannot follow.
 */
export declare function readSqlDriverSource(
  srcDir: string,
  options?: { readFile?: (path: string) => string },
): {
  text: string;
  spliced: { member: string; module: string }[];
  files: string[];
};
