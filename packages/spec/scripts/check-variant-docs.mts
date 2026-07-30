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
// WHAT "MENTIONED" MEANS — and what this gate does NOT prove. A variant counts as
// documented if the bound doc contains either `<discriminator>: '<variant>'` (the code-
// sample form) or `` `<variant>` `` (the prose/table form). The second form is
// deliberately loose, and for short generic variants (`object`, `api`, `value`) it can
// match an unrelated sentence — so a pass here means "the page at least says the word",
// NOT "the page documents it correctly". This gate catches the omission that shipped for
// months; it is not a substitute for reading the page. Tightening the loose form would
// cost more false failures than the precision is worth.
//
// Usage:
//   tsx check-variant-docs.mts          # fail on undeclared/orphaned/undocumented
//   tsx check-variant-docs.mts --list   # print every discovered union and its key

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// Safe to set here despite ESM hoisting: the only static imports above are node
// built-ins, and every schema module is pulled in via dynamic `await import()`
// below — i.e. after this line runs. Keeps the script correct when invoked
// directly (`tsx scripts/check-variant-docs.mts`), not just via the pnpm script.
process.env.OS_EAGER_SCHEMAS ??= '1';

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

  if (d.type === 'union' && d.discriminator) {
    const variants: string[] = [];
    for (const o of d.options ?? []) {
      const od = defOf(o);
      const shape = typeof od?.shape === 'function' ? od.shape() : od?.shape;
      const dd = defOf(shape?.[d.discriminator]);
      const vals = dd?.values ?? (dd?.value !== undefined ? [dd.value] : []);
      for (const v of vals) variants.push(String(v));
    }
    if (variants.length) {
      const key = `${d.discriminator}:${[...variants].sort().join('|')}`;
      if (!found.has(key)) found.set(key, { disc: d.discriminator, variants, path: p });
    }
  }

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
    return !anchored.test(blob) && !token.test(blob);
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
