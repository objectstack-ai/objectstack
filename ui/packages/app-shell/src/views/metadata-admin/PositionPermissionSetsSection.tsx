// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PositionPermissionSetsSection — what the permission sets a position names
 * grant, read-only, on the Setup catalog's position page (objectstack#26187,
 * ruling 6416233738 Q1; ADR-0131 D4).
 *
 * A position grants access only through the permission sets its definition
 * names (`permissionSets`). The position page used to list those names and show
 * nothing of what they grant, so an admin reviewing a position could not see an
 * object, a capability or a record scope without opening every set in turn.
 * This section renders, for each named set, that set's own `PermissionPreview`:
 *
 *  - one preview per named set, in the order the position names them, each
 *    under the set's name and a link to the set's page (same catalog scope);
 *  - no union of the sets is computed here: what a holder ends up with is the
 *    server's answer (the authorization resolver), not a client-side merge;
 *  - nothing is editable: the preview gets no `onPatch`, and a set is changed
 *    on its own page;
 *  - a named set the server does not serve (`client.get` answers `null` on a
 *    404) shows one "not found" line for that set only; a refused or failed
 *    read is said as such, in the server's words, because a refused read is not
 *    an absent set;
 *  - a position that names no set says so.
 *
 * The names are read from the page's draft, as the position preview above this
 * section reads them, so the list follows the definition on screen. Each set is
 * read through the console metadata client the page itself uses.
 */

import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { useMetadataClient } from './useMetadata.js';
import { useMetadataLocale, t, tFormat } from './i18n.js';
import { environmentScopeSuffix } from './catalog-scope.js';
import { PermissionPreview } from './previews/PermissionPreview.js';

export interface PositionPermissionSetsSectionProps {
  /** The position's machine name. */
  name: string;
  /** The position definition on screen; only `permissionSets` is read. */
  draft: Readonly<Record<string, unknown>>;
}

/** One named set's read, as this section shows it. */
type SetRead =
  | { state: 'loading' }
  | { state: 'loaded'; body: Record<string, unknown> }
  | { state: 'missing' }
  | { state: 'failed'; sentence: string };

/** The names a position definition declares, in order; anything else declares none. */
export function declaredPermissionSets(draft: Readonly<Record<string, unknown>>): string[] {
  const value = draft.permissionSets;
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string' && s !== '') : [];
}

/** The server's sentence out of a failed read, or `''` when it gave none. */
function failureSentence(err: unknown): string {
  return err instanceof Error && err.message ? err.message : '';
}

export function PositionPermissionSetsSection({ draft }: PositionPermissionSetsSectionProps) {
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  const [searchParams] = useSearchParams();
  const scopeSuffix = environmentScopeSuffix(searchParams);

  const declared = declaredPermissionSets(draft);
  // The read effect keys on the list's content, not on the draft object, so an
  // edit to another field of the position does not re-read every set.
  const declaredKey = JSON.stringify(declared);
  const [reads, setReads] = React.useState<Record<string, SetRead>>({});

  React.useEffect(() => {
    const names: string[] = JSON.parse(declaredKey);
    const unique = Array.from(new Set(names));
    let cancelled = false;
    setReads(Object.fromEntries(unique.map((n) => [n, { state: 'loading' } as SetRead])));
    for (const setName of unique) {
      client
        .get<Record<string, unknown>>('permission', setName)
        .then(
          (body): SetRead => (body ? { state: 'loaded', body } : { state: 'missing' }),
          (err: unknown): SetRead => ({ state: 'failed', sentence: failureSentence(err) }),
        )
        .then((read) => {
          if (!cancelled) setReads((prev) => ({ ...prev, [setName]: read }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [client, declaredKey]);

  return (
    <section className="mt-6 rounded-md border" data-testid="position-permission-sets">
      <div className="px-4 py-3 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span>{t('engine.position.sets.title', locale)}</span>
          {declared.length > 0 && (
            <span className="text-xs text-muted-foreground font-normal">{declared.length}</span>
          )}
        </div>
        {declared.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">{t('engine.position.sets.hint', locale)}</p>
        )}
      </div>
      <div className="px-4 py-3">
        {declared.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="position-permission-sets-empty">
            {t('engine.position.sets.empty', locale)}
          </p>
        ) : (
          <ol className="space-y-3">
            {declared.map((setName, i) => {
              const read = reads[setName] ?? { state: 'loading' };
              return (
                <li
                  key={`${i}:${setName}`}
                  data-testid="position-permission-set"
                  data-set-name={setName}
                  className="space-y-1.5"
                >
                  <h3 className="text-xs font-medium">
                    <Link
                      to={`../../permission/${encodeURIComponent(setName)}${scopeSuffix}`}
                      relative="path"
                      className="font-mono hover:underline"
                      title={t('engine.position.sets.open', locale)}
                    >
                      {setName}
                    </Link>
                  </h3>
                  {read.state === 'loading' && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('engine.position.sets.loading', locale)}
                    </p>
                  )}
                  {read.state === 'missing' && (
                    <p className="text-xs text-muted-foreground" data-testid="position-permission-set-missing">
                      {tFormat('engine.position.sets.notFound', locale, { name: setName })}
                    </p>
                  )}
                  {read.state === 'failed' && (
                    <p
                      className="flex items-start gap-1.5 text-xs text-destructive"
                      data-testid="position-permission-set-read-failed"
                    >
                      <AlertCircle className="h-3.5 w-3.5 mt-px shrink-0" />
                      <span>
                        {tFormat('engine.position.sets.readFailed', locale, { name: setName })}
                        {read.sentence && <> {read.sentence}</>}
                      </span>
                    </p>
                  )}
                  {read.state === 'loaded' && (
                    <div data-testid="position-permission-set-preview">
                      <PermissionPreview type="permission" name={setName} draft={read.body} locale={locale} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
