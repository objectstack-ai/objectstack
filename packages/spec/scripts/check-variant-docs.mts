#!/usr/bin/env tsx
// Discriminated-union variant → hand-written doc gate.
//
// WHY THIS EXISTS (#4165). The liveness gate asks whether a schema property does
// anything, and check-doc-authoring asks whether docs use the right authoring form.
// Neither asks the inverse-drift question: does a variant the SCHEMA declares appear
// in the hand-written doc at all? content/docs/references/ is generated from these
// schemas and so cannot drift, but the hand-written pages are typed by humans and do.
//
// The founding case: content/docs/ui/apps.mdx said the navigation tree "supports eight
// item types" and enumerated eight. The schema had nine — `separator` had been added to
// match the objectui renderer (#1878/#1891/#1894) and no hand-written page ever learned
// about it. Nothing failed, because nothing was looking in this direction.
//
// #4165 raised the cost of that gap: NavigationItemSchema is now discriminated on `type`,
// so a mistyped discriminator answers with "Invalid discriminator value. Expected ..." —
// the doc's enumeration is precisely what an author checks that list against. And
// SeparatorNavItemSchema is .strict() over only type/id/order, so the base props the doc
// promised "all navigation items" share are hard errors on a separator.
//
// THE RATCHET. `key` is '<discriminator>:<variants sorted, pipe-joined>' — not a source
// path, because a union is reachable by several paths and the walk order picks one, which
// would churn. Keying on the variant set means adding or removing a variant CHANGES THE
// KEY, so the ledger no longer matches and CI sends the author back to variant-docs.json
// — and from there to the doc. An unknown key (new union) and an orphaned key (deleted or
// renamed union) both fail: no new undeclared surface, no stale claims.
//
// AN ARM'S VARIANTS ARE EVERY VALUE ITS DISCRIMINATOR MATCHES — a literal arm
// (`kind: z.literal('nav')`) contributes its one value, an enum arm
// (`kind: z.enum(['field', 'flow'])`) contributes every member. zod 4 keeps a literal's
// values in the def's `values` and an enum's members in its `entries`; reading only the
// first left an enum arm out of the key altogether, so a member added to or dropped from
// that enum never moved the key and the gate never sent anyone back to the doc. The
// reading lives in `armVariants()`, exported with `unionKey()` so the fixture test pins
// both arm shapes without running the sweep.
//
// WHAT "MENTIONED" MEANS — and what this gate does NOT prove. A variant counts as
// documented if the bound doc contains any of three forms:
//
//   `<discriminator>: '<variant>'`   the quoted code-sample form (JS/TS/JSON)
//   `` `<variant>` ``                the prose/table form
//   `<discriminator>: <variant>`     a whole YAML mapping line (optionally + `# comment`)
//
// The YAML form was added after the widget-implementation union (#4001 audit) showed the
// cost of leaving it out: `protocol/objectui/widget-contract.mdx` carries a "Widget Source"
// section documenting all three of `npm` / `remote` / `inline` in YAML examples — and the
// gate could not see any of them, because YAML does not quote scalar values. The entry sat
// exempt as "generated-reference-only", i.e. the ledger recorded a doc gap that did not
// exist while the real gap — a matcher blind to half the repo's example dialect — stayed
// invisible. It is anchored to a full line so it stays as tight as the quoted form.
//
// The prose form is deliberately loose, and for short generic variants (`object`, `api`,
// `value`) it can match an unrelated sentence — so a pass here means "the page at least
// says the word", NOT "the page documents it correctly". This gate catches the omission
// that shipped for months; it is not a substitute for reading the page. Tightening the
// loose form would cost more false failures than the precision is worth.
//
// Usage:
//   tsx check-variant-docs.mts          # fail on undeclared/orphaned/undocumented
//   tsx check-variant-docs.mts --list   # print every discovered union and its key

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '..');
const REPO = path.resolve(SPEC, '../..');
const SRC = path.join(SPEC, 'src');
const LEDGER = path.join(SPEC, 'variant-docs.json');
const LIST = process.argv.includes('--list');

type Entry = {
  key: string; label: string;
  docs?: string[]; exempt?: string; reason?: string; note?: string;
};

const defOf = (s: any) => s?._zod?.def ?? s?._def;

/**
 * The discriminator values one arm matches, read off the arm's discriminator field.
 * A literal carries them in `values` (zod 3: one `value`); an enum carries its members
 * in `entries`, and zod's own parse set for it is `_zod.values`, which drops a numeric
 * TypeScript enum's reverse-mapping keys — so that set is read first.
 */
export function armVariants(field: any): string[] {
  const dd = defOf(field);
  if (!dd) return [];
  if (dd.entries && typeof dd.entries === 'object') {
    const parsed = field?._zod?.values;
    return [...(parsed instanceof Set ? parsed : Object.values(dd.entries))].map(String);
  }
  const vals = dd.values ?? (dd.value !== undefined ? [dd.value] : []);
  return [...vals].map(String);
}

/**
 * A discriminated union's ledger key and the variants it was built from, or null when the
 * schema is not a discriminated union or none of its arms yields a value.
 */
export function unionKey(s: any): { disc: string; variants: string[]; key: string } | null {
  const d = defOf(s);
  if (!d || d.type !== 'union' || !d.discriminator) return null;
  const variants: string[] = [];
  for (const o of d.options ?? []) {
    const od = defOf(o);
    const shape = typeof od?.shape === 'function' ? od.shape() : od?.shape;
    variants.push(...armVariants(shape?.[d.discriminator]));
  }
  if (!variants.length) return null;
  return { disc: d.discriminator, variants, key: `${d.discriminator}:${[...variants].sort().join('|')}` };
}

function zodFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) zodFiles(p, acc);
    else if (e.name.endsWith('.zod.ts')) acc.push(p);
  }
  return acc;
}

const seen = new Set<any>();
const found = new Map<string, { disc: string; variants: string[]; path: string }>();

function walk(s: any, p: string, depth: number): void {
  if (!s || typeof s !== 'object' || depth > 14 || seen.has(s)) return;
  seen.add(s);
  const d = defOf(s);
  if (!d) return;

  const u = unionKey(s);
  if (u && !found.has(u.key)) found.set(u.key, { disc: u.disc, variants: u.variants, path: p });

  // Structural recursion. Wrapped in try/catch because a lazy getter can reference a
  // module that is still initialising mid-import; an unresolvable branch must not abort
  // the whole sweep (it will be reached again via another path).
  try {
    if (typeof d.getter === 'function') walk(d.getter(), p, depth + 1);
    const shape = typeof d.shape === 'function' ? d.shape() : d.shape;
    if (shape) for (const [k, v] of Object.entries(shape)) walk(v, `${p}.${k}`, depth + 1);
    if (d.element) walk(d.element, `${p}[]`, depth + 1);
    if (d.innerType) walk(d.innerType, p, depth + 1);
    if (d.valueType) walk(d.valueType, `${p}{}`, depth + 1);
    if (d.left) walk(d.left, p, depth + 1);
    if (d.right) walk(d.right, p, depth + 1);
    if (d.in) walk(d.in, p, depth + 1);
    if (d.out) walk(d.out, p, depth + 1);
    for (const o of d.options ?? []) walk(o, p, depth + 1);
    for (const t of d.items ?? []) walk(t, p, depth + 1);
  } catch { /* unresolvable branch — reached via another path if it matters */ }
}

async function main(): Promise<void> {
  // Set before the first dynamic `import()` below, so every schema module loads eagerly.
  // It lives inside `main()` so that the fixture test, which imports this module for
  // `unionKey()`, neither sweeps `src/` nor leaves the variable set in its worker.
  process.env.OS_EAGER_SCHEMAS ??= '1';

  const files = zodFiles(SRC).sort();
  for (const f of files) {
    let mod: Record<string, unknown>;
    try { mod = await import(url.pathToFileURL(f).href); } catch { continue; }
    const rel = path.relative(SRC, f).replace(/\.zod\.ts$/, '');
    for (const [name, val] of Object.entries(mod)) {
      if (val && typeof val === 'object' && defOf(val)) walk(val, `${rel}#${name}`, 0);
    }
  }

  if (LIST) {
    const rows = [...found.entries()].sort((a, b) => a[1].path.localeCompare(b[1].path));
    console.log(`${rows.length} discriminated union(s):\n`);
    for (const [key, v] of rows) console.log(`${v.path}\n    key: ${key}\n    ${v.variants.join(', ')}\n`);
    process.exit(0);
  }

  const ledger: { entries: Entry[] } = JSON.parse(fs.readFileSync(LEDGER, 'utf-8'));
  const byKey = new Map(ledger.entries.map((e) => [e.key, e]));
  const errors: string[] = [];

  // Duplicate keys in the ledger would let one entry silently shadow another.
  const dupes = ledger.entries.map((e) => e.key).filter((k, i, a) => a.indexOf(k) !== i);
  for (const k of new Set(dupes)) errors.push(`duplicate ledger key: ${k}`);

  // Ratchet A — every discovered union must be declared.
  for (const [key, v] of found) {
    if (byKey.has(key)) continue;
    errors.push(
      `undeclared discriminated union at ${v.path}\n` +
      `    key: ${key}\n` +
      `    variants (${v.variants.length}): ${v.variants.join(', ')}\n` +
      `    → add it to packages/spec/variant-docs.json: bind \`docs\` (and make sure each variant\n` +
      `      is mentioned there), or declare \`exempt\` with a reason.`,
    );
  }

  // Ratchet B — every ledger entry must still correspond to a real union. A changed
  // variant set surfaces here as an orphan plus an undeclared entry above.
  for (const e of ledger.entries) {
    if (!found.has(e.key)) {
      errors.push(
        `orphaned ledger entry "${e.label}"\n` +
        `    key: ${e.key}\n` +
        `    → no union with this discriminator/variant set exists any more. If variants changed,\n` +
        `      update the key AND re-check the bound doc; if the union is gone, delete the entry.`,
      );
    }
  }

  // Coverage — every variant of a governed union must be mentioned in a bound doc.
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let governed = 0, exempt = 0;
  for (const e of ledger.entries) {
    const u = found.get(e.key);
    if (!u) continue;
    if (e.exempt) { exempt++; continue; }
    if (!e.docs?.length) {
      errors.push(`ledger entry "${e.label}" declares neither \`docs\` nor \`exempt\`.`);
      continue;
    }
    governed++;

    const missingDocs = e.docs.filter((d) => !fs.existsSync(path.join(REPO, d)));
    if (missingDocs.length) {
      errors.push(`ledger entry "${e.label}" binds doc(s) that do not exist: ${missingDocs.join(', ')}`);
      continue;
    }
    const blob = e.docs.map((d) => fs.readFileSync(path.join(REPO, d), 'utf-8')).join('\n');
    const undocumented = u.variants.filter((v) => {
      const anchored = new RegExp(`${esc(u.disc)}\\s*:\\s*['"\`]${esc(v)}['"\`]`);
      const token = new RegExp('`' + esc(v) + '`');
      // YAML mapping line: unquoted scalar, so it must be anchored to the whole
      // line (trailing `# comment` allowed) to stay as tight as the quoted form.
      const yaml = new RegExp(`^\\s*${esc(u.disc)}\\s*:\\s*${esc(v)}\\s*(#.*)?$`, 'm');
      return !anchored.test(blob) && !token.test(blob) && !yaml.test(blob);
    });
    if (undocumented.length) {
      errors.push(
        `"${e.label}" — ${undocumented.length} variant(s) the schema declares but the doc never mentions:\n` +
        `    ${undocumented.join(', ')}\n` +
        `    doc(s): ${e.docs.join(', ')}\n` +
        `    → document them, or if they are genuinely not author-facing, re-classify the entry.`,
      );
    }
  }

  if (errors.length) {
    console.error(`\n✗ variant/doc gate: ${errors.length} problem(s)\n`);
    for (const e of errors) console.error(`  ${e}\n`);
    process.exit(1);
  }
  console.log(
    `✓ variant/doc gate: ${found.size} discriminated union(s) — ` +
    `${governed} governed (every variant mentioned in a bound doc), ${exempt} exempt.`,
  );
}

// Run the sweep only when invoked as a script (`tsx scripts/check-variant-docs.mts`, or the
// pnpm script); an import — the fixture test — gets the exports and nothing else.
const invokedDirectly = process.argv[1] !== undefined && url.fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) await main();
