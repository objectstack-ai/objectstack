/**
 * The one parser that answers "which workflow produces which check run?".
 *
 * It lived inside `dependabot-merge-gate.test.ts`, which is the only place that
 * needed it while only one test asked the question. `merge-queue-reporting.test.ts`
 * now asks it too — it derives the `merge_group` subscription floor from
 * `REQUIRED_CONTEXTS` (objectui#6160) — so the parser moved here rather than
 * being written a second time. A second copy of a YAML parser is a second
 * answer to the same question, and the whole point of the assertion that needed
 * it is that two declarations of one fact drift.
 *
 * It is a module and not an export of the test file on purpose: importing a
 * `*.test.ts` from another `*.test.ts` re-registers its `describe` blocks inside
 * the importing file, so the same suite would run twice and report failures
 * under the wrong file.
 *
 * Deliberately not a YAML library: these functions read the workflows as the
 * repository actually authors them (two-space job keys, `name:` at four spaces,
 * a single `shard:` matrix), and every one of them strips comment lines first —
 * every workflow in this repo discusses `pull_request:`, `merge_group:` and
 * `paths-ignore:` in prose, and a scan that counted the prose would report
 * triggers no file has.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const workflowDir = path.join(repoRoot, '.github', 'workflows');

export type Workflow = {
  file: string;
  text: string;
  /** Lines with comments stripped, so prose mentioning `pull_request:` cannot count. */
  lines: string[];
};

export function readWorkflows(): Workflow[] {
  return fs
    .readdirSync(workflowDir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => {
      const text = fs.readFileSync(path.join(workflowDir, file), 'utf8');
      return { file, text, lines: text.split('\n').filter((line) => !/^\s*#/.test(line)) };
    });
}

/** The `on:` block of a workflow, comment lines already stripped. */
export function triggerBlock(workflow: Workflow): string[] {
  const start = workflow.lines.findIndex((line) => /^on:/.test(line));
  if (start === -1) return [];
  const rest = workflow.lines.slice(start + 1);
  const end = rest.findIndex((line) => /^[A-Za-z]/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Does this workflow subscribe `pull_request`, and does that subscription carry
 * a path filter? `pull_request_target` deliberately does not count:
 * `cross-repo-issue-closer.yml` uses it with `types: [closed]`, so it acts after
 * a merge and has no verdict to contribute to one.
 */
export function pullRequestTrigger(workflow: Workflow): { subscribes: boolean; filtered: boolean } {
  const block = triggerBlock(workflow);
  const start = block.findIndex((line) => /^ {2}pull_request:\s*$/.test(line));
  if (start === -1) return { subscribes: false, filtered: false };

  const rest = block.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  const sub = end === -1 ? rest : rest.slice(0, end);
  return { subscribes: true, filtered: sub.some((line) => /^ {4}paths(-ignore)?:/.test(line)) };
}

/** Does this workflow subscribe the `merge_group` event? */
export function subscribesMergeGroup(workflow: Workflow): boolean {
  return triggerBlock(workflow).some((line) => /^ {2}merge_group:/.test(line));
}

/**
 * The check names a workflow's jobs appear under. A job's `name:` if it has one,
 * else its id (`labeler.yml`'s job is simply `label`), with `matrix.shard`
 * expanded. Every job of a subscribing workflow produces a check run on a pull
 * request — including one skipped by a job-level `if:`, which reports
 * `conclusion=skipped` rather than not existing.
 */
export function checkNames(workflow: Workflow): string[] {
  const jobsAt = workflow.lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsAt === -1) return [];
  const body = workflow.lines.slice(jobsAt + 1);

  const starts: number[] = [];
  body.forEach((line, index) => {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)) starts.push(index);
  });

  return starts.flatMap((start, i) => {
    const block = body.slice(start, starts[i + 1] ?? body.length);
    const id = block[0].trim().replace(/:$/, '');
    const named = block.find((line) => /^ {4}name:/.test(line));
    const name = named ? named.replace(/^ {4}name:\s*/, '').trim() : id;

    const shards = block.find((line) => /^ {8}shard: \[/.test(line));
    if (!shards || !name.includes('matrix.shard')) return [name];

    return (shards.match(/\[(.*)\]/)?.[1] ?? '')
      .split(',')
      .map((shard) => shard.trim())
      .filter(Boolean)
      .map((shard) => name.replace(/\$\{\{\s*matrix\.shard\s*\}\}/g, shard));
  });
}

/**
 * `check name -> the workflow file that produces it`, over every workflow that
 * subscribes `pull_request`.
 *
 * This is the mapping both callers mean by "which workflow produces this
 * check": `dependabot-merge-gate.test.ts` uses it to assert the gate's three
 * buckets partition the produced set exactly, and `merge-queue-reporting.test.ts`
 * uses it to turn `REQUIRED_CONTEXTS` — a list of check NAMES — into the set of
 * workflow FILES that must subscribe `merge_group`.
 */
export function producedCheckNames(): Map<string, string> {
  const produced = new Map<string, string>();
  for (const workflow of readWorkflows()) {
    if (!pullRequestTrigger(workflow).subscribes) continue;
    for (const name of checkNames(workflow)) produced.set(name, workflow.file);
  }
  return produced;
}
