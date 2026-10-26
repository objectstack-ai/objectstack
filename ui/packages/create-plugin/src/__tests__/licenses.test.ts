/**
 * Pins the scaffolder's licence contract (objectui#8041).
 *
 * The generator used to write `"license": "MIT"` into every manifest it
 * produced — unconditionally, without asking — and emit no LICENSE file at
 * all. An author who published a freshly scaffolded plugin therefore shipped a
 * tarball that CLAIMED a licence it did not carry, on a choice nobody had made
 * for them. The director-seat ruling (decision batch #91, 2026-09-08) settled
 * it as option C, verbatim: *"the scaffolder asks for the licence, defaults to
 * MIT, and writes the matching LICENSE text; non-interactive runs take the
 * default."*
 *
 * ## What these tests assert, and why it is the emitted artifact
 *
 * `buildPluginFiles` is the map the CLI writes to disk — `index.ts` is a loop
 * over it — so asserting over it is asserting over what a scaffolded package
 * really contains. That is deliberate, and it is the same choice
 * `templates.test.ts` makes: a grep of this repository's own source would go
 * green on a template that emits nothing.
 *
 * The two halves of the ruling are pinned separately because they fail
 * separately:
 *
 * - **the claim and the text agree** — for EVERY offered licence, not just the
 *   default, derived from {@link PLUGIN_LICENSES} rather than listed here, so
 *   a fifth option added without its text fails instead of shipping;
 * - **a run that answers nothing still gets both** — `resolveLicenseId` is
 *   total, and the default path emits the file.
 *
 * A third half arrived with objectui#8892: **an id nothing offers is refused,
 * not answered with MIT's text.** The id is emitted SIX times — the manifest,
 * the README's `## License` line and four source headers take it verbatim, and
 * only `buildLicenseFile` resolves it — so substituting a default at that one
 * place did not remove the disagreement, it authored one.
 *
 * ## The self-test
 *
 * `emits no licence text when the LICENSE entry is removed` is the reverse
 * verification: it rebuilds the pre-fix file map and asserts the invariant
 * NAMES it. Without that, every assertion below would still pass on a
 * generator that had quietly stopped emitting anything, because a rule that
 * reports success over an empty result is not a rule.
 */
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_LICENSE_ID,
  LICENSE_PROMPT,
  PLUGIN_LICENSES,
  findLicense,
  resolveLicenseId
} from '../licenses';
import {
  buildLicenseFile,
  buildPackageJson,
  buildPluginFiles,
  buildReadme,
  licenseCopyrightHolder,
  type PluginTemplateVars
} from '../templates';

/** The vars a default, non-interactive run produces: MIT, resolved not answered. */
const VARS: PluginTemplateVars = {
  packageName: '@object-ui/plugin-heatmap',
  pluginName: 'heatmap',
  pascalName: 'Heatmap',
  description: 'Heatmap plugin for ObjectUI',
  author: 'Jane Doe',
  license: resolveLicenseId(undefined),
  version: '0.1.0',
  year: 2026
};

const withLicense = (id: string): PluginTemplateVars => ({ ...VARS, license: id });

/**
 * A line every one of these licences carries and no other one does, so "the
 * text matches the claim" is an assertion about WHICH licence was emitted
 * rather than about whether some text was emitted.
 *
 * Hand-written on purpose: deriving the marker from the same table the
 * generator reads would make the check circular — it would pass for any two
 * texts as long as they were consistently swapped.
 */
const DISTINCTIVE_LINE: Record<string, string> = {
  MIT: 'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'Apache-2.0': '                           Version 2.0, January 2004',
  'BSD-3-Clause': '3. Neither the name of the copyright holder nor the names of its',
  ISC: 'Permission to use, copy, modify, and/or distribute this software for any purpose'
};

describe('the scaffolder asks for a licence and defaults to MIT (objectui#8041)', () => {
  it('offers the licence as a chooser with MIT preselected', () => {
    expect(LICENSE_PROMPT.name).toBe('license');
    // `select`, not free text: an answer the generator has no text for is the
    // defect this card removes, so the prompt cannot accept one.
    expect(LICENSE_PROMPT.type).toBe('select');
    expect(LICENSE_PROMPT.choices.map((choice) => choice.value)).toEqual(
      PLUGIN_LICENSES.map((license) => license.id)
    );
    expect(LICENSE_PROMPT.choices[LICENSE_PROMPT.initial].value).toBe(DEFAULT_LICENSE_ID);
    expect(DEFAULT_LICENSE_ID).toBe('MIT');
  });

  it('takes MIT for every answer a non-interactive run can produce', () => {
    // `prompts` returns a partial answer object when stdin is not a TTY or the
    // prompt is cancelled, so `answers.license` is genuinely absent there.
    for (const answer of [undefined, null, '', 'GPL-3.0-or-later', 42, {}]) {
      expect(resolveLicenseId(answer), `answer ${JSON.stringify(answer)}`).toBe('MIT');
    }
    // An offered id is passed through unchanged — the default must not swallow
    // a real choice.
    for (const license of PLUGIN_LICENSES) {
      expect(resolveLicenseId(license.id)).toBe(license.id);
    }
  });
});

describe('a manifest that claims a licence ships its text (objectui#8041)', () => {
  it('emits a LICENSE beside the manifest on the default path', () => {
    const files = buildPluginFiles(VARS);
    const manifest = buildPackageJson(VARS) as { license: string };

    expect(manifest.license).toBe('MIT');
    expect(Object.keys(files)).toContain('LICENSE');
    expect(files.LICENSE).toContain(DISTINCTIVE_LINE.MIT);
    expect(files.LICENSE).toContain('Copyright (c) 2026 Jane Doe');
  });

  it('emits the text matching whatever was chosen, for every offered licence', () => {
    // Derived from PLUGIN_LICENSES, so an option added without a usable text
    // fails here rather than reaching an author's package.json.
    for (const license of PLUGIN_LICENSES) {
      const vars = withLicense(license.id);
      const files = buildPluginFiles(vars);
      const manifest = buildPackageJson(vars) as { license: string };

      expect(manifest.license, license.id).toBe(license.id);
      expect(files.LICENSE, license.id).toContain(DISTINCTIVE_LINE[license.id]);
      expect(files.LICENSE.trim().length, license.id).toBeGreaterThan(400);
    }
  });

  it('names one licence, not two: README and source headers follow the manifest', () => {
    // A generated package that declared Apache-2.0 and told its readers MIT in
    // four file headers and its README would be the same defect wearing a
    // different hat.
    const vars = withLicense('Apache-2.0');
    const files = buildPluginFiles(vars);

    expect(buildReadme(vars)).toContain('Apache-2.0 © Jane Doe');
    for (const path of ['src/index.tsx', 'src/HeatmapImpl.tsx', 'src/types.ts', 'src/HeatmapImpl.test.tsx']) {
      expect(files[path], path).toContain('licensed under the Apache-2.0 license');
      expect(files[path], path).not.toContain('licensed under the MIT license');
    }
  });

  it('never emits a copyright line with no holder', () => {
    // The author prompt is optional and its initial value is empty, so this is
    // a real path, not a hypothetical one.
    const anonymous = { ...VARS, author: '   ' };
    expect(licenseCopyrightHolder(anonymous)).toBe('the @object-ui/plugin-heatmap authors');
    expect(buildPluginFiles(anonymous).LICENSE).toContain(
      'Copyright (c) 2026 the @object-ui/plugin-heatmap authors'
    );
    expect(licenseCopyrightHolder(VARS)).toBe('Jane Doe');
  });

  it('has a text for its own default, so the default path can never be empty', () => {
    // `resolveLicenseId` answers every unanswered run with this id, so a table
    // that lost it would turn EVERY default scaffold into the refusal below.
    expect(findLicense(DEFAULT_LICENSE_ID)).toBeDefined();
    expect(buildPluginFiles(VARS).LICENSE).toContain(DISTINCTIVE_LINE.MIT);
  });

  it('refuses an id nothing offers instead of answering it with MIT (objectui#8892)', () => {
    // This id used to be answered with MIT's TEXT while `buildPackageJson`,
    // `buildReadme` and the four source headers kept it verbatim — six licence
    // statements, five naming an id and the LICENSE beside them carrying
    // another licence entirely. Measured on 4d65991c5: manifest
    // `"NOT-A-LICENCE"`, README `NOT-A-LICENCE (c) Jane Doe`, four headers
    // `licensed under the NOT-A-LICENCE license`, LICENSE `MIT License`.
    //
    // Only ONE of the six resolves the id, so agreement cannot be restored from
    // this end for the other five; the id is refused for all six instead.
    let thrown: unknown;
    try {
      buildPluginFiles(withLicense('NOT-A-LICENCE'));
    } catch (error) {
      thrown = error;
    }

    // ⛔ Not `.toThrow()` on its own. The pre-fix code threw here too — for a
    // DIFFERENT reason (a licence table with no text for its own default), with
    // a message that names neither the offending id nor a way out — so a bare
    // throw assertion is green on both sides of this change.
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('NOT-A-LICENCE');
    expect(message).toContain('resolveLicenseId');
    for (const license of PLUGIN_LICENSES) {
      expect(message, `offered id ${license.id} named in the refusal`).toContain(license.id);
    }

    // ⭐ The assertion this card is actually about: NOTHING is emitted. A
    // repair that resolved the id a second time inside `buildPackageJson`
    // instead would leave this call RETURNING a map — one whose README and four
    // headers still disagreed with its LICENSE.
    expect(() => buildPluginFiles(withLicense('NOT-A-LICENCE'))).toThrow();
    expect(() => buildLicenseFile(withLicense('NOT-A-LICENCE'))).toThrow();
    // An offered id is untouched by the refusal.
    expect(() => buildLicenseFile(withLicense('ISC'))).not.toThrow();
  });

  it('emits no licence text when the LICENSE entry is removed', () => {
    // Reverse verification of the fix: the pre-objectui#8041 file map is this
    // one minus the LICENSE entry, and the guard above must NAME that, not
    // pass over it. `buildPluginFiles` is re-derived rather than mutated, so
    // this leaves nothing behind for the assertions above.
    const { LICENSE, ...preFix } = buildPluginFiles(VARS);

    expect(LICENSE).toBeDefined();
    expect(Object.keys(preFix)).not.toContain('LICENSE');
    expect(Object.keys(preFix)).toHaveLength(9);
    // The claim survives the ablation — which is exactly the state the card
    // exists to remove, and exactly what makes this ablation meaningful.
    expect((buildPackageJson(VARS) as { license: string }).license).toBe('MIT');
  });
});
