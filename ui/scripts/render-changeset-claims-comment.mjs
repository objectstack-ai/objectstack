#!/usr/bin/env node
/**
 * Renders the "Changeset Claim Re-read" pull request comment body for
 * `.github/workflows/changeset-presence.yml`.
 *
 * Run:  node scripts/check-changeset-claims.mjs --json claims.json
 *       node scripts/render-changeset-claims-comment.mjs --from claims.json
 *
 * ## Why this exists (objectui#9140)
 *
 * `check-changeset-claims.mjs` calls its finding a REQUEST TO READ, addressed to
 * the seat whose own diff might have falsified a pending changeset's prose.
 * objectui#9140 measured that request at ZERO answers out of four live
 * instances, and the reason is where it was addressed: a job log nobody opens on
 * a green check. The director's ruling (maintainer 「同意」) is that the finding
 * is DELIVERED — posted onto the pull request — and that everything else about
 * the gate stays exactly as it was: exit 0, not a required context, nothing
 * blocks.
 *
 * ## Why this is a file and not an inline `script:` block
 *
 * Same reason `render-budget-comment.mjs` is one: logic embedded in YAML cannot
 * be tested, and the bug class this rendering can carry is not hypothetical —
 * the budget comment once rendered an ABSENT measurement as a FAIL verdict
 * (objectui#3152). Here the equivalent mistake is rendering "no findings" as a
 * request to re-read, which would teach readers to skim exactly the comment the
 * ruling exists to get read. `scripts/__tests__/render-changeset-claims-comment.test.ts`
 * covers both directions.
 *
 * ## ⛔ The marker is PLAIN TEXT, and that is load-bearing
 *
 * "One comment per pull request, updated in place rather than stacked" needs the
 * job to find its own previous comment. The usual shape for that is a hidden
 * HTML-comment marker — and in THIS repository that shape does not work.
 * AGENTS.md records it as measured, under the six ways GitHub rewrites the bytes
 * of a body you post: tag-shaped fragments are deleted on save, backticks and
 * fenced code blocks do NOT protect them, and「单独占据第一行的 HTML 注释标记
 * 同样被吃掉」— an HTML-comment marker alone on the first line is eaten too, so a
 * mechanism that scans for its marker cannot see its own comment at all.
 *
 * A marker that vanishes does not degrade the feature gracefully: every re-run
 * fails to find the previous comment and posts a new one, which is the stacking
 * the ruling forbids, delivered as a growing wall on somebody else's pull
 * request.
 *
 * So the marker is the first line of the body, in plain text, and it renders
 * visibly. Visible is the price; it is the same convention the `os-dev-report`
 * comments in this organisation use, and for the same measured reason.
 *
 * ⛔ The workflow does NOT carry a second copy of the marker: it reads the first
 * line of the body it is about to post and looks for comments opening with that
 * line. Two spellings of one marker is the drift this avoids.
 *
 * ## Quoted prose is repaired for the same sanitizer, on the way out
 *
 * The body quotes a PARAGRAPH of somebody else's changeset (objectui#8617 — the
 * paragraph is the unit that rots). That prose is not written for this channel
 * and routinely names React components in angle brackets, which is exactly the
 * tag-shaped fragment GitHub deletes on save. AGENTS.md records the damage:
 * a before/after table lost the generic parameters in both of its columns and
 * rendered as though nothing had changed.
 *
 * Silently losing the identifier a paragraph is ABOUT is worse than showing the
 * reader a repair, so `spellOutTags` rewrites those spans visibly and says what
 * it did. ⛔ It is not a general escape: it touches quoted prose only, and the
 * transformation is stated in the comment so no reader mistakes it for what the
 * changeset says.
 */

import fs from 'node:fs';
import { isEntrypoint } from './invoked-as.mjs';

/**
 * The first line of every body this renderer produces, and the only thing the
 * workflow matches on to find its own earlier comment. Plain text, deliberately
 * — see the header.
 */
export const MARKER = 'changeset-claim-re-read';

/** A tag-shaped span: the exact shape GitHub deletes from a stored body. */
const TAG_SHAPED = /<([^<>\s][^<>]{0,120})>/g;

/**
 * Rewrites tag-shaped spans in quoted prose so the sanitizer cannot delete them.
 *
 * `FieldWidgetProps of ANGLE-BRACKETS(T)` rather than the literal shape: the
 * replacement carries the same information and contains no `<`, so there is
 * nothing for the filter to take.
 */
export function spellOutTags(text) {
  return String(text).replace(TAG_SHAPED, (_match, inner) => `ANGLE-BRACKETS(${inner})`);
}

/** How many distinct changesets a finding list names. */
function byChangeset(findings) {
  const map = new Map();
  for (const finding of findings) {
    const bucket = map.get(finding.changeset);
    if (bucket) bucket.push(finding);
    else map.set(finding.changeset, [finding]);
  }
  return map;
}

function measurement(result) {
  const head = result.head ? `\`${result.head}\`` : 'the checked-out tree';
  const base = result.base ? `\`${String(result.base).slice(0, 9)}\`` : 'its merge base';
  const how = result.baseHow ? ` (${result.baseHow})` : '';
  return (
    `Compared ${head} with ${base}${how}: ${result.changed ?? 0} file(s) changed outside ` +
    `\`.changeset/\`, read against ${result.considered ?? 0} pending declaration(s) that publish a ` +
    `body (${result.pending ?? 0} pending in total).`
  );
}

/**
 * @param {object} result   the `--json` hand-off written by `check-changeset-claims.mjs`
 * @param {object} [options]
 * @param {string} [options.runUrl]  link back to the workflow run that measured it
 * @returns {string} the comment body, opening with {@link MARKER}
 */
/**
 * The BORN-FALSE half (objectui#9509), rendered above the went-false half.
 *
 * Above it deliberately: this half is about the prose the reader is publishing
 * RIGHT NOW, which is the one thing they can still change for free, and
 * objectui#9509's triage ruling is that nothing later will ever turn it red.
 */
function bornFalseSection(rows) {
  const lines = [
    `## ⚠️ ${rows.length} address(es) in this pull request's own prose name a tree it replaced`,
    '',
    'Each was read from a tree **this change itself moves**, so a reader who follows it lands ' +
      'somewhere else. ⛔ Nothing here blocks and nothing here says the sentence is false — the ' +
      'question asked is arithmetic: does this diff move the line that number points at?',
    '',
  ];
  for (const row of rows) {
    const what =
      row.verdict === 'unanchored'
        ? `\`${row.file}\` is **added by this change**, so \`:${row.line}\` exists in no tree outside this pull request`
        : row.movedTo === null || row.movedTo === undefined
          ? `this change **rewrites** \`${row.file}:${row.line}\``
          : `this change moves \`${row.file}:${row.line}\` to **\`:${row.movedTo}\`**`;
    lines.push(`- in ${row.origin === 'the pull request body' ? 'this body' : `\`${row.origin}\``}, \`${row.span}\` — ${what}`);
    if (row.sentence) lines.push('', `  > ${spellOutTags(row.sentence)}`);
    lines.push('');
  }
  lines.push(
    '⛔ **The repair is not to correct the number.** Changing `:246` to `:274` is true today and ' +
      'born false again on the next insertion — objectui#9509 states that before anything else. ' +
      '**Bind the number to the tree it was read from** (`` `:246` at `b8a006883d`, `:274` at this ' +
      'head ``), which cannot re-stale because each number names its own tree; or state a **rule** ' +
      'instead of a coordinate, the way objectui#9495 replaced a file count with "every file in ' +
      '`git diff --name-only` against the merge base".',
    '',
  );
  return lines;
}

/**
 * The SELF-CONTRADICTION half (objectui#9841), rendered above both of the others.
 *
 * Above them because it is the cheapest of the three to answer: it needs no diff
 * and no other file. One changeset declares a package and its own body says that
 * package did not move, and the two halves publish together into that package's
 * CHANGELOG.
 *
 * ⛔ The BORN FALSE / WENT FALSE split is rendered per row and ⛔ never collapsed.
 * "True when written, falsified by a later commit on this branch" and "false the
 * moment it was written" are different things to tell an author, and the carded
 * instance is the first shape.
 */
function selfContradictionSection(rows) {
  const lines = [
    `## ⚠️ ${rows.length} declaration(s) are negated by the body that publishes with them`,
    '',
    'The front matter says the package is being released; a sentence attached to that same ' +
      "package's own name says it did not move. Both halves publish **verbatim** into that " +
      "package's CHANGELOG. ⛔ Nothing here blocks, and ⛔ nothing here is a prose judgement — " +
      'this is name resolution between two halves of one file.',
    '',
  ];
  for (const row of rows) {
    const when =
      row.when === 'went'
        ? '**went false** — it stood at the revision that wrote it; a later commit on this branch added the declaration'
        : row.when === 'born'
          ? '**born false** — the revision that wrote this sentence already declared that package'
          : '**undated** — no revision in this range carries the sentence, so ⛔ neither verdict is claimed';
    lines.push(`- \`${row.changeset}\` declares \`${row.package}\` and says \`${row.claim}\` — ${when}`);
    if (row.sentence) lines.push('', `  > ${spellOutTags(row.sentence)}`);
    lines.push('');
  }
  lines.push(
    '⭐ **Name the aspect, and name what does move.** That is how PR objectui#9796 repaired the ' +
      'instance this reading was built from: «No published FACE moves — and one published FILE ' +
      'does». An aspect-scoped negation about a package you *do* patch is correct English and ' +
      'correct practice, and this gate is silent on it.',
    '',
  );
  return lines;
}

export function renderClaimsComment(result = {}, { runUrl = '' } = {}) {
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const born = Array.isArray(result.bornFalse) ? result.bornFalse : [];
  const contradictions = Array.isArray(result.selfContradiction) ? result.selfContradiction : [];
  const grouped = byChangeset(findings);
  const trailer = runUrl ? `\n\n${measurement(result)} · [run](${runUrl})\n` : `\n\n${measurement(result)}\n`;

  // The RESOLVED body. Reached only when a comment already exists — the workflow
  // never CREATES one for an empty finding set, so this is never a first post.
  // It has to exist all the same: a pull request that fixed the thing, or whose
  // diff moved off the named file, would otherwise keep a stale request to
  // re-read at the top of its thread forever.
  if (grouped.size === 0 && born.length === 0 && contradictions.length === 0) {
    return (
      `${MARKER}\n\n` +
      '## ✅ Nothing to re-read\n\n' +
      'No pending changeset names a file this change touches, no address in this pull ' +
      "request's own prose points at a line this change moves, and no changeset here negates a " +
      'package it declares. An earlier revision did. That request to re-read does **not** apply ' +
      'to the current diff.\n\n' +
      'This comment is updated in place on every re-run rather than posted again, so the thread ' +
      'does not grow one per push.' +
      trailer
    );
  }

  const lines = [MARKER, ''];
  if (contradictions.length > 0) lines.push(...selfContradictionSection(contradictions));
  if (born.length > 0) lines.push(...bornFalseSection(born));
  // ⛔ Never printed as an empty section: a heading over nothing reads as a
  // measurement that came back clean, and this half may simply not have run.
  if (grouped.size > 0) lines.push(
    `## ⚠️ ${grouped.size} pending changeset(s) describe a file this change touches`,
    '',
    'Their bodies publish **verbatim** into the CHANGELOG at the next release, so this is a ' +
      'request to **re-read them against your diff** — addressed here because you are the one ' +
      'seat that can answer it without re-deriving anything.',
    '',
    '⛔ Nothing here blocks, and nothing here is a verdict on your change. This gate exits 0, is ' +
      'not a required context, and judges **name resolution, never meaning**: it asked whether a ' +
      'pending body names a file you touched. "Is this sentence still true?" is the one question ' +
      'it will not answer, and the one you are being asked to answer.',
    '',
  );

  let repaired = false;
  for (const [changeset, hits] of grouped) {
    lines.push(`### \`${changeset}\``, '');
    for (const hit of hits) {
      const severity =
        hit.severity === 'gone' ? '⚠️ **this change leaves no such file**' : 'edited by this change';
      lines.push(`- names \`${hit.span}\` → \`${hit.file}\` — ${severity}`);
      if (hit.paragraph) {
        const quoted = spellOutTags(hit.paragraph);
        if (quoted !== hit.paragraph) repaired = true;
        lines.push('', `  > ${quoted}`);
      }
      lines.push('');
    }
  }

  if (grouped.size > 0) {
    lines.push(
      'Read the **paragraph**, not the line: both false halves of the objectui#8617 claim sat in ' +
        'one paragraph, and correcting either alone would have left it asserting the same wrong ' +
        'thing.',
      '',
      'If a claim did go false, **correct the body**. That is precedented and prose-only, ' +
        'frontmatter untouched; `check-changeset-overwrite.mjs` will report the correction as its ' +
        'own case 2 ("correcting a declaration on purpose … legitimate"), which is the intended ' +
        'shape — one gate asks for the read, the other records the write.',
      '',
    );
  }
  lines.push(
    'Not covered, stated so nobody reads this as more: a born-false claim that spells no line ' +
      'address at all (objectui#9495 coordinated one by ORDINAL — "a grep finds that member ' +
      'first" — and deciding that means reading what the sentence means), a claim spelled as a ' +
      'symbol or a package rather than a backticked file name, and a file named ambiguously.',
  );

  // ⛔ Only when a span was ACTUALLY rewritten. A standing note about a repair
  // that did not happen teaches the reader to discount the quote in every
  // comment, including the ones quoting the changeset verbatim.
  if (repaired) {
    lines.push(
      '',
      'Angle-bracketed names in the quoted prose above are rewritten as `ANGLE-BRACKETS(name)`: ' +
        'GitHub deletes tag-shaped fragments from a stored body, and a quote that silently loses ' +
        'the identifier it is about is worse than a visible repair.',
    );
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}${trailer}`;
}

/**
 * Reads the `--json` hand-off and renders it.
 *
 * A missing or unreadable hand-off is NOT rendered as "nothing to re-read" —
 * that is objectui#3152's mistake in this gate's costume. It throws, the CLI
 * exits non-zero, and the workflow step that owns the comment sees no body and
 * warns instead of posting a reassuring one.
 */
export function renderFromFile(file, env = process.env) {
  const raw = fs.readFileSync(file, 'utf8');
  const result = JSON.parse(raw);
  if (!Array.isArray(result.findings)) {
    throw new Error(`${file} carries no finding list, so this run measured nothing to report.`);
  }
  return renderClaimsComment(result, { runUrl: typeof env.RUN_URL === 'string' ? env.RUN_URL.trim() : '' });
}

if (isEntrypoint(import.meta.url)) {
  const index = process.argv.indexOf('--from');
  const file = index > -1 ? process.argv[index + 1] : null;
  if (!file) {
    console.error('❌  Usage: node scripts/render-changeset-claims-comment.mjs --from <file>');
    process.exit(1);
  }
  try {
    process.stdout.write(renderFromFile(file));
  } catch (error) {
    console.error(`❌  ${error.message}`);
    process.exit(1);
  }
}
