// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Check YAML Examples (anti-drift for the AUTHORING format, #13086)
 *
 * `check:skill-examples` compiles prose TypeScript against the live spec — and
 * reads ONLY ```ts / ```tsx / ```typescript fences, opt-in via `os:check`. But
 * metadata authoring examples are written in YAML: object definitions, view
 * layouts, sections, fields, actions. So the format that carries almost every
 * example a metadata author copies was precisely the format no gate read — a
 * YAML fence was not a skipped block or an unchecked one, it was not in any
 * gate's population at all. `content/docs/protocol/objectui/layout-dsl.mdx`
 * taught a field-level `visible` breakpoint map and a section-level `columns`
 * orientation map for its whole life (#12935), through two hand sweeps of the
 * same page (#8251, #8306), because a hand sweep was the only instrument there
 * was. Every schema involved is `.strict()`, so a documented key the schema
 * does not declare is a save-blocking parse error for whoever copies it — and
 * an AI reading these pages has no channel by which to discover that the YAML
 * it is copying cannot parse.
 *
 * Ruled 2026-08-29 (#13086): mirror the `os:check` mechanism with an opt-in
 * marker for YAML fences; validate each tagged block with the live spec
 * schema's `safeParse`, reporting the fence position and the schema's own
 * rename-hint text verbatim; print a tagged/untagged coverage census so opt-in
 * adoption is visible rather than a permanent excuse; corpus-wide tagging is a
 * follow-up card, not this gate's job.
 *
 * ── The marker ──────────────────────────────────────────────────────────────
 * A block opts in with a comment on the line DIRECTLY above its bare ```yaml
 * (or ```yml) fence, in the file format's own comment syntax — the same split
 * `os:check` uses, for the same reason (MDX has no HTML comments; fumadocs
 * fails the build on one). In `.md` under skills/ the marker is the HTML
 * comment `<!-- os:check-yaml <decl> -->`; in `.mdx` under content/docs/ it is
 * the same text wrapped in MDX's curly-brace expression comment (see
 * `MDX_MARKER_RE` below — that spelling ends in the star-slash pair, so this
 * block comment cannot write it out, the same constraint the sibling gate's
 * header records).
 *
 * `<decl>` names the metadata type or schema the block claims to instantiate:
 *
 *     os:check-yaml object                        # registry metadata type
 *     os:check-yaml FormSectionSchema             # exported schema name
 *     os:check-yaml FormSectionSchema[] key=sections
 *
 *   - a lowercase name (`object`, `view`, `page`, …) resolves through
 *     `getMetadataTypeSchema()` — the SAME registry `MetadataManager.validate`
 *     and `PUT /api/v1/meta/:type/:name` validate with, so "the docs' example
 *     parses" and "the runtime accepts it" are one fact, not two;
 *   - a PascalCase name (`FormSectionSchema`, `PageRegionSchema`, …) resolves
 *     against the spec's own category namespaces (the same 15 namespaces
 *     `build-schemas.ts` walks), because most doc examples are FRAGMENTS — a
 *     single section, a list of fields — that are complete instances of a
 *     NAMED sub-schema without being a whole metadata item. An ambiguous name
 *     (exported by two namespaces as different declarations) is refused with
 *     the qualified spellings (`UI.ActionSchema`) listed;
 *   - `[]` claims the value is an ARRAY of instances, validated element-wise;
 *   - `key=<k>` claims the document is a single-key wrapper object (`sections:`,
 *     `section:` — the pedagogical framing many pages use) and validates the
 *     value under that key. The wrapper is part of the claim: any other key
 *     beside it is a loud failure, not an ignorable extra.
 *
 * The fence stays a bare ```yaml — no fence-meta tag — so every other scanner
 * keyed on the fence line keeps seeing the block (the same reasoning as
 * `os:check`'s design). A marker above a fence that carries meta, above a
 * non-YAML fence, mis-spelled for its file format, separated by a blank line,
 * or with a missing/unparseable declaration is an ERROR, never a silent no-op:
 * a placed-but-inert marker is worse than no marker, because it reads as
 * covered.
 *
 * ── What a rejection reports ────────────────────────────────────────────────
 * The fence's `file:line`, the declared target, and every Zod issue's `path`
 * plus its `message` VERBATIM. The message is where the spec's rename-hint
 * machinery lives (the shared strict-object helpers attach prescriptions to
 * `unrecognized_keys` — e.g. `visible` on a form section names `visibleWhen`
 * and cites ADR-0089), so this gate deliberately adds no vocabulary of its
 * own: the author reads exactly the rejection a runtime save would print.
 *
 * ── Coverage census (opt-in must stay visible) ──────────────────────────────
 * Every run prints how many top-level YAML fences the corpus carries and how
 * many are tagged. Opt-in means an untagged block is still invisible to this
 * gate — the census is what keeps that a number someone can push down rather
 * than a permanent excuse (the ratchet-to-zero posture, per the ruling). Two
 * vacuous-green guards go RED rather than report an empty success: zero YAML
 * fences found at all (the walk is mis-rooted — content/docs always has
 * them), and zero TAGGED fences (the marker got renamed or stripped, or the
 * gate checks nothing — either way, green would be a lie).
 *
 * ── Population and its deliberate edges ─────────────────────────────────────
 * Roots mirror `check:skill-examples`' prose surface: `.md` under `skills/`
 * and `.mdx` under `content/docs/` minus `content/docs/references/` (generated by
 * `build-docs.ts` — its snippets cannot drift independently of their source).
 * There is ONE resolution environment (the live schemas), so the TS gate's
 * surface split — which exists purely for module resolution — does not apply,
 * and the SDK-page carve-out with it. TSDoc `@example` roots are out of scope:
 * their examples are TypeScript by construction. The fence walker is the
 * #10533 shape (`fenceOwners`), lifted the same way `check-skill-examples.ts`
 * lifted it: a ts/yaml fence shown INSIDE a wrapping ```md illustration opens
 * nothing, and a marker shown inside one claims nothing.
 *
 * Usage:
 *   tsx scripts/check-yaml-examples.ts               # scan + validate (CI)
 *   tsx scripts/check-yaml-examples.ts --coverage    # also print the full per-file census
 *   tsx scripts/check-yaml-examples.ts --self-test   # pin extraction, refusal and verbatim reporting
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseAllDocuments } from 'yaml';
import type { z } from 'zod';

import {
  getMetadataTypeSchema,
  listMetadataTypeSchemaTypes,
} from '../src/kernel/metadata-type-schemas';
import * as AI from '../src/ai';
import * as API from '../src/api';
import * as Automation from '../src/automation';
import * as Cloud from '../src/cloud';
import * as Contracts from '../src/contracts';
import * as Data from '../src/data';
import * as Identity from '../src/identity';
import * as Integration from '../src/integration';
import * as Kernel from '../src/kernel';
import * as QA from '../src/qa';
import * as Security from '../src/security';
import * as Shared from '../src/shared';
import * as Studio from '../src/studio';
import * as System from '../src/system';
import * as UI from '../src/ui';

// ── Paths & roots ────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** A prose root: where to look, and which marker spelling opts a block in. */
interface YamlRoot {
  dir: string;
  ext: string;
  label: string;
  /** Anchored against the TRIMMED line directly above a fence; group 1 is the
   *  declaration text. Only a root's own spelling opts a block in — the other
   *  spelling is caught by the orphan scan (and, in `.mdx`, breaks the docs
   *  build outright, exactly like the `os:check` marker split). */
  markerRe: RegExp;
  /** The spelling shown in error messages. */
  markerExample: string;
  /** Absolute directories to skip entirely (generated docs). */
  exclude?: string[];
}

const MD_MARKER_RE = /^<!--\s*os:check-yaml\b\s*(.*?)\s*-->$/;
const MDX_MARKER_RE = /^\{\/\*\s*os:check-yaml\b\s*(.*?)\s*\*\/\}$/;
/** ANY spelling of the marker, for orphan detection — a wrong-format or
 *  misplaced marker checks nothing, which is precisely the failure mode the
 *  orphan scan exists to catch. */
const ANY_MARKER_RE = /(?:<!--|\{\/\*)\s*os:check-yaml\b/;

const REAL_ROOTS: YamlRoot[] = [
  {
    dir: path.resolve(REPO_ROOT, 'skills'),
    ext: '.md',
    label: 'skills',
    markerRe: MD_MARKER_RE,
    markerExample: '<!-- os:check-yaml <schema> -->',
  },
  {
    dir: path.resolve(REPO_ROOT, 'content/docs'),
    ext: '.mdx',
    label: 'docs',
    markerRe: MDX_MARKER_RE,
    markerExample: '{/* os:check-yaml <schema> */}',
    exclude: [path.resolve(REPO_ROOT, 'content/docs/references')],
  },
];

const rel = (p: string) => path.relative(REPO_ROOT, p);

// ── Fence walk (the #10533 shape, as lifted by check-skill-examples.ts) ──────

/**
 * ANY CommonMark-shaped opening code fence — up to three spaces of indent, a
 * run of three or more backticks, and an info string that cannot itself
 * contain a backtick.
 */
const ANY_FENCE_OPEN_RE = /^ {0,3}(`{3,})([^`]*)$/;

/** Fence languages this gate reads. The info string must be EXACTLY the
 *  language (no fence meta), mirroring `check:skill-examples`' bare-fence
 *  rule: a meta tag would punch a hole in every scanner keyed on the line. */
const BARE_YAML_FENCE_RE = /^```(?:yaml|yml)\s*$/;

const YAML_LANGS = new Set(['yaml', 'yml']);

/**
 * Which TOP-LEVEL fenced block owns each line — of ANY language, spanning both
 * its opening and closing fence line. The value is the index of the line that
 * OPENED the block, or `-1` for a line at true top level. Each opener's
 * `closeLine` is recorded alongside so extraction never re-derives a second,
 * looser closer that could disagree with the walk's (#11690's lesson in the
 * sibling gate).
 */
function fenceOwners(lines: string[]): { owners: number[]; closeLine: number[] } {
  const owners = new Array<number>(lines.length).fill(-1);
  const closeLine = new Array<number>(lines.length).fill(-1);
  for (let i = 0; i < lines.length; i++) {
    const open = ANY_FENCE_OPEN_RE.exec(lines[i]);
    if (!open) continue;
    const run = open[1].length;
    const closeFence = new RegExp(`^ {0,3}\`{${run},}[ \\t]*$`);
    let end = i + 1;
    while (end < lines.length && !closeFence.test(lines[end])) end++;
    for (let s = i; s < Math.min(end + 1, lines.length); s++) owners[s] = i;
    closeLine[i] = end;
    i = end;
  }
  return { owners, closeLine };
}

// ── Extraction ───────────────────────────────────────────────────────────────

interface TaggedBlock {
  /** Source file (absolute). */
  source: string;
  /** 1-based line of the fence-OPEN line itself — the position a rejection reports. */
  fenceLine: number;
  /** 1-based line in the source of the FIRST code line inside the fence. */
  bodyStartLine: number;
  /** Raw fence body. */
  code: string;
  /** The marker's declaration text, verbatim (may be empty — refused later, loudly). */
  decl: string;
}

interface OrphanFinding {
  file: string;
  /** 1-based line of the offending marker. */
  line: number;
  hint: string;
}

interface FenceCensusEntry {
  file: string;
  fenceLine: number;
  tagged: boolean;
}

interface ScanResult {
  tagged: TaggedBlock[];
  orphans: OrphanFinding[];
  /** EVERY top-level fence whose info string's first token is yaml/yml —
   *  tagged or not, bare or meta-carrying. The census is over this set. */
  population: FenceCensusEntry[];
}

/** Every candidate prose file across the given roots. */
function sourceFiles(roots: YamlRoot[]): Array<{ file: string; root: YamlRoot }> {
  const out: Array<{ file: string; root: YamlRoot }> = [];
  for (const root of roots) {
    if (!fs.existsSync(root.dir)) continue;
    const walk = (dir: string) => {
      if (root.exclude?.some((x) => dir === x || dir.startsWith(x + path.sep))) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(root.ext)) out.push({ file: full, root });
      }
    };
    walk(root.dir);
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Pull every top-level YAML fence out of one prose file: the tagged ones (a
 * marker with the root's own spelling on the line immediately above a BARE
 * yaml fence), the census population, and every orphaned marker.
 *
 * Both halves are fence-aware via one `fenceOwners()` walk: a yaml fence-open
 * line that is itself example text inside a wrapping fence opens nothing, and
 * a marker shown inside such a fence claims nothing and is no orphan either.
 */
function scanFile(source: string, root: YamlRoot): ScanResult {
  const lines = fs.readFileSync(source, 'utf-8').split('\n');
  const { owners, closeLine } = fenceOwners(lines);
  const tagged: TaggedBlock[] = [];
  const orphans: OrphanFinding[] = [];
  const population: FenceCensusEntry[] = [];
  const claimed = new Set<number>(); // marker line indices that opted a real block in

  for (let i = 0; i < lines.length; i++) {
    const open = ANY_FENCE_OPEN_RE.exec(lines[i]);
    if (!open || owners[i] !== i) continue; // not a top-level fence opener
    const info = open[2].trim();
    const lang = (info.split(/\s+/)[0] || '').toLowerCase();
    if (YAML_LANGS.has(lang)) {
      const bare = BARE_YAML_FENCE_RE.test(lines[i]);
      const markerMatch = i > 0 ? root.markerRe.exec(lines[i - 1].trim()) : null;
      let isTagged = false;
      if (markerMatch) {
        if (bare) {
          claimed.add(i - 1);
          isTagged = true;
          tagged.push({
            source,
            fenceLine: i + 1,
            bodyStartLine: i + 2,
            code: lines.slice(i + 1, closeLine[i]).join('\n'),
            decl: markerMatch[1].trim(),
          });
        } else {
          // The marker is adjacent, but the fence carries meta (or extra
          // indentation) the bare-fence rule refuses — the block would be
          // silently unchecked. Claim the marker so it is reported ONCE, here.
          claimed.add(i - 1);
          orphans.push({
            file: source,
            line: i,
            hint: `the fence below it is not a bare \`\`\`yaml — strip the fence meta (this gate, like os:check, keys on the bare fence line)`,
          });
        }
      }
      population.push({ file: source, fenceLine: i + 1, tagged: isTagged });
    }
    i = closeLine[i]; // skip to the close fence
  }

  for (let i = 0; i < lines.length; i++) {
    // Top level only: a marker shown INSIDE some other fenced block (e.g. a
    // ```md illustration of this very convention) is example text, not a claim.
    if (owners[i] >= 0) continue;
    if (ANY_MARKER_RE.test(lines[i].trim()) && !claimed.has(i)) {
      orphans.push({
        file: source,
        line: i + 1,
        hint: `not directly above a bare \`\`\`yaml fence (no blank line between, ${root.markerExample} spelling for this file type)`,
      });
    }
  }
  return { tagged, orphans, population };
}

function scanRoots(roots: YamlRoot[]): ScanResult {
  const tagged: TaggedBlock[] = [];
  const orphans: OrphanFinding[] = [];
  const population: FenceCensusEntry[] = [];
  for (const { file, root } of sourceFiles(roots)) {
    const r = scanFile(file, root);
    tagged.push(...r.tagged);
    orphans.push(...r.orphans);
    population.push(...r.population);
  }
  return { tagged, orphans, population };
}

// ── Declaration parsing & schema resolution ──────────────────────────────────

interface ParsedDecl {
  /** Registry type (`object`) or exported schema name (`FormSectionSchema`,
   *  optionally qualified `UI.ActionSchema`). */
  name: string;
  /** `[]` suffix: the value is an array of instances, validated element-wise. */
  array: boolean;
  /** `key=<k>`: the document is a single-key wrapper object around the value. */
  wrapperKey?: string;
}

const DECL_NAME_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*$/;
const REGISTRY_NAME_RE = /^[a-z][a-z0-9_]*$/;

function parseDecl(raw: string): { decl?: ParsedDecl; error?: string } {
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return {
      error:
        'the marker declares no schema — write `os:check-yaml <metadata-type | SchemaName>` ' +
        '(optionally `<SchemaName>[]` and `key=<wrapper>`)',
    };
  }
  const first = tokens[0];
  const array = first.endsWith('[]');
  const name = array ? first.slice(0, -2) : first;
  if (!DECL_NAME_RE.test(name)) {
    return { error: `\`${first}\` is not a metadata type or schema name` };
  }
  let wrapperKey: string | undefined;
  for (const t of tokens.slice(1)) {
    const m = /^key=([A-Za-z_][A-Za-z0-9_]*)$/.exec(t);
    if (!m) return { error: `unrecognised marker token \`${t}\` (only \`key=<wrapper>\` is understood)` };
    if (wrapperKey) return { error: 'duplicate `key=` token' };
    wrapperKey = m[1];
  }
  return { decl: { name, array, wrapperKey } };
}

/**
 * The spec's own category namespaces — the same 15 `build-schemas.ts` walks,
 * so every schema the generated docs can name is addressable here. Exports
 * are fetched lazily (a lazySchema Proxy constructs on first property
 * access), so only the names markers actually declare are ever probed.
 */
const NAMESPACES: Record<string, Record<string, unknown>> = {
  AI, API, Automation, Cloud, Contracts, Data, Identity, Integration,
  Kernel, QA, Security, Shared, Studio, System, UI,
};

type NameIndex = Record<string, Record<string, unknown>>;

function isZodSchema(v: unknown): v is z.ZodType {
  return (
    (typeof v === 'object' || typeof v === 'function') &&
    v !== null &&
    typeof (v as { safeParse?: unknown }).safeParse === 'function'
  );
}

/**
 * Resolve a declaration name to a live Zod schema.
 *
 * Lowercase names go through `getMetadataTypeSchema()` — the runtime's own
 * metadata-type → schema registry. PascalCase names resolve against the
 * category namespaces; a name exported by several namespaces as the SAME
 * declaration (a re-export) is fine, DIFFERENT declarations under one name
 * are refused with the qualified spellings listed.
 */
function resolveDeclName(name: string, namespaces: NameIndex): { schema?: z.ZodType; error?: string } {
  if (REGISTRY_NAME_RE.test(name)) {
    const schema = getMetadataTypeSchema(name);
    if (!schema) {
      return {
        error:
          `\`${name}\` is not a registered metadata type. Registered types: ` +
          listMetadataTypeSchemaTypes().join(', ') +
          ` — or declare an exported schema name (e.g. \`FormSectionSchema\`).`,
      };
    }
    return { schema };
  }

  const dot = name.indexOf('.');
  if (dot >= 0) {
    const nsName = name.slice(0, dot);
    const member = name.slice(dot + 1);
    const ns = namespaces[nsName];
    if (!ns) return { error: `unknown namespace \`${nsName}\` (have: ${Object.keys(namespaces).join(', ')})` };
    if (!(member in ns)) return { error: `\`${member}\` is not exported by the \`${nsName}\` namespace` };
    const value = ns[member];
    if (!isZodSchema(value)) return { error: `\`${name}\` resolves, but is not a Zod schema (no safeParse)` };
    return { schema: value };
  }

  const hits: Array<{ nsName: string; value: unknown }> = [];
  for (const [nsName, ns] of Object.entries(namespaces)) {
    if (name in ns) hits.push({ nsName, value: ns[name] });
  }
  if (hits.length === 0) {
    const lower = name.toLowerCase();
    const near = new Set<string>();
    for (const ns of Object.values(namespaces)) {
      for (const k of Object.keys(ns)) {
        if (k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())) near.add(k);
      }
    }
    return {
      error:
        `no spec namespace exports \`${name}\`` +
        (near.size > 0 ? ` — did you mean: ${Array.from(near).sort().slice(0, 8).join(', ')}?` : ''),
    };
  }
  const distinct = new Map<unknown, string>();
  for (const h of hits) if (!distinct.has(h.value)) distinct.set(h.value, h.nsName);
  if (distinct.size > 1) {
    return {
      error:
        `\`${name}\` is exported by several namespaces as different declarations — qualify it: ` +
        Array.from(distinct.values()).sort().map((ns) => `\`${ns}.${name}\``).join(' or '),
    };
  }
  const value = hits[0].value;
  if (!isZodSchema(value)) return { error: `\`${name}\` resolves, but is not a Zod schema (no safeParse)` };
  return { schema: value };
}

// ── Validation ───────────────────────────────────────────────────────────────

const formatPath = (p: ReadonlyArray<PropertyKey>): string =>
  p.length === 0 ? '(root)' : p.map((k) => String(k)).join('.');

function formatIssues(result: z.ZodSafeParseResult<unknown>, prefix: string): string[] {
  if (result.success) return [];
  // The `message` is printed VERBATIM: it is where the spec's rename-hint
  // machinery lives, and this gate deliberately adds no vocabulary of its own.
  return result.error.issues.map((iss) => `    · at ${prefix}${formatPath(iss.path)}: ${iss.message}`);
}

/**
 * Validate ONE tagged block. Returns human-readable finding lines (empty =
 * the block holds its claim). Blocks are independent — one block's refusal
 * never suppresses another's verdict (unlike the sibling gate's tsc program,
 * where a single parse error stops a whole surface's semantic pass).
 */
function checkBlock(block: TaggedBlock, namespaces: NameIndex): string[] {
  const { decl, error } = parseDecl(block.decl);
  if (!decl) return [`    · marker: ${error ?? 'unparseable declaration'}`];

  const resolved = resolveDeclName(decl.name, namespaces);
  if (!resolved.schema) return [`    · marker: ${resolved.error ?? 'unresolvable declaration'}`];
  const schema = resolved.schema;

  const docs = parseAllDocuments(block.code, { uniqueKeys: true });
  const parseErrors: string[] = [];
  for (const doc of docs) {
    for (const e of doc.errors) {
      const line = e.linePos?.[0]?.line;
      const at = line === undefined ? '' : ` (${rel(block.source)}:${block.bodyStartLine + line - 1})`;
      parseErrors.push(`    · YAML does not parse${at}: ${e.message.split('\n')[0]}`);
    }
  }
  if (parseErrors.length > 0) return parseErrors;
  if (docs.length === 0) {
    return ['    · the tagged block parses to no YAML document — an empty claim checks nothing; fill it or drop the marker'];
  }
  if (docs.length > 1) {
    return [`    · the tagged block contains ${docs.length} YAML documents — a marker claims exactly one; split the fence`];
  }

  let value: unknown;
  try {
    value = docs[0].toJS();
  } catch (e) {
    return [`    · YAML does not convert to a plain value: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`];
  }
  if (value === null || value === undefined) {
    return ['    · the tagged block parses to no value — an empty claim checks nothing; fill it or drop the marker'];
  }

  if (decl.wrapperKey) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      return [`    · \`key=${decl.wrapperKey}\` claims a single-key wrapper object, but the document is not a mapping`];
    }
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length !== 1 || keys[0] !== decl.wrapperKey) {
      return [
        `    · \`key=${decl.wrapperKey}\` claims the document has exactly one top-level key \`${decl.wrapperKey}\`, ` +
          `but it has: ${keys.map((k) => `\`${k}\``).join(', ') || '(none)'}`,
      ];
    }
    value = (value as Record<string, unknown>)[decl.wrapperKey];
  }

  if (decl.array) {
    if (!Array.isArray(value)) {
      return [`    · \`${decl.name}[]\` claims an array of instances, but the ${decl.wrapperKey ? `\`${decl.wrapperKey}\` value` : 'document'} is not a sequence`];
    }
    const findings: string[] = [];
    value.forEach((element, idx) => {
      findings.push(...formatIssues(schema.safeParse(element), `[${idx}] `));
    });
    return findings;
  }

  return formatIssues(schema.safeParse(value), '');
}

// ── Census ───────────────────────────────────────────────────────────────────

function printCensus(population: FenceCensusEntry[], full: boolean): void {
  const tagged = population.filter((p) => p.tagged).length;
  const untagged = population.length - tagged;
  const byFile = new Map<string, { tagged: number; untagged: number }>();
  for (const p of population) {
    const row = byFile.get(p.file) ?? { tagged: 0, untagged: 0 };
    if (p.tagged) row.tagged += 1;
    else row.untagged += 1;
    byFile.set(p.file, row);
  }
  console.log(
    `📊 YAML fence coverage: ${tagged} tagged / ${untagged} untagged across ${byFile.size} file(s) — ` +
      `an untagged fence is invisible to this gate; tag complete instances with os:check-yaml`,
  );
  const rows = Array.from(byFile.entries()).sort((a, b) => b[1].untagged - a[1].untagged || a[0].localeCompare(b[0]));
  const shown = full ? rows : rows.filter((r) => r[1].untagged > 0).slice(0, 5);
  for (const [file, row] of shown) {
    console.log(`     ${rel(file)}: ${row.tagged} tagged / ${row.untagged} untagged`);
  }
  if (!full && rows.filter((r) => r[1].untagged > 0).length > shown.length) {
    console.log(`     … (${rows.filter((r) => r[1].untagged > 0).length - shown.length} more file(s) — run with --coverage for the full table)`);
  }
  console.log('');
}

// ── Main ─────────────────────────────────────────────────────────────────────

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function main(): void {
  console.log('🧪 Validating tagged YAML metadata examples against live spec schemas...\n');

  const scan = scanRoots(REAL_ROOTS);

  // Orphans first, across every root, before any block verdict — a
  // placed-but-inert marker must never be masked by an unrelated failure.
  if (scan.orphans.length > 0) {
    fail(
      `Found os:check-yaml marker(s) that opt nothing in:\n\n` +
        scan.orphans.map((o) => `  - ${rel(o.file)}:${o.line}  ${o.hint}`).join('\n') +
        `\n\n  The marker must be the line IMMEDIATELY above a bare \`\`\`yaml fence.\n` +
        `  Move it, fix its spelling, or remove it if the block should not be checked.`,
    );
  }

  // Vacuous-green guards: this gate exists because an invisible population
  // reads as coverage. An empty walk or an empty opt-in set is a defect in
  // the gate's own wiring, never a success.
  if (scan.population.length === 0) {
    fail(
      'No YAML fences found at all — the corpus walk is mis-rooted (content/docs always carries them). ' +
        'This gate refuses to report an empty green.',
    );
  }
  printCensus(scan.population, process.argv.includes('--coverage'));
  if (scan.tagged.length === 0) {
    fail(
      'No tagged YAML examples found. Opt-in with zero opt-ins checks nothing — if you just removed ' +
        'the last os:check-yaml marker, that is almost certainly a mistake; ' +
        'content/docs/protocol/objectui/layout-dsl.mdx carried the first tagged blocks (#13086).',
    );
  }

  const failures: Array<{ block: TaggedBlock; findings: string[] }> = [];
  for (const block of scan.tagged) {
    const findings = checkBlock(block, NAMESPACES);
    if (findings.length > 0) failures.push({ block, findings });
  }

  if (failures.length > 0) {
    console.error(`✗ ${failures.length} of ${scan.tagged.length} tagged YAML block(s) do not hold their claim:\n`);
    for (const { block, findings } of failures) {
      console.error(`  ${rel(block.source)}:${block.fenceLine}  (os:check-yaml ${block.decl || '<empty>'})`);
      for (const f of findings) console.error(f);
      console.error('');
    }
    console.error(
      `  These are examples an author — human or AI — copies verbatim, and every rejection above\n` +
        `  is the one a runtime save would print. Fix the YAML to match the live schema, or drop\n` +
        `  the os:check-yaml marker if the block is an intentional fragment.`,
    );
    process.exit(1);
  }

  console.log(
    `✅ ${scan.tagged.length} tagged YAML example(s) across ` +
      `${new Set(scan.tagged.map((t) => t.source)).size} file(s) validate against their declared live spec schemas`,
  );
}

// ── Self-test ────────────────────────────────────────────────────────────────

/**
 * Pins the properties a clean tree cannot exercise: extraction and adjacency,
 * fence-awareness, every refusal channel, and — the one this gate exists for
 * — that a strict schema's rejection text reaches the output VERBATIM. Each
 * scenario is a fixture tree in a fresh tmpdir, run through the same
 * `scanRoots` + `checkBlock` pipeline as production.
 */
function selfTest(): never {
  let failures = 0;
  let n = 0;
  const check = (name: string, ok: boolean, detail?: string) => {
    n += 1;
    if (ok) console.log(`  ✓ ${name}`);
    else {
      failures += 1;
      console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
    }
  };

  const fixtureScan = (files: Record<string, string>): ScanResult => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-examples-selftest-'));
    try {
      for (const [name, body] of Object.entries(files)) {
        const full = path.join(dir, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
      }
      const roots: YamlRoot[] = [
        { dir, ext: '.mdx', label: 'fixture', markerRe: MDX_MARKER_RE, markerExample: '{/* os:check-yaml <schema> */}' },
        { dir, ext: '.md', label: 'fixture-md', markerRe: MD_MARKER_RE, markerExample: '<!-- os:check-yaml <schema> -->' },
      ];
      return scanRoots(roots);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  console.log('Self-test: extraction & adjacency');
  {
    const scan = fixtureScan({
      'page.mdx': [
        '# t',
        '',
        '{/* os:check-yaml FormSectionSchema key=section */}',
        '```yaml',
        'section:',
        '  label: X',
        '  fields: [a]',
        '```',
        '',
        '```yaml',
        'untagged: true',
        '```',
        '',
      ].join('\n'),
    });
    check('a marked bare yaml fence is extracted with its declaration',
      scan.tagged.length === 1 && scan.tagged[0].decl === 'FormSectionSchema key=section',
      JSON.stringify(scan.tagged.map((t) => t.decl)));
    check('the census counts tagged and untagged fences',
      scan.population.length === 2 && scan.population.filter((p) => p.tagged).length === 1);
    check('an unmarked fence produces no orphan', scan.orphans.length === 0, JSON.stringify(scan.orphans));
    check('the extracted body is the fence body verbatim',
      scan.tagged[0]?.code === 'section:\n  label: X\n  fields: [a]');
  }
  {
    const scan = fixtureScan({
      'ill.mdx': [
        'Illustration of the convention:',
        '',
        '````md',
        '{/* os:check-yaml FormSectionSchema */}',
        '```yaml',
        'label: nested illustration, not a claim',
        '```',
        '````',
        '',
      ].join('\n'),
    });
    check('a fully worked illustration INSIDE a wrapping fence extracts nothing and orphans nothing',
      scan.tagged.length === 0 && scan.orphans.length === 0 && scan.population.length === 0,
      JSON.stringify(scan));
  }

  console.log('Self-test: orphan channels (a placed-but-inert marker is an error, never a no-op)');
  {
    const scan = fixtureScan({
      'a.mdx': '{/* os:check-yaml view */}\n```bash\necho hi\n```\n',
      'b.mdx': '{/* os:check-yaml view */}\n\n```yaml\na: 1\n```\n',
      'c.mdx': '{/* os:check-yaml view */}\n```yaml title="x"\na: 1\n```\n',
      'd.mdx': '<!-- os:check-yaml view -->\n```yaml\na: 1\n```\n',
    });
    check('marker above a non-yaml fence → orphan', scan.orphans.some((o) => o.file.endsWith('a.mdx')));
    check('blank line between marker and fence → orphan', scan.orphans.some((o) => o.file.endsWith('b.mdx')));
    check('marker above a meta-carrying yaml fence → orphan with the fence-meta hint',
      scan.orphans.some((o) => o.file.endsWith('c.mdx') && o.hint.includes('bare')));
    check('wrong comment spelling for the file type → orphan', scan.orphans.some((o) => o.file.endsWith('d.mdx')));
    check('none of the four opted anything in', scan.tagged.length === 0);
  }

  console.log('Self-test: declaration parsing & resolution');
  {
    const empty = parseDecl('');
    check('empty declaration is refused', !!empty.error);
    const bad = parseDecl('FormSectionSchema wat=1');
    check('unknown marker token is refused', !!bad.error && bad.error.includes('wat=1'), bad.error);
    const ok = parseDecl('FormSectionSchema[] key=sections');
    check('array + wrapper parse', !!ok.decl && ok.decl.array && ok.decl.wrapperKey === 'sections' && ok.decl.name === 'FormSectionSchema');

    const reg = resolveDeclName('view', NAMESPACES);
    check('a registry metadata type resolves to a live schema', !!reg.schema && isZodSchema(reg.schema));
    const unknownReg = resolveDeclName('not_a_type', NAMESPACES);
    check('an unknown registry type is refused, listing the registered set',
      !!unknownReg.error && unknownReg.error.includes('object'), unknownReg.error);
    const named = resolveDeclName('FormSectionSchema', NAMESPACES);
    check('an exported schema name resolves', !!named.schema && isZodSchema(named.schema));
    const unknownName = resolveDeclName('NoSuchSchemaAnywhere', NAMESPACES);
    check('an unknown schema name is refused', !!unknownName.error);
    const notSchema = resolveDeclName('Kernel.getMetadataTypeSchema', NAMESPACES);
    check('an export that is not a Zod schema is refused', !!notSchema.error && notSchema.error.includes('not a Zod schema'), notSchema.error);

    const synthetic: NameIndex = {
      A: { Twin: { safeParse: () => ({ success: true }) } },
      B: { Twin: { safeParse: () => ({ success: true }) } },
    };
    const ambiguous = resolveDeclName('Twin', synthetic);
    check('two different declarations under one name are refused with qualified spellings',
      !!ambiguous.error && ambiguous.error.includes('A.Twin') && ambiguous.error.includes('B.Twin'), ambiguous.error);
    const shared = { safeParse: () => ({ success: true }) };
    const reexport = resolveDeclName('Twin', { A: { Twin: shared }, B: { Twin: shared } });
    check('the SAME declaration re-exported twice is not ambiguous', !!reexport.schema);
  }

  console.log('Self-test: validation & verbatim reporting');
  const block = (code: string, decl: string): TaggedBlock => ({
    source: path.join(REPO_ROOT, 'fixture.mdx'), fenceLine: 1, bodyStartLine: 2, code, decl,
  });
  {
    const good = checkBlock(block('label: X\nfields: [a, b]\n', 'FormSectionSchema'), NAMESPACES);
    check('a valid instance produces no findings', good.length === 0, good.join(' | '));

    // The property this whole gate exists for: the strict schema's own
    // rejection — rename hint included — reaches the output VERBATIM. The
    // expected text is read from the live schema at test time, so this pin
    // follows the spec's wording instead of fossilising a copy of it.
    const live = resolveDeclName('FormSectionSchema', NAMESPACES);
    const expected = live.schema!.safeParse({ label: 'X', visible: { desktop: true }, fields: ['a'] });
    const expectedMsg = expected.success ? '' : expected.error.issues[0].message;
    const findings = checkBlock(block('label: X\nvisible:\n  desktop: true\nfields: [a]\n', 'FormSectionSchema'), NAMESPACES);
    check('a strict rejection reaches the output with the schema\'s own message verbatim',
      expectedMsg.length > 0 && findings.some((f) => f.includes(expectedMsg)),
      `expected to find: ${expectedMsg.slice(0, 80)}… in ${findings.join(' | ').slice(0, 160)}`);

    const wrapped = checkBlock(block('sections:\n  - label: A\n    fields: [x]\n  - label: B\n    visible: nope\n    fields: [y]\n', 'FormSectionSchema[] key=sections'), NAMESPACES);
    check('array validation reports the failing ELEMENT, indexed',
      wrapped.length > 0 && wrapped.every((f) => f.includes('[1]')), wrapped.join(' | '));

    const wrongWrap = checkBlock(block('section:\n  label: A\n  fields: [x]\n', 'FormSectionSchema[] key=sections'), NAMESPACES);
    check('a wrapper-key mismatch is a loud finding naming the actual keys',
      wrongWrap.length === 1 && wrongWrap[0].includes('`section`'), wrongWrap.join(' | '));

    const extraKey = checkBlock(block('sections: []\nextra: 1\n', 'FormSectionSchema[] key=sections'), NAMESPACES);
    check('a second key beside the wrapper is a loud finding', extraKey.length === 1 && extraKey[0].includes('`extra`'));

    const notArray = checkBlock(block('sections:\n  label: A\n', 'FormSectionSchema[] key=sections'), NAMESPACES);
    check('[] over a non-sequence is a loud finding', notArray.length === 1 && notArray[0].includes('not a sequence'));

    const badYaml = checkBlock(block('a: 1\na: 2\n', 'FormSectionSchema'), NAMESPACES);
    check('a YAML parse error (duplicate key) is a finding with a mapped source line',
      badYaml.length > 0 && badYaml[0].includes('fixture.mdx:3'), badYaml.join(' | '));

    const emptyBlock = checkBlock(block('# just a comment\n', 'FormSectionSchema'), NAMESPACES);
    check('a tagged block that parses to no document is refused as an empty claim',
      emptyBlock.length === 1 && emptyBlock[0].includes('empty claim'));

    const multiDoc = checkBlock(block('a: 1\n---\nb: 2\n', 'FormSectionSchema'), NAMESPACES);
    check('a multi-document block is refused', multiDoc.length === 1 && multiDoc[0].includes('2 YAML documents'));

    const emptyDecl = checkBlock(block('label: X\nfields: [a]\n', ''), NAMESPACES);
    check('an empty declaration is a finding, not a silent pass',
      emptyDecl.length === 1 && emptyDecl[0].includes('declares no schema'));
  }

  console.log('Self-test: vacuous-green guards');
  {
    const scan = fixtureScan({ 'no-yaml.mdx': '# nothing fenced here\n' });
    check('an empty corpus yields zero population (main() turns that into a hard failure)',
      scan.population.length === 0 && scan.tagged.length === 0);
    const some = fixtureScan({ 'has.mdx': '```yaml\na: 1\n```\n' });
    check('a corpus with only untagged fences yields population > 0 and tagged = 0 (main() fails loudly on it)',
      some.population.length === 1 && some.tagged.length === 0);
  }

  if (failures > 0) {
    console.error(`\n✗ self-test: ${failures} of ${n} case(s) failed`);
    process.exit(1);
  }
  console.log(`\n✅ self-test: all ${n} case(s) hold`);
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();
main();
