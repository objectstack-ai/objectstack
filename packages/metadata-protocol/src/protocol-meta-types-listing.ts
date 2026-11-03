// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29510] The NAMED return type of `ObjectStackProtocolImplementation.getMetaTypes()`
// (`GET /meta/types`), composed from types `@objectstack/spec` already exports.
//
// Why a name: inferred, that return type rolled up into ~790 lines of inline
// `.d.ts`, and every `protocol.ts` cut of #25467 had to read that raw block by
// hand, because a byte shift in `protocol.ts` can surface a class comment
// inside an inferred type. Named, the `.d.ts` prints these aliases instead.
//
// What holds it to the implementation: `getMetaTypes()` builds its answer with
// an inferred type, and a `const` typed `Equal<inferred, MetaTypesListing>`
// is initialised with `true` there: it only compiles when the inferred type is
// EQUAL (not merely assignable) to the one declared here. A member added,
// dropped or retyped on either side fails `tsc` at that line. The type is the
// one `main` emitted before the name existed; only its `.d.ts` spelling changed.
//
// Not exported from the package index: no new public name.

import type { MetadataTypeRegistryEntryParsed } from '@objectstack/spec/kernel';
import type { Action, FormView } from '@objectstack/spec/ui';

/** Flattens an intersection into one object type, so it compares EQUAL to an inferred object literal. */
type Flatten<T> = { [K in keyof T]: T[K] };

/**
 * One `entries` row: the registry entry for the type, with the per-type
 * fields the listing adds or overrides. A type with no registry entry gets a
 * synthesised descriptor that is a subtype of this row.
 */
export type MetaTypesListingEntry = Flatten<
    Omit<MetadataTypeRegistryEntryParsed, 'type' | 'allowEnvironmentOverlay' | 'actions'> & {
        /** Singular spelling, as `PLURAL_TO_SINGULAR` resolves it; plugin types are not in the registry enum. */
        type: string;
        /** Same value as `type`; the API client reads this field. */
        schemaId: string;
        /** The registry value, raised by the `OS_METADATA_WRITABLE` env hatch. */
        allowEnvironmentOverlay: boolean;
        /** `'env'` when only the env hatch opened the overlay. */
        overrideSource: 'registry' | 'env';
        /** JSON Schema of the type, for the generic admin form. */
        schema: Record<string, unknown>;
        /** Form layout of the type's editor. */
        form: FormView;
        /** The minimal create seed, when the spec declares one. */
        createSeed?: {} | null;
        /**
         * Declarative plus plugin-registered type actions (`Action[]`); absent
         * when there are none. The registry entry's own parsed `actions` stay
         * in the type because the row spreads the entry before overriding.
         */
        actions?: Action[] | NonNullable<MetadataTypeRegistryEntryParsed['actions']>;
    }
>;

/** What `getMetaTypes()` answers. */
export type MetaTypesListing = {
    /** Every live type name, spelled as its source stores it. */
    types: string[];
    /** One row per live type, sorted by `domain`, then `type`. */
    entries: MetaTypesListingEntry[];
};

/**
 * Strict type equality: no `any` leak, no one-sided assignability. `true`
 * only when `A` and `B` are the same type.
 */
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
