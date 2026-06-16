// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time lint for flow authoring ANTI-PATTERNS — metadata that is valid
 * (passes schema + expression checks) but is semantically a footgun at runtime.
 * These are emitted as WARNINGS: they guide the author (very often an AI
 * generating templates) toward the robust pattern without failing the build on
 * a technically-legal construct.
 *
 * #1874 — time-relative rules via record-change date-EQUALITY. A start-node
 * trigger condition like `end_date == daysFromNow(60)` on a `record-*` trigger
 * only fires if the record happens to be written on that exact day; the robust
 * shape is a daily SCHEDULE trigger + a range query. We flag the equality form
 * specifically (range operators `>=`/`<=` are not flagged — they're the building
 * block of the correct pattern), keeping false positives near zero.
 */

export interface FlowLintFinding {
  where: string;
  message: string;
  hint: string;
  rule: string;
}

type AnyRec = Record<string, unknown>;

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  return [];
}

/** Extract the raw predicate source from a `condition` (string or Expression envelope). */
function conditionSource(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof (raw as AnyRec).source === 'string') return (raw as AnyRec).source as string;
  return '';
}

const TIME_FNS = 'daysFromNow|daysAgo|today|now|date|datetime';
const TIME_FN_RE = new RegExp(`\\b(?:${TIME_FNS})\\s*\\(`);
// A time function adjacent to an equality operator, either side:
//   `end_date == daysFromNow(60)`  /  `today() != record.start`
const DATE_EQ = new RegExp(
  `(?:(?:${TIME_FNS})\\s*\\([^)]*\\)\\s*(?:==|!=))|(?:(?:==|!=)\\s*(?:${TIME_FNS})\\s*\\()`,
);

export const FLOW_TIME_RELATIVE_ANTIPATTERN = 'flow-time-relative-antipattern';
export const FLOW_DATE_EQUALITY_FILTER = 'flow-date-equality-filter';
export const FLOW_DOUBLE_BRACE_INTERP = 'flow-double-brace-interpolation';
export const FLOW_BARE_DOLLAR_REF = 'flow-bare-dollar-reference';

/** If `v` is a CEL expression whose source calls a time function, return that source. */
function celTimeSource(v: unknown): string | null {
  if (v && typeof v === 'object' && (v as AnyRec).dialect === 'cel') {
    const src = (v as AnyRec).source;
    if (typeof src === 'string' && TIME_FN_RE.test(src)) return src;
  }
  return null;
}

/** Range operators — the building block of the CORRECT time-window pattern, never flagged. */
const RANGE_OPS = new Set(['$gte', '$gt', '$lte', '$lt', '$ne']);

/**
 * Walk a get_record/query `filter` for the date-EQUALITY footgun: a field bound
 * directly (`field: daysFromNow(N)`) or via `$eq` / `$in` to a time-function value.
 * A `Field.date` is stored with a time component, so two independently-computed
 * timestamps never compare equal — the query silently returns nothing (#1928 /
 * templates #1874). Range operators (`$gte`/`$lt` day windows) are the correct
 * shape and are never flagged.
 */
function scanFilterForDateEquality(
  filter: unknown,
  where: string,
  findings: FlowLintFinding[],
): void {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return;
  for (const [key, val] of Object.entries(filter as AnyRec)) {
    if (key === '$or' || key === '$and') {
      if (Array.isArray(val)) for (const sub of val) scanFilterForDateEquality(sub, where, findings);
      continue;
    }
    // `key` is a field name; `val` is its constraint.
    const direct = celTimeSource(val); // `field: daysFromNow(N)` → implicit equality
    let hit: { op: string; src: string } | null = direct ? { op: '==', src: direct } : null;
    if (!hit && val && typeof val === 'object' && (val as AnyRec).dialect !== 'cel') {
      for (const [op, operand] of Object.entries(val as AnyRec)) {
        if (RANGE_OPS.has(op)) continue; // correct pattern — leave it
        if (op === '$eq') {
          const s = celTimeSource(operand);
          if (s) { hit = { op: '$eq', src: s }; break; }
        } else if (op === '$in' && Array.isArray(operand)) {
          for (const item of operand) {
            const s = celTimeSource(item);
            if (s) { hit = { op: '$in', src: s }; break; }
          }
          if (hit) break;
        }
      }
    }
    if (hit) {
      findings.push({
        where,
        message:
          `filter matches \`${key}\` by ${hit.op} against a time value (\`${hit.src}\`) — a date field carries a ` +
          `time component, so exact equality against \`${hit.src}\` (re-computed each run) silently matches nothing.`,
        hint:
          `Use a one-day window instead: \`${key}: { $gte: daysFromNow(N), $lt: daysFromNow(N+1) }\` ` +
          `(wrap multiple tiers in \`$or\`). The abutting windows tile the timeline so each row matches exactly once. (#1874)`,
        rule: FLOW_DATE_EQUALITY_FILTER,
      });
    }
  }
}

// Flow node VALUES interpolate with SINGLE braces (`{var}` / `{rec.field}` /
// `{$User.Id}`). Two wrong-syntax mistakes AI/human authors carry over from the
// *formula* template dialect (`{{ path }}`) or other platforms:
//   - `{{ai_reply}}`  — double-brace (verified: no flow node uses `{{ }}`).
//   - `$source.id`    — a `$`-prefixed reference written bare (resolves as a
//                       literal string), instead of `{source.id}`.
const DOUBLE_BRACE = /\{\{\s*[\w$][\w$.\s]*\}\}/;
// A `$Ident.field` not immediately inside a `{` (so `{$User.Id}` is NOT flagged).
// Require a letter/_ after `$` so currency like `$5.00` is never matched.
const BARE_DOLLAR_REF = /(?:^|[^{])\$[A-Za-z_]\w*\.[A-Za-z_]/;

/** Config keys whose string values are CEL predicates, not interpolated templates. */
const CEL_KEYS = new Set(['condition', 'expression', 'conditions']);

/** Collect every interpolated-template string value in a node config (skips CEL keys). */
function collectTemplateStrings(value: unknown, key: string | undefined, out: string[]): void {
  if (key && CEL_KEYS.has(key)) return;
  if (typeof value === 'string') { out.push(value); return; }
  if (Array.isArray(value)) { for (const v of value) collectTemplateStrings(v, key, out); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as AnyRec)) collectTemplateStrings(v, k, out);
  }
}

/**
 * Lint every flow's start node for known authoring anti-patterns. Returns a
 * (possibly empty) list of advisory findings — never throws, never fails a build.
 */
export function lintFlowPatterns(stack: AnyRec): FlowLintFinding[] {
  const findings: FlowLintFinding[] = [];
  for (const flow of asArray(stack.flows)) {
    const flowName = typeof flow.name === 'string' ? flow.name : '(unnamed flow)';
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];

    // (a) #1874 — date-equality time condition on a record-change start node.
    const start = nodes.find((n) => n.type === 'start');
    const startCfg = (start?.config ?? {}) as AnyRec;
    const triggerType = typeof startCfg.triggerType === 'string' ? startCfg.triggerType : '';
    if (triggerType.startsWith('record-')) {
      const src = conditionSource(startCfg.condition).trim();
      if (src && DATE_EQ.test(src)) {
        findings.push({
          where: `flow '${flowName}' · start condition`,
          message:
            `record-change trigger uses a date-EQUALITY time condition (\`${src}\`) — it only fires if the ` +
            `record happens to be written on that exact day, so unattended "N days before" rules never run.`,
          hint:
            `Use a SCHEDULE trigger (daily cron) + a range query instead — e.g. a scheduled flow whose ` +
            `get_record filters \`end_date\` BETWEEN {TODAY()} and {TODAY()+N}. (#1874)`,
          rule: FLOW_TIME_RELATIVE_ANTIPATTERN,
        });
      }
    }

    // (b) #1315 — wrong interpolation syntax in any node's template values. Flow
    //     node values use SINGLE braces; double-brace `{{ }}` and bare `$ref.x`
    //     are carried over from the formula template dialect / other platforms.
    for (const node of nodes) {
      const nodeWhere = `flow '${flowName}' · node '${node.id}' (${node.type})`;

      // (a2) #1874 — date-EQUALITY (`==`/`$eq`/`$in`) against a time value in a
      //      query filter. A scheduled flow that filters this way silently matches
      //      nothing; the robust shape is a `$gte`/`$lt` day window.
      const cfg = (node.config ?? {}) as AnyRec;
      if (cfg.filter) scanFilterForDateEquality(cfg.filter, `${nodeWhere} filter`, findings);

      const strings: string[] = [];
      collectTemplateStrings(node.config, undefined, strings);
      for (const str of strings) {
        if (DOUBLE_BRACE.test(str)) {
          findings.push({
            where: nodeWhere,
            message: `double-brace interpolation \`${str.trim().slice(0, 80)}\` — flow node values use SINGLE braces.`,
            hint: `Use \`{var}\` (e.g. \`{record.title}\`). Double-brace \`{{ }}\` is the formula/template-field dialect, not flow node values. (#1315)`,
            rule: FLOW_DOUBLE_BRACE_INTERP,
          });
        }
        if (BARE_DOLLAR_REF.test(str)) {
          findings.push({
            where: nodeWhere,
            message: `\`${str.trim().slice(0, 80)}\` looks like a reference written as a literal — a bare \`$ref.field\` is NOT interpolated.`,
            hint: `Wrap it and bind a variable: \`{source.id}\` (or \`{$User.Id}\` for the current user). (#1315)`,
            rule: FLOW_BARE_DOLLAR_REF,
          });
        }
      }
    }
  }
  return findings;
}
