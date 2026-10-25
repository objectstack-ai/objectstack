import React, { useId } from 'react';
import { Input, Label, EmptyValue } from '@object-ui/components';
import { useDisplayLocale } from '@object-ui/i18n';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { toHostGroupProps } from './toHostGroupProps.js';
import { useFieldTranslation } from './useFieldTranslation.js';
// The value shape and the single-line formatting rule now live in a pure module
// so the display (read) cell renderer formats a stored address exactly the way
// this widget's readonly branch does — one rule, not two copies that drift
// (objectui#4037). Behaviour here is unchanged; only the definition moved.
import {
  formatAddress,
  readPostalCode,
  type AddressValue,
  type LegacyAddressValue,
} from './address-format.js';

// Re-exported through its declaring module rather than bare, so the spec-symbol
// guard resolves the name to where it is actually defined: `address-format`
// imports `AddressValue` from `@objectstack/spec/data` (objectui#4167), and a
// bare `export type { AddressValue }` here would read to that guard as a second,
// local declaration of a name the spec owns.
export type { AddressValue } from './address-format.js';

/**
 * Address field widget - provides a structured address input
 * Supports street, city, state, postal code, and country
 */
export function AddressField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<AddressValue>) {
  const address = value || {};
  // DOM pass-through (objectui#3318): the whitelist spread goes onto the FIRST
  // sub-input (street) — one carrier for the form renderer's aria-describedby;
  // the composite's validation state goes onto EVERY focusable sub-input via
  // `aria-invalid={!!error}` (a form-level failure means the whole address is
  // missing/invalid, and whichever sub-input the user reaches must announce it).
  //
  // Two keys are held back from that spread and land on the group CONTAINER
  // instead (objectui#3961), because they address the field as a WHOLE:
  //
  //  - `id` — the host's control id. It never reached the DOM at all: it was
  //    spread here and then overwritten one line later by `id={subId('street')}`
  //    (objectui#3343), which is why the form's "Shipping Address" label pointed
  //    at an id no element carried. The sub-input ids stay exactly as they are;
  //    only the host id moves out to the element it was always meant to name.
  //  - `aria-labelledby` — the host's label, associated by IDREF. On the street
  //    input it would be actively wrong: `aria-labelledby` OVERRIDES a control's
  //    `<label for>`, so the first sub-input would be announced as "Shipping
  //    Address" and its own "Street Address" label would vanish.
  //
  // Everything else (`aria-describedby`, `name`, focus handlers …) deliberately
  // stays on the first sub-input: a description or error must be announced when
  // focus lands on something focusable, and a container is not.
  const {
    id: _hostId,
    'aria-labelledby': _hostLabelledBy,
    ...domProps
  } = toDomProps(props);
  // The keys held back above, in the one spelling every group-labelled widget
  // uses for them — and computed HERE, before the readonly early return below,
  // because that return used to drop them on the floor: a published label id
  // with no consumer in the document (objectui#3990). See `toHostGroupProps`.
  //
  // TWO surfaces, so two answers, and the difference is only the description
  // (objectui#4005). Readonly this widget collapses to ONE formatted line with
  // no sub-input in it, so that line is the only thing that can carry the help
  // text. The editable container below is a different case: its five sub-inputs
  // each take `aria-describedby` in the `domProps` spread, and the container
  // must NOT take it a second time — objectui#3318's split, pinned in
  // `composite-group-label-e2e.test.tsx`.
  const readonlyHostGroupProps = toHostGroupProps(props, 'instead-of-the-inputs');
  const hostGroupProps = toHostGroupProps(props, 'above-the-inputs');
  // Sub-input ids (objectui#3343): `useId()` prefix + sub-field name — the
  // `groupId` paradigm of RadioField / CheckboxesField. Hardcoded literals
  // ("street", "city", …) collide as soon as a form renders two address
  // fields, and every label's htmlFor then resolves to the FIRST match.
  const groupId = useId();
  const subId = (name: keyof AddressValue) => `${groupId}-${name}`;

  // Sub-labels and the readonly line's part order are the two halves of
  // objectui#4028 — the five boxes were English string literals with no key at
  // all, so a fully translated form showed five English words in the middle of
  // it, and an app had nothing to key a translation bundle on (the parts are
  // not fields on the object). Both hooks are called unconditionally, ABOVE the
  // readonly early return: the readonly branch reads the locale, and a hook
  // that ran only on one branch would desync hook order between the two.
  const { t } = useFieldTranslation();
  const displayLocale = useDisplayLocale();

  // Read through the legacy key, write only the canonical one (objectstack#5143).
  const postalCode = readPostalCode(address);

  const handleFieldChange = (fieldName: keyof AddressValue, fieldValue: string) => {
    // Normalize while we are here: the object we write back never carries
    // `zipCode`, and a legacy postal code is carried forward under
    // `postalCode`. Without the carry, editing an unrelated part of a
    // legacy-shaped address would write the postal code straight back out of
    // the record — the very data loss this fixes, one build later.
    const canonical: LegacyAddressValue = { ...address };
    delete canonical.zipCode;
    onChange({
      ...canonical,
      ...(postalCode ? { postalCode } : null),
      [fieldName]: fieldValue,
    });
  };

  if (readonly) {
    // Readonly the composite collapses to ONE formatted line — no sub-inputs and
    // no sub-labels — so that line is the surface the host label names, the
    // surface its help text describes (objectui#4005: with the sub-inputs gone,
    // the description's IDREF had no consumer left in the document), and
    // `EmptyValue` is the same surface with nothing in it (objectui#3990). The
    // placeholder's own `aria-label` ("No value") is outranked by
    // `aria-labelledby` per accname, and on its `generic` role an author name was
    // never exposed anyway.
    // Part order follows the reader's display locale (objectui#4028): the line
    // used to be US-ordered for everyone, so a Chinese address on a Chinese
    // console read backwards. `formatAddress` owns the rule and the display
    // cell renderer passes the same locale, so the two surfaces cannot drift
    // (the very thing objectui#4037 unified them for).
    const formatted = formatAddress(address, displayLocale);
    return formatted ? (
      <span {...readonlyHostGroupProps} className="text-sm">{formatted}</span>
    ) : (
      <EmptyValue {...readonlyHostGroupProps} />
    );
  }

  return (
    // `role="group"` only when a host actually named this container
    // (objectui#3961): an unnamed group adds nothing for assistive tech, and
    // standalone rendering — the inline grid editor, a bare SDUI node — must stay
    // byte-identical to what it was before. That condition now lives in
    // `toHostGroupProps` so this container and the readonly line above cannot
    // answer differently about the NAME (objectui#3990). They answer differently
    // about exactly one key, by declaration rather than by drift: this container
    // asks for `'above-the-inputs'` and gets no `aria-describedby`, because the
    // sub-inputs below already carry it (objectui#3318 / objectui#4005).
    // The five sub-inputs carry NO placeholder any more (objectui#4028). They
    // used to hold `123 Main St` / `San Francisco` / `CA` / `94102` / `United
    // States` — untranslated AND US-specific, so a zh/ja/ar user was shown an
    // American address as the example of what to type.
    //
    // Dropped rather than keyed, measured against the packs' own precedent:
    //
    //  1. Every example-data placeholder the packs DO carry teaches a FORMAT
    //     its label cannot — `name@example.com` (local@domain), `+1 555 000
    //     0000` (dial prefix), `Icon name (e.g. Users)` (which identifier).
    //     Each box here already has a visible label naming exactly what it
    //     wants, so its example added nothing but a country — and a US postal
    //     code's SHAPE actively misinforms anyone whose own is a different one.
    //  2. The right example is a function of the address's COUNTRY, not the
    //     reader's language. Nothing in the stored value can pick one (this
    //     widget writes no `countryCode`), and keying by UI language would be
    //     wrong for every cross-border address — precisely the CRM case this
    //     was reported from.
    //  3. Keying costs 50 pack entries of invented fictional address fragments,
    //     bound from then on by `check:i18n-drift`, and each Latin-script one
    //     inside zh/ja/ko/ru/ar would need an `untranslated-identity-4376`
    //     allowlist entry — an explicit admission the "translation" is not one.
    <div className="space-y-3" {...hostGroupProps}>
      <div>
        <Label htmlFor={subId('street')} className="text-xs">{t('fields.address.street')}</Label>
        <Input
          {...domProps}
          id={subId('street')}
          type="text"
          value={address.street || ''}
          onChange={(e) => handleFieldChange('street', e.target.value)}
          disabled={readonly || props.disabled}
          className={props.className}
          aria-invalid={!!error}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={subId('city')} className="text-xs">{t('fields.address.city')}</Label>
          <Input
            id={subId('city')}
            type="text"
            value={address.city || ''}
            onChange={(e) => handleFieldChange('city', e.target.value)}
            disabled={readonly || props.disabled}
            aria-invalid={!!error}
          />
        </div>

        <div>
          <Label htmlFor={subId('state')} className="text-xs">{t('fields.address.state')}</Label>
          <Input
            id={subId('state')}
            type="text"
            value={address.state || ''}
            onChange={(e) => handleFieldChange('state', e.target.value)}
            disabled={readonly || props.disabled}
            aria-invalid={!!error}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={subId('postalCode')} className="text-xs">{t('fields.address.postalCode')}</Label>
          <Input
            id={subId('postalCode')}
            type="text"
            value={postalCode || ''}
            onChange={(e) => handleFieldChange('postalCode', e.target.value)}
            disabled={readonly || props.disabled}
            aria-invalid={!!error}
          />
        </div>

        <div>
          <Label htmlFor={subId('country')} className="text-xs">{t('fields.address.country')}</Label>
          <Input
            id={subId('country')}
            type="text"
            value={address.country || ''}
            onChange={(e) => handleFieldChange('country', e.target.value)}
            disabled={readonly || props.disabled}
            aria-invalid={!!error}
          />
        </div>
      </div>
    </div>
  );
}
