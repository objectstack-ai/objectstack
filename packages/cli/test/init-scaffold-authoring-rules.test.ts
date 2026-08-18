// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every built-in `objectstack init` template must survive the author-time rule
 * set the user's very next command runs.
 *
 * ## The incident this pins
 *
 * `npx @objectstack/cli init my-app -t app --install` printed `✓ Scaffold
 * validated`, and `npm run dev` — the next line of the documented on-ramp —
 * failed to compile:
 *
 *     ✗ Author-time rules failed (1 issue)
 *     • object "my_app_item": custom object "my_app_item" declares no
 *       sharingModel (OWD)…  rule: security-owd-unset
 *
 * The CLI's own shipped template was refused by the CLI's own shipped rules.
 * Nothing caught it because `init`'s self-test only checked that the rendered
 * config loaded, and no test ever ran a rule over generated template output.
 *
 * ## Why this is a per-template sweep and not one `app` assertion
 *
 * The defect class is "a shipped template the shipped rules refuse", so the
 * pin iterates `TEMPLATES` — the same map `init` emits from. A template added
 * later is swept the day it is added, without anyone remembering to extend
 * this file. `app` was the reported instance; the sweep found `plugin` in the
 * same state.
 *
 * The scaffold is generated through the command's own emitter
 * (`writeTemplateSrcFiles`) and checked through the command's own self-test
 * (`validateScaffold`), so neither half can drift from what `init` really does.
 *
 * Temp projects are created under this package's git-ignored `tmp/` (not
 * `os.tmpdir()`) because the rendered config imports `@objectstack/spec`,
 * which only resolves where Node can walk up into this package's
 * `node_modules`. Keeping them out of `test/` also keeps generated `.ts` away
 * from any glob that collects sources.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authoringRulesFor } from '@objectstack/lint';
import { TEMPLATES, sanitizeNamespace, writeTemplateSrcFiles } from '../src/commands/init.js';
import { validateScaffold, SCAFFOLD_RULE_COMMAND } from '../src/utils/scaffold-validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.resolve(HERE, '../tmp');
const PROJECT_NAME = 'my-app';

const roots: string[] = [];

afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

/** Generate one template into a throwaway directory, exactly as `init` does. */
function generate(templateKey: string): string {
  const template = TEMPLATES[templateKey];
  const namespace = sanitizeNamespace(PROJECT_NAME);
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(TMP_ROOT, `scaffold-${templateKey}-`));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, 'objectstack.config.ts'),
    template.configContent(PROJECT_NAME, namespace),
  );
  writeTemplateSrcFiles(template.srcFiles, root, PROJECT_NAME, namespace);
  return root;
}

describe('init scaffolds pass the author-time rules `dev` runs', () => {
  // `os dev` auto-compiles by spawning `os compile`, and `compile` runs the
  // registry under the 'build' command. If `init` ran a DIFFERENT command's
  // rule set it could refuse a scaffold `dev` accepts, or bless one `dev`
  // refuses — the second-bar drift `authoring-rules.ts` exists to prevent.
  it("holds scaffolds to the 'build' rule set, the one `dev` reaches via compile", () => {
    expect(SCAFFOLD_RULE_COMMAND).toBe('build');
    expect(authoringRulesFor(SCAFFOLD_RULE_COMMAND).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(TEMPLATES))(
    'template "%s" generates a project the author-time rules accept',
    async (templateKey) => {
      const report = await validateScaffold(generate(templateKey));

      expect(report.schemaError, `template "${templateKey}" must satisfy the protocol schema`).toBeNull();

      const rendered = report.errors
        .map((f) => `  [${f.rule}] ${f.where} at ${f.path}: ${f.message}`)
        .join('\n');
      expect(
        report.errors,
        `template "${templateKey}" generates a project its own author-time rules refuse.\n` +
          `The user's next command (\`npm run dev\`) fails to compile on exactly these:\n${rendered}`,
      ).toEqual([]);

      // A rule set that ran zero rules would satisfy the assertion above while
      // checking nothing — the green-because-nothing-ran direction.
      expect(report.ruleCount).toBeGreaterThan(0);
    },
    120_000,
  );

  // The reported instance, pinned by name so a future template edit that drops
  // the field fails with the incident's own vocabulary rather than a bare count.
  it.each(
    Object.keys(TEMPLATES).filter((k) => Object.keys(TEMPLATES[k].srcFiles).length > 0),
  )('template "%s" declares an authored OWD on every object it emits', (templateKey) => {
    const namespace = sanitizeNamespace(PROJECT_NAME);
    const objectSources = Object.entries(TEMPLATES[templateKey].srcFiles)
      .filter(([filePath]) => filePath.replace(/__name__/g, namespace).includes('src/objects/')
        && !filePath.endsWith('index.ts'))
      .map(([, contentFn]) => contentFn(PROJECT_NAME, namespace));

    expect(objectSources.length).toBeGreaterThan(0);
    for (const src of objectSources) {
      // ADR-0090 D1: absence is not a decision. 'private' is the rule's own
      // recommended default (owner + explicit shares).
      expect(src, `template "${templateKey}" object source must author sharingModel`).toMatch(
        /sharingModel: '(private|public_read|public_read_write|controlled_by_parent)'/,
      );
    }
  });
});
