/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { load as loadYaml } from 'js-yaml';
import { describeUndeclaredKey, validateAuthoredDocument } from '../utils/authoring-face.js';
import { findSpecVocabularyFormFields } from '../utils/spec-vocabulary-hint.js';
import {
  describeRecordBindingWithoutLimitOne,
  findRecordBindingsWithoutLimitOne,
} from '../utils/record-block-binding-hint.js';
import { explainUnionIssue, findUndeclaredKeys } from '../utils/union-arm-diagnostics.js';
import { formatIssuePath } from '../utils/issue-path.js';

/**
 * Validate a schema file
 * 
 * @param schemaPath - Path to the schema file (JSON or YAML)
 */
export async function validate(schemaPath: string) {
  console.log(chalk.blue('🔍 ObjectUI Schema Validator\n'));

  // Resolve the schema path
  const resolvedPath = resolve(process.cwd(), schemaPath);

  // Check if file exists
  if (!existsSync(resolvedPath)) {
    console.error(chalk.red(`✗ Error: Schema file not found: ${schemaPath}`));
    process.exit(1);
  }

  try {
    // Read the file
    const fileContent = readFileSync(resolvedPath, 'utf-8');
    let schema: unknown;

    // Parse based on file extension
    if (schemaPath.endsWith('.yaml') || schemaPath.endsWith('.yml')) {
      console.log(chalk.gray(`Reading YAML schema from: ${schemaPath}`));
      schema = loadYaml(fileContent);
    } else if (schemaPath.endsWith('.json')) {
      console.log(chalk.gray(`Reading JSON schema from: ${schemaPath}`));
      schema = JSON.parse(fileContent);
    } else {
      // Try JSON first, then YAML
      try {
        schema = JSON.parse(fileContent);
        console.log(chalk.gray(`Reading schema from: ${schemaPath} (detected as JSON)`));
      } catch {
        schema = loadYaml(fileContent);
        console.log(chalk.gray(`Reading schema from: ${schemaPath} (detected as YAML)`));
      }
    }

    // Validate the schema — through the STRICT authoring face (objectui#5250):
    // a key no schema declares is refused, at any depth. The door is shared
    // with `objectui check`; see `../utils/authoring-face.ts`.
    console.log(chalk.gray('Validating schema...\n'));
    const result = validateAuthoredDocument(schema);

    if (result.success) {
      console.log(chalk.green('✓ Schema is valid!\n'));
      
      // Show some info about the schema
      const data = result.data;
      console.log(chalk.bold('Schema Information:'));
      console.log(chalk.gray('  Type:'), data.type || 'unknown');
      
      if (data.id) {
        console.log(chalk.gray('  ID:'), data.id);
      }
      
      // `title` is declared by some arms of the parsed union and not others, so
      // it is read only where the parsed node carries it (objectui#11355).
      const title = 'title' in data ? data.title : undefined;
      if (data.label || title) {
        console.log(chalk.gray('  Label:'), data.label || title);
      }
      
      // Count children if present
      if (data.children && Array.isArray(data.children)) {
        console.log(chalk.gray('  Children:'), data.children.length);
      }

      // Mixed-vocabulary entries validate (the runtime `name` satisfies the
      // schema) but the spec `field` key is dead weight: the renderer ignores
      // it and strip-mode validation drops it. Valid ≠ clean — say so (#3090).
      const mixed = findSpecVocabularyFormFields(schema).filter((f) => f.mixedName);
      // A one-record block bound by a `dataSource` that can match several rows
      // draws the first by its `sort`; the author should say `limit: 1`
      // (objectui#12294). Advisory: the document is valid either way.
      const unboundedRecordBindings = findRecordBindingsWithoutLimitOne(schema);
      if (mixed.length > 0 || unboundedRecordBindings.length > 0) {
        console.log(chalk.yellow('\nWarnings:'));
        for (const m of mixed) {
          console.log(chalk.yellow(
            `  ${m.path}: '${m.mixedName}' also carries { field: '${m.field}' } — mixed form-field ` +
            `vocabularies. The renderer ignores \`field\` here; drop one of the two.`,
          ));
        }
        for (const finding of unboundedRecordBindings) {
          console.log(chalk.yellow(`  ${describeRecordBindingWithoutLimitOne(finding)}`));
        }
      }

      console.log('');
      process.exit(0);
    } else {
      console.error(chalk.red('✗ Schema validation failed!\n'));
      console.error(chalk.bold('Validation Errors:'));
      
      // Format Zod errors nicely. `.issues` is the only accessor on a Zod 4
      // ZodError — the `.errors` alias was removed, so reading it yielded
      // undefined and this loop threw a TypeError that the catch below
      // reported as "Error reading or parsing schema file", hiding the very
      // errors this command exists to print.
      // Every issue gets a Path line, INCLUDING a root-level one (`85b495795`).
      //
      // The guard here used to be `issue.path.length > 0`, which dropped the
      // line entirely for `path: []` — silent in exactly the case a reader
      // most needs oriented. Measured before that change, a menu carrying the
      // retired `{ type: 'separator' }` divider spelling printed
      // `1. Invalid input` and a Code line, and nothing said whether the whole
      // document or some node inside it had been judged.
      //
      // ⚠️ WHERE A ROOT ISSUE COMES FROM MOVED (objectui#8498). This block read
      // "`AnyComponentSchema`, a `z.union` of every component arm, so ANY
      // document matching no arm reports one top-level issue at the root".
      // It discriminates on `type` now and both halves are false: a `type` that
      // SELECTS an arm yields that arm's own issues as the top-level entries,
      // already absolute, with no union issue at the root; a `type` that matches
      // nothing is judged at `['type']`. A root path now means a non-object.
      //
      // The path is spelled by `formatIssuePath`, which owns the `(root)`
      // convention and is shared with `objectui check` (objectui#11007).
      //
      // The ARM-SELECTION half (`a5d55472b`) landed on the 2026-09-02
      // maintainer ruling (option B): print the issues of the arm the authored
      // `type` selects, and nothing from the others. Since objectui#8498 ZOD
      // does that selecting — a matched discriminator yields the arm's issues
      // directly, so there is no union issue here to expand. What
      // `explainUnionIssue` still answers is the other half of the ruling: the
      // capped candidate note when NO arm accepts, and the undiscriminated
      // unions still reached at nested slots. Everything about WHICH arm lives
      // in `../utils/union-arm-diagnostics.js`; this file only prints, and it
      // is the CLI's full zod-issue printer. `objectui check` prints one line
      // per file that did not validate — that file's first issue, through the
      // same path formatter — plus the undeclared-key lines printed below (the
      // same reader and wording, objectui#5250), and sends the reader here for
      // the rest.
      result.error.issues.forEach((issue, index) => {
        console.error(chalk.red(`\n${index + 1}. ${issue.message}`));
        console.error(chalk.gray(`   Path: ${formatIssuePath(issue.path)}`));
        if (issue.code) {
          console.error(chalk.gray(`   Code: ${issue.code}`));
        }

        // The selected arm's own diagnosis, indented under the entry it
        // explains and numbered `<n>.<k>` so it can never be mistaken for a
        // separate top-level issue (`1.1` does not match the `^\d+\. ` shape a
        // numbered entry has).
        explainUnionIssue(issue, schema).forEach((line, sub) => {
          const where = formatIssuePath(line.path);
          if (line.kind === 'note') {
            // No arm accepts the authored `type`. Name that, then the nearest
            // few of the accepted values — never all of them, which is the
            // noise the ruling rejected option A for.
            const at = line.path.length > 0 ? ` at ${where}` : '';
            if (line.authoredType === undefined) {
              console.error(
                chalk.yellow(
                  `   No \`type\` is declared${at}, so none of the ${line.totalArmNames} ` +
                  `accepted component types can be selected.`,
                ),
              );
              return;
            }
            console.error(
              chalk.yellow(`   No arm accepts type "${line.authoredType}"${at}.`),
            );
            if (line.candidates.length > 0) {
              console.error(
                chalk.gray(
                  `   Nearest of the ${line.totalArmNames} accepted types: ` +
                  line.candidates.join(', '),
                ),
              );
            }
            return;
          }
          const arm = line.arm === undefined ? '' : `[arm ${line.arm}] `;
          console.error(chalk.red(`   ${index + 1}.${sub + 1} ${arm}${line.message}`));
          console.error(chalk.gray(`       Path: ${where}`));
          if (line.code) {
            console.error(chalk.gray(`       Code: ${line.code}`));
          }
        });
      });

      // Every undeclared key, named with its path and what to do (objectui#5250).
      // The issue list above already carries each one — but at a union the
      // object fits more than one arm of (a dashboard widget) only inside an
      // arm's diagnosis, under an `Invalid input` that names no key, and
      // nowhere with a prescription. This block is the loud form, and it is
      // read off the same issues rather than a second parse.
      const undeclared = findUndeclaredKeys(result.error.issues);
      if (undeclared.length > 0) {
        console.error(chalk.bold('\nUndeclared keys — the strict authoring face refuses them:'));
        for (const finding of undeclared) {
          console.error(chalk.yellow(`   ${describeUndeclaredKey(finding, schema)}`));
        }
      }

      // A mixed-vocabulary entry validated under the tolerant face and got the
      // warning in the success branch above (#3090). The strict face refuses its
      // `field` key as undeclared, so the same entry now lands HERE — keep the
      // explanation with it rather than leave that warning unreachable.
      const mixedHere = findSpecVocabularyFormFields(schema).filter((f) => f.mixedName);
      for (const m of mixedHere) {
        console.error(chalk.yellow(
          `   ${m.path}: '${m.mixedName}' also carries { field: '${m.field}' } — mixed form-field ` +
          `vocabularies. The renderer ignores \`field\` here; drop one of the two.`,
        ));
      }

      // "name: expected string, received undefined" on a `{ field: … }` entry
      // reads as an instruction to bolt a `name` on — which converts the
      // metadata WRONGLY (the spec shape stands for an object-schema merge
      // that a bare rename throws away). When the input matches that
      // signature, name the actual boundary and the real fixes (#3090).
      const specShaped = findSpecVocabularyFormFields(schema).filter((f) => !f.mixedName);
      if (specShaped.length > 0) {
        console.error(chalk.bold('\nLikely cause — spec form-view vocabulary in a standalone form:'));
        for (const s of specShaped) {
          console.error(chalk.yellow(
            `   ${s.path}: { field: '${s.field}' } is the spec form-VIEW shape (an object-field reference).`,
          ));
        }
        console.error(chalk.yellow(
          `   A standalone \`type: 'form'\` component uses { name: … } (the form data path).\n` +
          `   Fix: author the field with \`name\` and its own type/label — or, to reference object fields\n` +
          `   with the spec shape, use an object-bound form (\`type: 'object-form'\` with objectName +\n` +
          `   sections), whose section fields are translated by the renderer.`,
        ));
      }

      console.error('');
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('\n✗ Error reading or parsing schema file:'));
    console.error(chalk.red((error as Error).message));
    console.error('');
    process.exit(1);
  }
}
