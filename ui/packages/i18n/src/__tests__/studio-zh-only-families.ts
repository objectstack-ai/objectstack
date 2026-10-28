/**
 * The `studio` namespace's `zh`-only key families, the one list.
 *
 * Two pins read it: `studio-namespace.test.ts` here, which reds on a `zh`-only
 * key outside these prefixes, and app-shell's
 * `inspectorStrings.studioNamespace-25922.test.ts`, whose `ZH_ONLY_REASONS`
 * carries the reason and consumer for each family and asserts its prefixes
 * equal this list. A test-support module, not an export of the package entry:
 * `__tests__/` is excluded from the build, so nothing here ships.
 */
export const STUDIO_ZH_ONLY_FAMILIES: readonly string[] = Object.freeze([
  'engine.flowNode.',
  'engine.enum.type.',
  'engine.packages.form.help.',
]);
