/**
 * The fixture WORKSPACE root for objectui#9767 -- this repo, outside the
 * indexed tree.
 *
 * ⭐ This spelling is why the split is NOT decided on "resolves in a declared
 * dependency" alone: measured on the live corpus, one symbol in the bucket is
 * declared in a sibling package of this very repo, and the narrow predicate
 * would have filed it as a schema that is gone. Same corpus boundary, different
 * side of it.
 *
 * ⚠️ Spelled `.ts`, while the live symbol that motivated it lives in a `.tsx`:
 * `tsconfig.scripts.json`'s program does not reach `.tsx` under `scripts/`, and
 * a fixture no `tsc` invocation reads is objectui#3494's defect. The `.tsx` half
 * of the repo root's extension list is pinned directly in the test instead.
 */
export interface RepoOnlySchema {
  rows: string[];
}
