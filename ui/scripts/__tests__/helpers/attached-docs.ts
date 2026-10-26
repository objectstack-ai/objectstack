/**
 * The documentation ATTACHED to one exported constant, located structurally —
 * never by a line number, which objectui#6778 demonstrated three times over
 * rots within days.
 *
 * "Attached" is the JSDoc block ending immediately before the
 * `export const NAME` declaration PLUS every comment lexically inside that
 * declaration, with the code itself stripped out. Both halves are load-bearing
 * and neither is a convenience:
 *
 *   - the leading block alone is not enough. Measured on `main` when this was
 *     written for `scripts/check-eager-closure-budget.mjs`, `BASELINE`'s
 *     leading block carries no commit hash at all — the sentence naming the
 *     commit the measurement was taken on is the JSDoc on the `gzipBytes`
 *     FIELD, inside the object literal. Scoping there would make that file's
 *     positive pin red on an honest file.
 *   - the declaration TEXT is too much. `commit: '...'` would satisfy such a
 *     pin by restating the constant — the prose about the value passing
 *     because it contains the value, which is the defect one layer up.
 *
 * ## Why this lives here rather than in one test file
 *
 * It is a structural parser with no knowledge of any particular file: it takes
 * a source string and an export name and uses no line numbers, no offsets and
 * no per-file table. Nothing in it is specific to the checker it was written
 * for, and it now has two customers (objectui#7289):
 *
 *   - `scripts/__tests__/check-eager-closure-budget.test.ts` — pins the commits
 *     `BASELINE` carries, the `` BASELINE's `HASH` `` claims, and the per-key
 *     provenance list, into their own attached prose;
 *   - `scripts/__tests__/vite-declared-lazy-views.test.ts` — pins the ledger
 *     paths and the two control paths into theirs.
 *
 * A second hand-written copy is exactly the drift this class of pin exists to
 * stop, and it would fail in the quiet direction: a copy that walks the
 * initializer slightly differently returns a slightly larger `prose`, and a
 * larger `prose` makes every `prose.includes(value)` pin above it MORE likely
 * to pass. One implementation, used by both.
 *
 * Not collected as a test: the `unit` project in `vitest.config.mts` includes
 * only files whose name ends in `.test.ts` under `scripts/`, so a module named
 * like this one is importable from a test but is never collected as an empty
 * suite — which is why the repo's existing shared test plumbing already sits in
 * this directory (`./turbo-inputs.ts`, `./tsc-program.ts`, and the rest).
 */
export function attachedDocs(
  source: string,
  exportName: string,
): { prose: string; code: string } {
  const declaration = new RegExp(String.raw`^export const ${exportName}\b`, 'm').exec(source);
  if (!declaration) throw new Error(`no \`export const ${exportName}\` in the source`);
  const declStart = declaration.index;

  const before = source.slice(0, declStart).replace(/\s+$/, '');
  if (!before.endsWith('*/')) {
    throw new Error(`\`export const ${exportName}\` is not preceded by a block comment`);
  }
  const open = before.lastIndexOf('/**');
  if (open === -1) throw new Error(`unterminated JSDoc above \`export const ${exportName}\``);

  // Walk the initializer, skipping comments and string literals, until the
  // brackets it opened close again. Comments met on the way are the per-field
  // prose; everything else is code.
  const inner: string[] = [];
  let i = source.indexOf('=', declStart) + 1;
  let depth = 0;
  let opened = false;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new Error(`unterminated comment inside ${exportName}`);
      inner.push(source.slice(i, end + 2));
      i = end + 2;
      continue;
    }
    if (two === '//') {
      const end = source.indexOf('\n', i);
      inner.push(source.slice(i, end));
      i = end;
      continue;
    }
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
      i += 1;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') {
      depth += 1;
      opened = true;
    } else if (c === ')' || c === '}' || c === ']') {
      depth -= 1;
      if (opened && depth === 0) {
        i += 1;
        break;
      }
    } else if (!opened && c === ';') {
      break;
    }
    i += 1;
  }

  return { prose: [before.slice(open), ...inner].join('\n'), code: source.slice(declStart, i) };
}
