import React from 'react';
import { Input, EmptyValue, cn } from '@object-ui/components';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useLocalization, useDisplayLocale } from '@object-ui/i18n';
import { resolveFieldCurrency, currencySymbol } from '../currency.js';
import { useBadInputRefusal, BadInputMessage, BAD_INPUT_BORDER } from './numberBadInput.js';
import { formatCurrency, currencyDisplayWidth } from './number-format.js';

export function CurrencyField({ value, onChange, field, readonly, error, className, ...props }: FieldWidgetComponentProps<number>) {
  const currencyField = field as any;
  // Shared precedence: field currency → currencyConfig → tenant default (ADR-0053).
  const { currency: tenantCurrency } = useLocalization();
  const locale = useDisplayLocale();
  const currency: string | undefined = resolveFieldCurrency(currencyField, tenantCurrency);
  // A currency's decimal places are the CURRENCY's, not a field setting — the
  // maintainer ruling recorded on objectstack-ai/objectstack#19910 (batch #218
  // item 2), executed here by objectui#10276. The width is the ISO 4217
  // minor-unit count of the resolved currency: 2 for USD / CNY, 0 for JPY,
  // 3 for KWD. With no currency resolved there is no minor unit to ask about,
  // so the historical 2 stays. `currencyDisplayWidth` is that derivation, and
  // `formatCurrency` (the grid cell's formatter, and this widget's read-only
  // face below) reads the same function, so the width an amount is shown at
  // and the width it is edited at cannot part (objectui#11444).
  //
  // ⛔ NOT the field-level `precision`. `@objectstack/spec` declares it as
  // "Total digits (non-negative integer)" — the `p` of a decimal(p, s) column,
  // so a DECIMAL(18,2) amount is `precision: 18, scale: 2`. This widget used
  // to pass it straight to both `Intl` bounds (objectui#4361's "authored
  // `precision` wins"), which rendered a `precision: 18` amount with eighteen
  // decimal places; the ruling names that reading as wrong.
  //
  // ⛔ NOT `scale` either: the ruling on objectstack-ai/objectstack#19629
  // (letter B) takes `scale` off the `currency` type — refused at parse once
  // the spec ships it — and `CurrencyFieldMetadata` in `@object-ui/types`
  // does not declare it. Nor `currencyConfig.precision`, which the
  // objectstack#19910 ruling records as read by nothing and which this widget
  // has never read.
  //
  // This is the widget's ONE width, so the derivation also reaches the edit
  // affordances below. Deliberate: leaving `step`/blur-rounding at 2 would give
  // a JPY field that displays whole yen while offering a 0.01 spinner step and
  // rounding typed input to 1234.56 yen.
  const fractionDigits = currencyDisplayWidth(currency);

  // Before the readonly return: hooks are unconditional (objectui#6780).
  const { refusal, readBadInput } = useBadInputRefusal('1234.56');

  if (readonly) {
    if (value == null) return <EmptyValue />;
    // The call `CurrencyCellRenderer` makes, so a read-only form and a table
    // cell show one amount identically (objectui#11444). This used to be a
    // private `formatAmount` beside the cell's `formatCurrency`; the two drew
    // apart on a whole amount (`$3,456.00` here, `$3,456` in the cell) until
    // triage ruled the declared width the protocol's convention and the cell's
    // whole-amount trimming retired.
    return (
      <span className="text-sm font-medium tabular-nums">
        {formatCurrency(Number(value), currency, locale)}
      </span>
    );
  }

  /**
   * ⚠️ What `e.target.value` can actually hold here — MEASURED in a real
   * browser, not inferred from the spec (objectui#6765).
   *
   * Both edit paths below read the box with a bare `parseFloat` and no
   * whole-string guard of their own. That is deliberate, and it is NOT the
   * objectui#6715 defect wearing a different hat. This is a `type="number"`
   * input, and a real browser never exposes non-numeric residue through
   * `.value`: keystrokes and pastes are filtered before the change event, and
   * the HTML value-sanitization algorithm keeps the value either wholly a
   * valid floating-point number or the empty string.
   *
   * Measured on Chromium 141.0.7390.37 (Playwright 1.62.1), driving THIS
   * widget through the routes a user actually has:
   *
   * ```
   * typed  "12abc" -> box.value "12"    onChange(12)
   * pasted "12abc" -> box.value "12"    onChange(12)
   * typed  "1.2.3" -> box.value "1.23"  onChange(1.23)
   * pasted "0x10"  -> box.value "010"   onChange(10)
   * typed  "1e"    -> box.value ""      onChange(null)   validity.badInput
   * ```
   *
   * ⛔ So objectui#6715's anchored `WHOLE_NUMBER_TEXT` is deliberately NOT
   * copied here. It would accept every string this box can produce and reject
   * only strings the TEST environment fabricates — happy-dom does not
   * implement the sanitization (`input.value = '12abc'` stays `'12abc'`), so a
   * unit test that fires a `change` carrying residue drives a path no browser
   * takes. Adding the guard would buy nothing in the product and would pin a
   * truncation no user reaches. The oracle-vs-product table is pinned in
   * `__tests__/NumberInputWidgets.environmentDivergence.test.tsx`.
   *
   * ⭐ CLOSED for the last row (objectui#6780, ruled 2026-08-29): the silent
   * drop is now ANNOUNCED, through `validity.badInput` — the platform's own
   * predicate — across all four `type="number"` widgets of this package as one
   * change. See `numberBadInput.tsx` for the measurement and for why the
   * emission itself is deliberately unchanged.
   *
   * ⛔ STILL SILENT, and deliberately so: the TRUNCATING rows above. `1.2.3`
   * stores `1.23` and `0x10` stores `10`, and no widget-side guard can refuse
   * them — the browser filtered the keystrokes before `handleChange` ran, so
   * the information is gone before any code here can see it. Only abandoning
   * `type="number"` would recover it, which the same ruling declined (it would
   * reverse objectui#2572's min/max/step and mobile-keyboard affordances).
   * ⚠️ This asymmetry is documented for USERS, not just here — a control that
   * warns about `1e` but silently truncates `1.2.3` teaches people that no
   * warning means the value is right. See `content/docs/guide/fields.md`.
   */
  const domProps = toDomProps(props);

  // Parse and format on blur to ensure valid currency format
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // objectui#6780: the blur arm. React delivers no `onChange` when `.value`
    // never leaves `''` — the measured shape of PASTING `1e` into an empty box
    // — and `badInput` is still true at blur time, so this is the only arm that
    // sees that route.
    //
    // ⚠️ COMPOSES the host's `onBlur` rather than replacing it (objectui#6802).
    // `onBlur` is a declared DOM pass-through key (`FieldWidgetDomProps`,
    // `SDUI_DOM_PASS_THROUGH_KEYS`) that `toDomProps` already delivers here, so
    // the bare handler this used to be — written AFTER the spread — silently
    // dropped it: this package's DECLARED-BUT-NOT-DELIVERED class
    // (objectui#3290 / objectui#3222).
    //
    // ⛔ NOT the no-op the card assumed. objectui#6802 was filed on the reading
    // that "no host in this repo passes `onBlur` to a field widget"; that is
    // FALSE. The form renderer hosts every field through react-hook-form's
    // `Controller` and spreads the controller field — `{ name, value, onChange,
    // onBlur, ref, disabled }` — into the widget's props
    // (`components/src/renderers/form/form.tsx`). That `onBlur` is what marks
    // the field touched and, under an authored `validationMode: 'onBlur'` /
    // `'onTouched'`, runs its validation. Overriding it opted currency fields
    // out of blur-mode validation while every sibling field kept it. The
    // reproduction through the real renderer is
    // `__tests__/hostOnBlurDelivery-e2e.test.tsx`.
    readBadInput(e.target);
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      onChange(parseFloat(val.toFixed(fractionDigits)));
    }
    // Last: the widget's own rounding emission lands before the host is told
    // the field was touched, so a blur-mode validator reads the parsed value
    // rather than the raw one.
    domProps.onBlur?.(e);
  };

  // ONE channel for the symbol (objectui#4414). This used to be a hand-written
  // `currency === 'USD' ? '$' : currency` ternary, with a dead one-entry
  // `CURRENCY_SYMBOLS` map sitting two lines above it restating the same fact —
  // a table that looked like the place to add a currency but that nothing read.
  // Both were hand copies of knowledge `Intl` already carries, and both are
  // gone: `currencySymbol` reads the `currency` part of the SAME format the
  // readonly branch above renders amounts with, so the two modes of this widget
  // can no longer disagree (they did: `JPY` in the adornment, `¥1,235` in the
  // readonly span). USD at the display-locale default is `$` either way.
  const symbol = currency ? currencySymbol(currency, locale) : '';

  return (
    <div className="space-y-1">
      <div className="relative">
        {symbol && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
            {symbol}
          </span>
        )}
        <Input
          {...domProps}
          type="number"
          value={value ?? ''}
          onChange={(e) => {
            // Bare `parseFloat`, deliberately — see the measured note on
            // `handleBlur` above (objectui#6765). The empty string is the
            // browser's ONLY refusal channel on a number input, and it is also
            // how it reports text it is still displaying but cannot read — which
            // is why objectui#6780 asks the browser directly instead, and why the
            // emission below is unchanged by that reading.
            readBadInput(e.target);
            const val = e.target.value === '' ? null : parseFloat(e.target.value);
            onChange(val as any);
          }}
          onBlur={handleBlur}
          placeholder={currencyField?.placeholder || '0.00'}
          disabled={readonly || props.disabled}
          className={cn(symbol ? 'pl-8' : '', refusal ? BAD_INPUT_BORDER : '', className)}
          // Surface the field's declared range (e.g. `min: 0` on a budget) so the
          // browser's spinner/keyboard affordances respect it (objectui#2572);
          // server-side validation still owns enforcement.
          min={typeof currencyField?.min === 'number' ? currencyField.min : undefined}
          max={typeof currencyField?.max === 'number' ? currencyField.max : undefined}
          step={Math.pow(10, -fractionDigits).toFixed(fractionDigits)}
          // `refusal` is this widget's OWN reading and no host can produce it;
          // `error` keeps its single author (objectui#3222 / objectui#6716).
          aria-invalid={!!error || !!refusal}
        />
      </div>
      <BadInputMessage refusal={refusal} />
    </div>
  );
}
