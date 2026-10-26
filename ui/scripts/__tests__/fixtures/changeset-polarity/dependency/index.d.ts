/**
 * The fixture DECLARED DEPENDENCY for objectui#9767.
 *
 * It stands in for `@objectstack/spec`: a package the tree under test declares,
 * re-exports from, and whose faces the member index therefore never sees. A
 * sentence naming one of these is at this instrument's own corpus boundary --
 * ⛔ not a claim about a schema that is gone.
 *
 * It is a `.d.ts` on purpose: a real dependency ships declarations, not source,
 * and the probe has to read the shape it will actually meet.
 */
declare const DepOnlySchema: unknown;
declare const DepSiblingSchema: unknown;
interface DepFaceSchema {
  type: string;
}
export { DepFaceSchema, DepOnlySchema, DepSiblingSchema };
