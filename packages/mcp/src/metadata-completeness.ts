// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * metadata-completeness — the shared vocabulary for "this MCP surface is
 * serving a listing it knows to be SHORT" (#6504, ADR-0110 D3).
 *
 * Extracted from `mcp-server-runtime.ts` rather than copied. Two surfaces in
 * this package now withhold a completeness claim on the same verdict — the
 * `objectstack://objects` RESOURCE and the `list_objects` TOOL — and they must
 * say the same thing in the same words, or a client that branches on one
 * learns nothing about the other. `mcp-server-runtime.ts` imports
 * `mcp-http-tools.ts`, so this lives beside them both instead of being
 * exported from either (an import back would be a cycle).
 */

/**
 * [#6055] The classification this package gives "the metadata read did not
 * happen" — as opposed to "the read happened and found nothing"
 * (`RESOURCE_NOT_FOUND`, which stays private to the runtime file that uses it).
 * The standard catalog's own code for its status (`HttpStatusErrorCodeMap[503]`,
 * ADR-0112) — the same spelling the `sys_metadata` half of this family already
 * emits (#5532 / #5843 / #5705), not a vocabulary invented for MCP.
 *
 * There is no HTTP status on the resource/prompt surfaces: MCP answers
 * `prompts/get` with a `GetPromptResult` and `resources/read` with a
 * `ReadResourceResult`, and neither carries an error envelope (only
 * `CallToolResult` has `isError`). So the code travels in the payload the
 * surface already had — text for a prompt, the JSON body for a resource — and
 * that is the strongest discriminator this transport offers.
 */
export const METADATA_UNAVAILABLE_CODE = 'SERVICE_UNAVAILABLE';

/**
 * [#6504] The sentence for "a listing that is known to be SHORT".
 *
 * The best-effort set IS served: a partial listing is still the most useful
 * true thing these surfaces have, and withholding it would turn a diagnosis fix
 * into a functional regression. What is withheld is the **completeness claim**
 * on top of it — which is the entire defect — so the sentence states the
 * direction of the error (`at least`, never exactly) and names the count as
 * *served*, never as a total.
 */
export function metadataPartialListingSentence(plural: string, served: number): string {
  return (
    `The metadata service could not be fully read, so this listing of ${plural} is known to be INCOMPLETE. `
    + `${served} ${served === 1 ? 'is' : 'are'} being served and the total is withheld — `
    + `this environment declares at least that many ${plural}, possibly more. `
    + 'Retry once the metadata service is reachable.'
  );
}

/**
 * [#6504] What a bridge reports when it can say whether its object listing was
 * complete — the shape of `McpDataBridge.listObjectsDiagnosed`.
 *
 * `degraded` means the set is known-PARTIAL: never that it is empty, and never
 * that it is wrong. `objects` is still the best-effort answer and is served as
 * it always was.
 */
export interface DiagnosedObjectListing<T> {
  objects: T[];
  degraded: boolean;
  errors: string[];
}

/**
 * [#6504] Ask a metadata service whether its object listing can be trusted as
 * complete, without re-resolving the listing through it.
 *
 * The composition PR #7721 established and this sweep reuses at every consumer:
 * the ITEMS come from whatever resolver the call site already used
 * (`listObjects()`), and only the VERDICT is asked of `listDiagnosed`, the
 * member declared to answer it. `listObjects` is its own member of
 * `IMetadataService` and declares no equivalence to `list('object')`, so
 * resolving the items through the diagnosed read instead would presume one —
 * the private dialect Prime Directive #12 forbids. On the implementation that
 * ships they are the same read and share one cache entry and one single-flight
 * slot, so the probe costs nothing; where they differ the verdict describes the
 * loader set, which can only WITHHOLD a completeness claim, never manufacture
 * one.
 *
 * A service predating `listDiagnosed` reports nothing degraded — precisely what
 * it could express.
 */
export async function diagnoseObjectListRead(
  metadataService: {
    listDiagnosed?: (type: string) => Promise<{ degraded?: boolean; errors?: unknown } | undefined>;
  } | undefined | null,
): Promise<{ degraded: boolean; errors: string[] }> {
  if (typeof metadataService?.listDiagnosed !== 'function') {
    return { degraded: false, errors: [] };
  }
  const diagnosed = await metadataService.listDiagnosed('object');
  return {
    degraded: diagnosed?.degraded === true,
    errors: Array.isArray(diagnosed?.errors) ? (diagnosed.errors as string[]) : [],
  };
}
