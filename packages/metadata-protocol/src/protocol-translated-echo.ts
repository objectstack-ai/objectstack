// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write door's inverse of the `/meta` read's TRANSLATION: an object body
 * that comes back carrying a label the read translated is stored with the
 * source text, never with the translation.
 *
 * ## Why the write door owes this
 *
 * A `/meta` read of an object is translated for the caller's locale on its way
 * out (the REST read exits run `translateMetadataDocument` from
 * `@objectstack/spec/system`): a field label the bundle carries an entry for,
 * and every injected system column's label through the built-in table, is
 * served in the caller's language. Studio edits by GET → edit → PUT of the
 * WHOLE body, and the write path persists the body verbatim (ADR-0005 appendix
 * (c)), so a zh-CN session stored the translation as the document:
 *
 *  - an injected column is no longer byte-identical to the platform's
 *    definition, so `stripInjectedSystemColumns` keeps it as the AUTHOR's own
 *    field. For `queue` that is a refusal: the registry refuses an author's
 *    `queue` on a user-owned object, so the object never registered and its
 *    data door answered 404 after a publish that said it succeeded. For
 *    `owner_id` and the others it is a silent change of what every other
 *    locale reads: the stored label is the author's now, so the translator
 *    yields to it and an `en` reader is served `负责人`.
 *  - an author's field the catalog translates stores the translation as its
 *    own label, which the catalog then can no longer translate for anyone.
 *
 * Its siblings on the same door, for the same reason: the read decorations
 * (`stripReadDecorations`), the derived provenance keys
 * (`stripDerivedProvenance`) and the injected columns themselves
 * (`stripServedObjectColumns`) — what the READ adds comes off again on the way
 * in. This one runs first, so the strip that follows sees the platform's own
 * definition again and removes it.
 *
 * ## The rule — comparison against the source the read translated
 *
 * A slot is restored when, and only when, the incoming value differs from the
 * SOURCE value and equals what the translator makes of that source in some
 * locale. The source is the field's definition before the read translated it:
 *
 *  - the stored row this save overwrites (the draft, or the active row a first
 *    draft overlays — the baseline the credential carry-forward reads); then
 *  - for an injected column, the platform's own definition, exactly as the
 *    read's `applyInjectedSystemColumns` adds it. Asked second, and also when
 *    the stored row declares the column: a row a zh-CN session already stored
 *    carries the echo itself, so compared with itself nothing differs, and
 *    compared with the platform's `queue` its label is `队列` for `Queue`. That
 *    is what lets the next save of such a row — and the stored-row migration,
 *    which re-saves through this door — repair it.
 *
 * The locales tried are every one the read could have answered in: the
 * bundle's, and the built-in system-field table's
 * (`BUILTIN_SYSTEM_FIELD_LABEL_LOCALES`), which the read applies with no
 * bundle at all. A request locale matches one of those or translates nothing.
 *
 * It is the same comparison-based provenance the translator itself applies
 * (`scalarOverridesPackagedBase`, ADR-0029 D9.2a), run backwards, and its edge
 * is the same: an author who deliberately types exactly the translation of
 * the source in some locale gets the source back — which the reader in that
 * locale is served anyway, since the catalog translates it. Nothing else is
 * touched: a label that is not a translation of its source is the author's
 * edit and is kept, and a field the source does not declare has nothing to
 * be compared with.
 *
 * Pure: no store, no service. The caller hands in the source row and the
 * bundle.
 */

import { injectedSystemColumnDefs } from '@objectstack/spec/data';
import {
    BUILTIN_SYSTEM_FIELD_LABEL_LOCALES,
    translateObject,
    type ObjectLike,
    type TranslationBundle,
} from '@objectstack/spec/system';

/**
 * The `conversionId` the stored-row migration (`migrateStoredMetadata`) files
 * a restored slot under. Not an ADR-0087 `MetadataConversion`: no stored
 * spelling is retired here, the row simply carries a value the save door now
 * keeps out — the same standing the `registerFlow` id has on a flow row's
 * TODOs.
 */
export const TRANSLATED_ECHO_NOTICE_ID = 'translated-label-echo';

/** One slot the door put back to its source text. */
export interface RestoredTranslatedSlot {
    /** Where, e.g. `fields.queue.label` or `fields.status.options[open].label`. */
    path: string;
    /** The translation the body carried. */
    from: string;
    /** The source text stored instead (`undefined` when the source has no such slot). */
    to: string | undefined;
}

/** The field slots the object translator writes. */
const FIELD_TEXT_SLOTS = ['label', 'description', 'inlineHelpText', 'inlineTitle'] as const;
/** The object scalars the object translator writes. */
const OBJECT_TEXT_SLOTS = ['label', 'pluralLabel', 'description'] as const;

type Rec = Record<string, unknown>;

/**
 * A slot read off a source that does not declare the field (or option) at
 * all: a sentinel no incoming string can equal, so that source explains
 * nothing about it.
 */
const NOT_DECLARED: unique symbol = Symbol('not-declared');

function isRec(value: unknown): value is Rec {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** A document's `fields` as `name -> definition`, from either the record or the array shape. */
function fieldMap(doc: unknown): Map<string, Rec> {
    const out = new Map<string, Rec>();
    if (!isRec(doc)) return out;
    const fields = doc.fields;
    if (Array.isArray(fields)) {
        for (const f of fields) if (isRec(f) && typeof f.name === 'string') out.set(f.name, f);
    } else if (isRec(fields)) {
        for (const [name, f] of Object.entries(fields)) if (isRec(f)) out.set(name, f);
    }
    return out;
}

function optionKey(option: unknown): string | undefined {
    if (!isRec(option)) return undefined;
    const v = option.value;
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
}

function optionLabel(options: unknown, key: string): unknown {
    return Array.isArray(options) ? (options.find((o) => optionKey(o) === key) as Rec | undefined)?.label : undefined;
}

/**
 * The locales a read could have translated into: the bundle's own, then the
 * built-in system-field table's. Order is irrelevant to the verdict.
 */
export function translatedEchoLocales(bundle: TranslationBundle | undefined): string[] {
    return [...new Set([...Object.keys(bundle ?? {}), ...BUILTIN_SYSTEM_FIELD_LABEL_LOCALES])];
}

/**
 * One source document and what every locale's read made of it: `fields` holds
 * only the names the incoming body declares.
 */
interface TranslatedSource {
    doc: Rec;
    fields: Map<string, Rec>;
    reads: Array<{ doc: Rec; fields: Map<string, Rec> }>;
}

function translatedSource(doc: Rec, locales: readonly string[], bundle: TranslationBundle | undefined): TranslatedSource {
    return {
        doc,
        fields: fieldMap(doc),
        reads: locales.map((locale) => {
            const read = translateObject(doc as unknown as ObjectLike, bundle, { locale }) as unknown as Rec;
            return { doc: read, fields: fieldMap(read) };
        }),
    };
}

/**
 * Put every translated slot of `item` back to its source text. Returns the
 * SAME reference when nothing was restored. See the module header.
 *
 * Two sources, asked in order, the first that explains the value wins: the
 * stored row's own declaration, then — for an injected column — the
 * platform's definition. The second is what heals a row a zh-CN session
 * already stored: its `queue` declaration IS the translation, so compared
 * with itself nothing differs, while compared with the platform's `queue` the
 * label is `队列` for `Queue`.
 */
export function restoreTranslatedEchoes<T>(
    item: T,
    args: { source: unknown; bundle: TranslationBundle | undefined },
): { item: T; restored: RestoredTranslatedSlot[] } {
    const restored: RestoredTranslatedSlot[] = [];
    if (!isRec(item) || typeof item.name !== 'string') return { item, restored };
    const incoming = fieldMap(item);
    const locales = translatedEchoLocales(args.bundle);

    const storedFields = fieldMap(args.source);
    const storedDoc: Rec = { name: item.name, fields: {} };
    for (const name of incoming.keys()) {
        const def = storedFields.get(name);
        if (def) (storedDoc.fields as Rec)[name] = { ...def };
    }
    if (isRec(args.source)) {
        for (const slot of OBJECT_TEXT_SLOTS) {
            if (typeof args.source[slot] === 'string') storedDoc[slot] = args.source[slot];
        }
    }
    const injectedDoc: Rec = { name: item.name, fields: {} };
    for (const [name, def] of Object.entries(injectedSystemColumnDefs(item))) {
        if (incoming.has(name)) (injectedDoc.fields as Rec)[name] = { ...def };
    }
    const sources = [storedDoc, injectedDoc]
        .filter((doc) => Object.keys(doc.fields as Rec).length > 0 || Object.keys(doc).length > 2)
        .map((doc) => translatedSource(doc, locales, args.bundle));
    if (sources.length === 0) return { item, restored };

    /**
     * The source text `value` is a translation of, through `pick` (which reads
     * one slot off a source document or a read of it, {@link NOT_DECLARED}
     * where that source does not declare it); `null` when no source explains
     * it. A source the value equals explains nothing and the next is asked:
     * that is the stored echo meeting the platform's definition.
     */
    const sourceOf = (value: unknown, pick: (doc: Rec, fields: Map<string, Rec>) => unknown): { to: unknown } | null => {
        if (typeof value !== 'string') return null;
        for (const source of sources) {
            const original = pick(source.doc, source.fields);
            if (original === NOT_DECLARED || original === value) continue;
            if (source.reads.some((read) => {
                const translated = pick(read.doc, read.fields);
                return translated !== original && translated === value;
            })) return { to: original };
        }
        return null;
    };

    let nextItem: Rec = item;
    for (const slot of OBJECT_TEXT_SLOTS) {
        const hit = sourceOf(item[slot], (doc) => (typeof doc[slot] === 'string' ? doc[slot] : NOT_DECLARED));
        if (!hit || typeof hit.to !== 'string') continue;
        restored.push({ path: slot, from: item[slot] as string, to: hit.to });
        nextItem = nextItem === item ? { ...item } : nextItem;
        nextItem[slot] = hit.to;
    }

    const nextFields = new Map<string, Rec>();
    for (const [name, field] of incoming) {
        if (!sources.some((source) => source.fields.has(name))) continue;
        let next: Rec = field;
        for (const slot of FIELD_TEXT_SLOTS) {
            const hit = sourceOf(field[slot], (_doc, fields) => {
                const f = fields.get(name);
                return f ? f[slot] : NOT_DECLARED;
            });
            if (!hit) continue;
            restored.push({ path: `fields.${name}.${slot}`, from: field[slot] as string, to: hit.to as string | undefined });
            next = next === field ? { ...field } : next;
            if (hit.to === undefined) delete next[slot];
            else next[slot] = hit.to;
        }
        if (Array.isArray(field.options)) {
            let options: unknown[] | undefined;
            field.options.forEach((option, index) => {
                const key = optionKey(option);
                if (key === undefined || !isRec(option)) return;
                const hit = sourceOf(option.label, (_doc, fields) => {
                    const f = fields.get(name);
                    return f ? optionLabel(f.options, key) ?? NOT_DECLARED : NOT_DECLARED;
                });
                if (!hit || typeof hit.to !== 'string') return;
                restored.push({ path: `fields.${name}.options[${key}].label`, from: option.label as string, to: hit.to });
                options ??= [...(field.options as unknown[])];
                options[index] = { ...option, label: hit.to };
            });
            if (options) {
                next = next === field ? { ...field } : next;
                next.options = options;
            }
        }
        if (next !== field) nextFields.set(name, next);
    }

    if (nextFields.size > 0) {
        nextItem = nextItem === item ? { ...item } : nextItem;
        const fields = item.fields;
        nextItem.fields = Array.isArray(fields)
            ? fields.map((f) => (isRec(f) && typeof f.name === 'string' && nextFields.get(f.name)) || f)
            : Object.fromEntries(Object.entries(fields as Rec).map(([name, f]) => [name, nextFields.get(name) ?? f]));
    }
    return { item: nextItem as T, restored };
}

