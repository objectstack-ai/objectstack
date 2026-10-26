#!/usr/bin/env node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every key taught on a `**Keys:**` bullet in `.github/prompts/**` must be
 * answered by a REAL renderer — not only by the opt-in protocol placeholder
 * (objectui#8929).
 *
 *   Run:  node scripts/check-prompt-component-keys.mjs   (`pnpm check:prompt-keys`)
 *   Exit: 0 = every taught key resolves to a real component
 *         1 = a taught key resolves to nothing, or resolves only to the
 *             placeholder panel, or this gate's own derivation collapsed
 *
 * ## The defect, and why the obvious fix is a no-op
 *
 * `.github/prompts/**` is read by an AI that then writes metadata. A stale key
 * there is not one wrong page: it is every generated document reaching for a
 * key the registry no longer answers with anything renderable.
 *
 * The card that opened this gate found two such keys on one bullet, `view:kanban`
 * and `view:gantt`, retired with the bare `kanban` / `gantt` registrations
 * (objectui#8802, objectui#8008). The instinctive fixes both fail:
 *
 *   DELETE THE TWO   a hand list that drifted once drifts again, which is the
 *                    reason the card was filed rather than patched.
 *   RE-DERIVE FROM   `known-schema-types.ts` STILL CONTAINS BOTH. They are
 *   THE GENERATED    members of `PROTOCOL_COMPONENTS`, and `registerPlaceholder`
 *   KNOWN-TYPE LIST  is a real `ComponentRegistry.register(...)` call. So the
 *                    generated list answers "yes" and the correction is a no-op.
 *
 * The two sets differ, and naming the difference is this gate:
 *
 *   what RESOLVES   every registered key, placeholders included. That is the
 *                   question `objectui check` asks, and asking it of a prompt
 *                   is what let `view:kanban` validate green and draw nothing.
 *   what is AUTHORABLE  a key some registration OTHER than the protocol
 *                   placeholder answers. That is the question a prompt teaching
 *                   an author must ask.
 *
 * ## Where the exclusion comes from — the placeholder module's own declaration
 *
 * ⛔ NOT from a list of key names typed here; that list is the drift this gate
 * exists about. The universe comes from `deriveRegistryKeys` — the SAME
 * derivation that judges documentation snippets (objectui#4823) and generates
 * the CLI's known-type list (objectui#5115) — which records, per key, the SITES
 * that register it. `INDIRECT_REGISTRATIONS` declares the placeholder module
 * and the `protocol-placeholder` namespace it registers under; a key whose
 * every site is that module is placeholder-only, and every other key is
 * authorable. Move a key out of `PROTOCOL_COMPONENTS` into a real plugin and
 * this gate follows it live, with nothing here to edit.
 *
 * If that declaration ever stops naming a `protocol-placeholder` entry, or the
 * exclusion stops removing anything, the run FAILS rather than passing: an
 * exclusion that excludes nothing silently collapses this gate back into the
 * generous question, which is the no-op above.
 *
 * ## What is deliberately NOT checked: completeness
 *
 * The bullets end in `etc.` — they are examples, and the file makes no claim to
 * enumerate the registry. So the direction judged is containment: what the
 * prompt names must exist and must render. The other direction (a new renderer
 * lands, the prompt does not mention it) leaves the prompt incomplete, never
 * WRONG, and gating it would red on every plugin that ships.
 *
 * ## The second reading model: LABELLED BLOCKS (objectui#9098)
 *
 * A `Keys:` bullet puts every key on ONE line, which is why the rule above is
 * "the Keys LINE only". The prompt teaches component keys in four more places
 * that are shaped differently — `Standard Components Library:` and two
 * `Required Components:` bullets whose keys live in SUB-BULLETS, each followed
 * by trailing prose. Widening the label set alone would have read nothing:
 * those label lines carry no keys at all. So this gate carries a second reading
 * model, and the token-selection rule it states is:
 *
 *   A GATED LABEL is a bolded bullet label drawn from a fixed set. It opens a
 *   BLOCK: the contiguous run of lines indented strictly MORE than the label's
 *   own bullet, ending at the first non-blank line indented at or below it (or
 *   at end of file). Inside that block only LIST-ITEM lines are read, and from
 *   each, every single-backticked token WITHOUT whitespace in it is taken as a
 *   key. Fenced code is skipped everywhere.
 *
 * Everything else is prose and is never judged. That is four escape hatches, and
 * the prompt surface uses all four today:
 *
 *   OUTSIDE THE BLOCK    a blockquote or paragraph at the section's own level
 *                        is not in the label's sub-tree. This is where the
 *                        tombstones live — the note naming `view:kanban` and
 *                        `view:gantt` as retired, the one naming `user:profile`,
 *                        the one naming `ai:chat_window` as deliberately
 *                        unregistered. Every one of those is a key this gate
 *                        would reject if it read it, which is precisely why a
 *                        "do not write this" example has to stay unjudged.
 *   NOT A LIST ITEM      a continuation paragraph indented under the label is
 *                        skipped even though it IS in the block.
 *   BACKTICKED PROSE     a backticked span with a space in it is a command or a
 *                        phrase, never a key: `pnpm check:prompt-keys`,
 *                        `objectui check`. Not one of the 650 derived keys has
 *                        whitespace in it, so nothing real is skipped here.
 *   NOT BACKTICKED       trailing prose on a sub-bullet — `(Lucide Wrapper)`,
 *                        `: Standalone smart button.`, `(Sub-grid)` — carries no
 *                        backticks and so contributes nothing. An author who
 *                        needs to name a NON-key in that prose writes it without
 *                        backticks, or moves the note out of the block.
 *
 * ## Two verdicts, because a placeholder list is a claim too
 *
 * `Protocol Placeholders:` is gated with the partition INVERTED: every key under
 * it must be placeholder-only. A list of protocol placeholders is as much a
 * factual claim as a list of components, and it drifts the same way — if
 * `ai:input` gains a real renderer the section is stale, and if it loses its
 * registration entirely the section names nothing at all. Without the inverted
 * leg, "move the placeholder-only keys to a placeholder section" would have
 * moved the drift rather than fixed it.
 *
 * ## Why a block that opens and reads nothing is a failure
 *
 * `bullets === 0` catches the `Keys:` surface disappearing. The block model's
 * equivalent is narrower and stronger: a gated label that matches but whose
 * block yields no keys means the section was reformatted so the keys moved out
 * from under it — the gate would then judge nothing while printing a pass.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveRegistryKeys, INDIRECT_REGISTRATIONS } from './check-doc-component-types.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { closesFence, openFence } from './markdown-fence-scan.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** The instruction surface this gate reads. */
export const PROMPT_DIR = '.github/prompts';

/** The namespace `INDIRECT_REGISTRATIONS` gives the opt-in placeholder module. */
export const PLACEHOLDER_NAMESPACE = 'protocol-placeholder';

/**
 * A bullet that teaches registry keys. Anchored on the bolded `Keys:` label
 * rather than on a namespace prefix: the surviving spelling of a retired
 * namespaced key is often a BARE one (`object-kanban` for `view:kanban`), so a
 * scanner keyed on `ns:key` would stop reading the bullet at the moment it is
 * corrected.
 */
const KEYS_BULLET = /^\s*[*-]\s+\*\*Keys:\*\*\s*(.*)$/;

/** A single-backticked token inside a bullet.
 *
 *  Read from the `**Keys:**` LINE only, never from the bullet's continuation or
 *  its sub-bullets: those carry prose about the keys — the `formType` values a
 *  form view takes, for instance — and judging a prop value as a registry key
 *  would red on correct text. The convention that makes this safe is stated in
 *  the file it reads: a Keys bullet's keys live on the Keys line. */
const BACKTICKED = /`([^`]+)`/g;

/**
 * Any bolded bullet label, e.g. `*   **Required Components:**`. Matching every
 * label and filtering afterwards (rather than building one regex out of the
 * gated names) keeps the gated set readable as DATA — the thing a future
 * retirement has to edit — instead of as regex alternation.
 */
const LABEL_BULLET = /^(\s*)[*+-]\s+\*\*([^*]+?):\*\*\s*(.*)$/;

/** A list item at any depth — the only kind of line a gated block reads. */
const LIST_ITEM = /^\s*(?:[*+-]|\d+\.)\s+/;

/**
 * A `## N. Title` heading. It opens a SECTION, which is the scope a letter run
 * is numbered within — the prompt surface carries several independent runs per
 * file and they each restart at `A`.
 */
const SECTION_HEADING = /^##\s+(.*\S)\s*$/;

/** A `### X. Title` heading — one entry in its section's letter run. */
const LETTER_HEADING = /^###\s+([A-Z])\.\s/;


/**
 * Bullet labels whose sub-bullet BLOCK teaches keys an author may write, and
 * whose every key must therefore be authorable.
 *
 * ⛔ NOT a list of key names — that is the drift this gate exists about. This is
 * a list of LABELS: the four claims the prompt surface makes about the registry.
 * `Required Types:` is deliberately absent and must stay absent — objectui#8929
 * landed the reason in the prompt itself: a `Required Types` entry is a spec
 * `type` VALUE, not a registry key, so `grid` / `kanban` / `gantt` are correct
 * there and a registry-key gate would red on correct text. `Keys:` is absent
 * because it has its own, narrower reading model above.
 */
export const AUTHORABLE_BLOCK_LABELS = ['Standard Components Library', 'Required Components'];

/**
 * Bullet labels whose block lists PROTOCOL PLACEHOLDERS. The partition is read
 * the other way round here: every key must be answered by the placeholder
 * module and by nothing else.
 */
export const PLACEHOLDER_BLOCK_LABELS = ['Protocol Placeholders'];

/** What the partition must say about a key, given the label that taught it. */
export function expectationFor(label) {
  if (AUTHORABLE_BLOCK_LABELS.includes(label)) return 'authorable';
  if (PLACEHOLDER_BLOCK_LABELS.includes(label)) return 'placeholder-only';
  return null;
}

/** Files the prompt surface is made of. */
const PROMPT_EXTENSIONS = ['.md'];

/** Leading width of a line, tabs counted as four columns. */
function indentOf(line) {
  const expanded = line.replace(/\t/g, '    ');
  return expanded.length - expanded.trimStart().length;
}

/**
 * Mark every line that sits inside a fenced code block, delimiters included. A
 * `**Keys:**` line inside a fence is an EXAMPLE of a bullet, not a bullet, and
 * judging it would red on a document explaining the convention.
 *
 * Run-aware via `markdown-fence-scan.mjs` (objectui#9194), which owns this
 * question for the whole tree. ⛔ Never re-spell the predicate here: a private
 * one read a fence as "three backticks" and toggled, so a FOUR-backtick opener
 * was closed by the next THREE-backtick line — which CommonMark makes body text
 * — and from there the gate read code as prose and prose as code for the rest of
 * the file. That is why only a run of the SAME character, AT LEAST AS LONG and
 * carrying no info string, closes what a run opened.
 */
function fenceMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    if (open) {
      // The body, and the closing delimiter itself, are both inside the fence.
      mask[i] = true;
      if (closesFence(lines[i], open)) open = null;
      continue;
    }
    const fence = openFence(lines[i]);
    if (fence) {
      mask[i] = true;
      open = fence;
      continue;
    }
    mask[i] = false;
  }
  return mask;
}

/** Which registration sites belong to the opt-in protocol placeholder. */
export function placeholderSites(indirect = INDIRECT_REGISTRATIONS) {
  return new Set(indirect.filter((e) => e.namespace === PLACEHOLDER_NAMESPACE).map((e) => e.site));
}

/**
 * Split the derived universe into the keys a real renderer answers and the keys
 * only the placeholder answers.
 */
export function partitionRegistry(keys, sites) {
  const authorable = new Set();
  const placeholderOnly = new Set();
  for (const [key, keySites] of keys) {
    if (keySites.some((site) => !sites.has(site))) authorable.add(key);
    else placeholderOnly.add(key);
  }
  return { authorable, placeholderOnly };
}

/** Every prompt file, sorted so output order does not depend on the filesystem. */
export function promptFiles(root) {
  const dir = join(root, PROMPT_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((name) => PROMPT_EXTENSIONS.some((ext) => name.endsWith(ext)))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Every single-backticked token in `text` that could be a registry key.
 *
 * A backticked span containing WHITESPACE is not one: the derivation produces
 * 650 keys on this tree and not one of them has a space in it, while the prose
 * around a vocabulary list is full of backticked commands and phrases —
 * `pnpm check:prompt-keys`, `objectui check`. Skipping them is not a hole a bad
 * key can hide in: a token with a space resolves to nothing under ANY spelling,
 * so there is no registration for it to be judged against either way.
 */
function harvest(sites, text, { file, line, label, expect, scope }) {
  BACKTICKED.lastIndex = 0;
  let token;
  let found = 0;
  while ((token = BACKTICKED.exec(text))) {
    if (/\s/.test(token[1])) continue;
    found++;
    sites.push({ file, key: token[1], text: line.trim(), label, expect, scope });
  }
  return found;
}

/**
 * Every key the prompt surface teaches, under both reading models.
 *
 * `bullets` counts `**Keys:**` lines (the objectui#8929 model, LINE only) and
 * `blocks` counts gated labelled blocks (the objectui#9098 model). `emptyBlocks`
 * records a gated label whose block yielded nothing — see the header: that is a
 * reformatted section, not an empty one, and it must not read as a pass.
 */
export function scanPromptKeys(root) {
  const sites = [];
  let bullets = 0;
  let blocks = 0;
  const emptyBlocks = [];

  for (const abs of promptFiles(root)) {
    const rel = relative(root, abs).split(sep).join('/');
    const lines = readFileSync(abs, 'utf8').split('\n');
    const fenced = fenceMask(lines);

    for (let i = 0; i < lines.length; i++) {
      if (fenced[i]) continue;
      const line = lines[i];

      const bullet = KEYS_BULLET.exec(line);
      if (bullet) {
        bullets++;
        harvest(sites, bullet[1], {
          file: rel,
          line,
          label: 'Keys',
          expect: 'authorable',
          scope: 'keys-line',
        });
        continue;
      }

      const labelled = LABEL_BULLET.exec(line);
      if (!labelled) continue;
      const [, lead, label, trailing] = labelled;
      const expect = expectationFor(label);
      if (!expect) continue;

      blocks++;
      const indent = indentOf(lead + '*');
      const site = { file: rel, line, label, expect, scope: 'block' };
      // The label line itself is read too. Today every gated label ends at its
      // colon, but reading the trailing text costs nothing and fails SAFE: a
      // future author who puts keys on the label line gets them judged rather
      // than silently skipped.
      let found = harvest(sites, trailing, site);

      let j = i + 1;
      for (; j < lines.length; j++) {
        const body = lines[j];
        if (body.trim() === '') continue;
        if (indentOf(body) <= indent) break;
        if (fenced[j]) continue;
        if (!LIST_ITEM.test(body)) continue;
        found += harvest(sites, body, { ...site, line: body });
      }

      if (found === 0) emptyBlocks.push(`${rel}: \`${label}:\``);
      i = j - 1;
    }
  }

  return { sites, bullets, blocks, emptyBlocks };
}

/**
 * Every `### X.` letter run in the prompt surface, grouped by the `## N.`
 * section that scopes it (objectui#9145).
 *
 * ## What this reads, and why it is a SEQUENCE check rather than a count
 *
 * `.github/prompts/component.prompt.md` opened §1 with a hand-written "these 3
 * standard slots" over seven sections, and those seven ran `A B D E F G H` — no
 * `C`. Both halves were wrong in the file's FIRST commit (`4e7737788`), so
 * neither is a drift from a state that was once true: the inventory was never
 * measured against the list it describes.
 *
 * The two halves are repaired differently, and only one of them needs a gate:
 *
 *   THE COUNT      deleted, not pinned. The sentence no longer states a number,
 *                  so there is no second place for the inventory to be written
 *                  down and no way for the two to disagree. A gate comparing a
 *                  stated count to a heading count would exist only to keep a
 *                  construct alive that has no reason to be there.
 *   THE LETTERING  pinned here. A letter run is not a duplicate of anything —
 *                  it IS the inventory — so it cannot be deleted, and a gap in
 *                  it is exactly the reading that cost this card: a missing
 *                  letter says "a section was dropped" to an AI author that
 *                  reads these files as authoritative, and the file itself does
 *                  not say whether that is true.
 *
 * ## Why a run is scoped to its `## N.` section
 *
 * `component.prompt.md` carries a SECOND, independent letter run further down
 * (`### A. Field Widget Implementation`, `### B. Dashboard Widget
 * Implementation`) under `## 2. API Reference & Contracts`, and
 * `engine.prompt.md` carries five. Each restarts at `A`, so a file-wide
 * sequence check would red on every correct file here. The section heading is
 * the boundary the author already writes.
 *
 * Sections with no letter headings (`## 2. Standard Contexts` in
 * `engine.prompt.md`, whose sub-headings are backticked type names) are
 * returned too, carrying an empty `entries`. They contribute no run, and the
 * caller needs them to tell "this surface has no letter runs because it has no
 * sections" (a fixture tree exercising the key vocabulary) apart from "this
 * surface has sections and every run in them has vanished" (the collapse).
 * ⛔ This does NOT judge the `## N.` numbers themselves — that is a different
 * vocabulary and a different claim.
 */
export function scanPromptSections(root) {
  const sections = [];
  for (const abs of promptFiles(root)) {
    const rel = relative(root, abs).split(sep).join('/');
    const lines = readFileSync(abs, 'utf8').split('\n');
    const fenced = fenceMask(lines);
    let current = null;

    for (let i = 0; i < lines.length; i++) {
      if (fenced[i]) continue;
      const section = SECTION_HEADING.exec(lines[i]);
      if (section) {
        current = { file: rel, section: section[1], entries: [] };
        sections.push(current);
        continue;
      }
      const letter = LETTER_HEADING.exec(lines[i]);
      if (!letter || !current) continue;
      current.entries.push({ letter: letter[1], line: i + 1, text: lines[i].trim() });
    }
  }
  return sections;
}

/** The sections that actually carry a letter run. */
export const lettered = (sections) => sections.filter((s) => s.entries.length > 0);

/**
 * The first heading in each run whose letter is not the one its position calls
 * for. Only the FIRST is reported per run: a gap at `C` makes every heading
 * after it wrong too, and listing all of them buries the one an author has to
 * decide about.
 */
export function letterRunFindings(runs) {
  const findings = [];
  for (const run of runs) {
    for (let i = 0; i < run.entries.length; i++) {
      const expected = String.fromCharCode(65 + i);
      const entry = run.entries[i];
      if (entry.letter === expected) continue;
      findings.push({
        file: `${run.file}:${entry.line}`,
        key: `### ${entry.letter}.`,
        text: `${entry.text}  —  expected \`### ${expected}.\`, heading ${i + 1} of ${run.entries.length} under \`## ${run.section}\``,
        label: run.section,
        expect: 'contiguous-letters',
        scope: 'letter-run',
        reason: 'letter-run-gap',
      });
      break;
    }
  }
  return findings;
}

/**
 * Judge the prompt surface. Throws when an input is missing, because a gate
 * that cannot see its inputs must not report a pass.
 */
export function analyze(root, options = {}) {
  const registry = deriveRegistryKeys(root, options);
  if (registry.findings.length > 0) {
    const lines = registry.findings.map((f) => `  ${f.reason} at ${f.site}: ${f.detail}`);
    throw new Error(
      `the registry derivation reported ${registry.findings.length} finding(s), so the key universe ` +
        `is incomplete and a green verdict here would have judged against a short list:\n${lines.join('\n')}`,
    );
  }

  const sites = placeholderSites(options.indirectRegistrations ?? INDIRECT_REGISTRATIONS);
  if (sites.size === 0) {
    throw new Error(
      `no INDIRECT_REGISTRATIONS entry declares the \`${PLACEHOLDER_NAMESPACE}\` namespace, so this ` +
        'gate cannot tell a real renderer from a placeholder. Without that distinction it collapses ' +
        'into "does the key resolve", which is the question that let a retired key validate green.',
    );
  }

  const { authorable, placeholderOnly } = partitionRegistry(registry.keys, sites);
  if (placeholderOnly.size === 0) {
    throw new Error(
      'the placeholder exclusion removed no keys at all. Either the placeholder module stopped ' +
        'registering, or its declared site no longer matches the sites the derivation records — ' +
        'either way this run would have asked the generous question while reporting the strict one.',
    );
  }
  if (authorable.size === 0) {
    throw new Error('the derivation produced no authorable keys — refusing to judge against an empty set.');
  }

  const { sites: taught, bullets, blocks, emptyBlocks } = scanPromptKeys(root);
  if (bullets === 0) {
    throw new Error(
      `no \`**Keys:**\` bullet was found under ${PROMPT_DIR}. The surface this gate reads is gone or ` +
        'has been reformatted, and a run that reads nothing passes while asserting nothing.',
    );
  }
  if (emptyBlocks.length > 0) {
    throw new Error(
      `${emptyBlocks.length} gated label(s) opened a block that taught no key at all:\n` +
        emptyBlocks.map((b) => `  ${b}`).join('\n') +
        '\nA label whose keys have moved out from under it is a REFORMATTED section, not an empty one, ' +
        'and judging\nnothing under it would report a pass this gate did not earn.',
    );
  }

  const sections = scanPromptSections(root);
  const runs = lettered(sections);
  if (sections.length > 0 && runs.length === 0) {
    throw new Error(
      `${sections.length} \`## N.\` section(s) under ${PROMPT_DIR} carry no \`### X.\` heading at all. ` +
        'The category inventories this pin reads are gone or have been reformatted, and a run that ' +
        'reads nothing passes while asserting nothing.',
    );
  }

  const findings = letterRunFindings(runs);
  for (const site of taught) {
    const isAuthorable = authorable.has(site.key);
    const isPlaceholder = placeholderOnly.has(site.key);
    if (site.expect === 'placeholder-only') {
      if (isPlaceholder) continue;
      findings.push({ ...site, reason: isAuthorable ? 'not-a-placeholder-key' : 'unregistered-key' });
      continue;
    }
    if (isAuthorable) continue;
    findings.push({ ...site, reason: isPlaceholder ? 'placeholder-only-key' : 'unregistered-key' });
  }

  return {
    findings,
    counters: {
      promptFiles: promptFiles(root).length,
      bullets,
      blocks,
      keys: taught.length,
      blockKeys: taught.filter((s) => s.scope === 'block').length,
      placeholderClaims: taught.filter((s) => s.expect === 'placeholder-only').length,
      registryKeys: registry.keys.size,
      authorable: authorable.size,
      placeholderOnly: placeholderOnly.size,
      letterRuns: runs.length,
      letterHeadings: runs.reduce((n, run) => n + run.entries.length, 0),
    },
  };
}

const HINTS = {
  'placeholder-only-key':
    'This key IS registered — by the opt-in protocol placeholder and by nothing else. A document ' +
    'naming it passes `objectui check` and then paints the dashed placeholder panel in apps/console, ' +
    'or the OBJUI-001 "Unknown component type" panel in every host that does not call ' +
    '`registerPlaceholders()`. Teach the key of the component that actually renders, or, if none ' +
    'exists yet, do not teach it at all.',
  'unregistered-key':
    'Nothing in this repository registers this key, so it resolves to the OBJUI-001 "Unknown ' +
    'component type" panel everywhere. Teach a registered key.',
  'letter-run-gap':
    'The `### X.` headings under this `## N.` section do not run A, B, C, … without a gap. To an AI ' +
    'author reading these files as authoritative, a missing letter says a section was DROPPED — and ' +
    'nothing in the file says whether that is true (objectui#9145: the gap was a generation artifact ' +
    'present in the file\'s first commit, not a dropped category). Renumber the run so the letters ' +
    'are contiguous, or add the section the gap claims is missing.',
  'not-a-placeholder-key':
    'This key is taught under a `Protocol Placeholders:` label, but a REAL renderer answers it — so ' +
    'the section understates what the platform ships and steers an author away from a component that ' +
    'works. Move it to the components list. (The same label rejects a key nothing registers at all, ' +
    'under `unregistered-key`: a placeholder list that names a key the placeholder module dropped is ' +
    'as wrong as a component list that names a retired one.)',
};

if (isEntrypoint(import.meta.url)) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));

  let result;
  try {
    result = analyze(root);
  } catch (error) {
    console.error(
      `x  ${error.message}\n\n` +
        '    Reported as a failure rather than a pass: this gate decides whether an AI instruction file ' +
        'teaches\n    keys that render, so losing an input means it cannot decide.',
    );
    process.exit(1);
  }

  const { findings, counters } = result;
  console.log(
    `Scanned ${counters.promptFiles} prompt file(s) under ${PROMPT_DIR}, ` +
      `${counters.bullets} \`Keys:\` bullet(s) and ${counters.blocks} gated label block(s), ` +
      `${counters.keys} taught key(s) (${counters.blockKeys} of them from blocks, ` +
      `${counters.placeholderClaims} claimed as placeholders) against ` +
      `${counters.authorable} authorable key(s) — the ${counters.registryKeys} registered key(s) less ` +
      `the ${counters.placeholderOnly} answered only by the ${PLACEHOLDER_NAMESPACE} registration.`,
  );
  console.log(
    `Checked ${counters.letterHeadings} \`### X.\` heading(s) across ${counters.letterRuns} letter ` +
      'run(s) for a contiguous A, B, C, … sequence within each `## N.` section.',
  );

  if (findings.length === 0) {
    console.log(
      'OK  Every key taught as available is answered by a real renderer, every key taught as a ' +
        'protocol placeholder is answered only by the placeholder, and every letter run is contiguous.',
    );
    process.exit(0);
  }

  console.error(`\nX  ${findings.length} problem(s):\n`);
  for (const finding of findings) {
    console.error(`      ${finding.file}  [${finding.reason}]  \`${finding.key}\``);
    console.error(`          ${finding.text}`);
  }
  for (const reason of Object.keys(HINTS)) {
    if (findings.some((f) => f.reason === reason)) console.error(`\n${reason}: ${HINTS[reason]}`);
  }
  console.error(
    '\nThese files are read by an AI that then writes metadata, so a key here that does not render is ' +
      'not one\nwrong page — it is every document generated from it. See the header of ' +
      'scripts/check-prompt-component-keys.mjs (objectui#8929).',
  );
  process.exit(1);
}
