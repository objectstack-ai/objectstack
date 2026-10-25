import React, { useId } from 'react';
import { Input, Button, Label, EmptyValue, cn } from '@object-ui/components';
import { MapPin, Crosshair } from 'lucide-react';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { toHostGroupProps } from './toHostGroupProps.js';
import { useBadInputRefusal, BadInputMessage, BAD_INPUT_BORDER } from './numberBadInput.js';

/**
 * Geolocation data structure
 */
export interface GeolocationValue {
  /**
   * `number | null` since objectui#6848. `null` is what an emptied box emits —
   * the spelling `CurrencyField` / `PercentField` / `NumberField` already used
   * for the same user action — so the type has to admit it. `undefined` stays
   * admissible because an untouched coordinate is genuinely absent.
   */
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
}

/**
 * A `GeolocationValue` whose two coordinates are both readable numbers — what
 * {@link hasCoordinates} narrows to, so `formatLocation` can call `.toFixed`
 * without a second null check of its own.
 */
type LocatedGeolocation = GeolocationValue & { latitude: number; longitude: number };

/**
 * Is this numeric slot FILLED? (objectui#8055)
 *
 * ⛔ Deliberately NOT `!n`. Every guard in this widget used to ask the parsed
 * NUMBER whether it was falsy, and `0` is falsy — so `latitude: 0` (the
 * equator), `longitude: 0` (the prime meridian) and `accuracy: 0` were all read
 * as "no value". A record holding a real place displayed as the `EmptyValue`
 * em dash and its "View on map" affordance was withheld from it; the data was
 * intact and unreachable. Presence is a NULLISH question, never a falsy one.
 *
 * ⚠️ The delta this predicate deliberately keeps to EXACTLY `0` and `-0`:
 * `NaN` answers `false` here just as it answered falsy before. A bare
 * `n != null` would have been the card's wording taken literally, and it would
 * have started rendering `"NaN, NaN"` at a surface that has always shown the
 * empty placeholder for an unreadable coordinate — a second display defect
 * wearing the first one's fix. `Infinity` was admitted by the old guard and is
 * still admitted, for the same reason in the other direction: it is not this
 * card's value. Every input other than `0` / `-0` answers exactly as it did
 * before.
 *
 * ⭐ It returns a BOOLEAN, and that is the SECOND defect's fix, not a style
 * choice — see {@link hasCoordinates}.
 */
const isPresentNumber = (n: number | null | undefined): n is number =>
  typeof n === 'number' && !Number.isNaN(n);

/**
 * Does this value carry a coordinate PAIR? Both halves, both readable.
 *
 * ⭐ Boolean-valued on purpose, because three of its call sites are JSX render
 * expressions. The guard used to be written inline as
 * `{location.latitude && location.longitude && (…)}`, and with
 * `location.latitude === 0` that expression EVALUATES TO `0` — which React
 * renders as a text node. The user saw a stray `0` next to the em dash
 * (`"—0"`), the `&&`-with-a-numeric-operand hazard.
 *
 * ⛔ That is a genuinely different defect from the falsy presence test above,
 * and the fix is genuinely different too: making the presence test nullish
 * would still have left a numeric operand in front of `&&`, and making the
 * operand boolean would still have called the equator "no location". A
 * predicate that is nullish AND boolean is what closes both, and the class
 * criterion it answers to is: in this file no "has a value" test whose operand
 * may legitimately be `0` uses falsy semantics, and no JSX conditional carries
 * a numeric operand.
 *
 * ⛔ Not a tolerant fallback (AGENTS.md #0.1): it accepts nothing this widget
 * did not already accept in its `value` contract, it only stops MISREADING a
 * value that contract has always admitted.
 */
const hasCoordinates = (loc: GeolocationValue): loc is LocatedGeolocation =>
  isPresentNumber(loc.latitude) && isPresentNumber(loc.longitude);

/**
 * Geolocation field widget - provides a location picker with coordinates
 * Supports manual entry and browser geolocation API
 */
export function GeolocationField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<GeolocationValue>) {
  const [isLoading, setIsLoading] = React.useState(false);
  /**
   * TWO independent readings, one per sub-input (objectui#6780). A composite
   * cannot share one refusal: `1e` in the latitude box says nothing about the
   * longitude box, and a shared message could not name which half it is about.
   * The example is each coordinate's own, matching `LocationField`'s.
   */
  const lat = useBadInputRefusal('30.2741');
  const lng = useBadInputRefusal('120.1551');
  const location = value || {};
  // DOM pass-through (objectui#3318): the whitelist spread goes onto the FIRST
  // sub-input (latitude); the composite's validation state goes onto BOTH
  // focusable sub-inputs via `aria-invalid={!!error}`.
  //
  // `id` and `aria-labelledby` are held back and land on the group CONTAINER
  // instead (objectui#3961) — they address the whole field, not the latitude box.
  // The host `id` never reached the DOM before: it was overwritten one line later
  // by `id={subId('latitude')}` (objectui#3343), leaving the form's group label
  // pointing at nothing. And `aria-labelledby` on the latitude input would
  // OVERRIDE its own "Latitude" label with the field name. `aria-describedby` and
  // the rest stay on the first sub-input, where focus can reach them.
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
  // (objectui#4005). Readonly this widget collapses to a coordinates row with no
  // lat/lng input in it, so that row is the only thing that can carry the help
  // text — the "View on map" link inside it is focusable but is not an input of
  // the FIELD and never receives the field's `aria-describedby`. The editable
  // container below is a different case: its sub-inputs each take
  // `aria-describedby` in the `domProps` spread and the container must NOT take
  // it a second time — objectui#3318's split.
  const readonlyHostGroupProps = toHostGroupProps(props, 'instead-of-the-inputs');
  const hostGroupProps = toHostGroupProps(props, 'above-the-inputs');
  // Sub-input ids (objectui#3343): `useId()` prefix + sub-field name — the
  // `groupId` paradigm of RadioField / CheckboxesField. Hardcoded literals
  // ("latitude" / "longitude") collide as soon as a form renders two
  // geolocation fields, and every label's htmlFor then resolves to the
  // FIRST match.
  const groupId = useId();
  const subId = (name: keyof GeolocationValue) => `${groupId}-${name}`;

  /**
   * objectui#6780: ask the browser whether it can READ the box before trusting
   * `.value`. Both sub-inputs are `type="number"`, so both can DISPLAY text
   * (`1e`, `-`, `.`) while `.value` reads `''` — measured in Chromium
   * 141.0.7390.37. The emission is deliberately unchanged; see
   * `numberBadInput.tsx`.
   */
  const handleFieldChange = (fieldName: keyof GeolocationValue, fieldValue: string) => {
    onChange({
      ...location,
      // `null`, not `undefined` (objectui#6848). An emptied box is a CLEAR, and
      // `undefined` cannot say so past a serializer: `JSON.stringify` drops the
      // key outright, so the emission stopped describing the user's action the
      // moment it left memory. The other three `type="number"` widgets of this
      // class already emit `null` for the identical action; this was the only
      // one that did not.
      //
      // ⚠️ What this is NOT, measured on this card so the reasoning cannot rot
      // into a bigger claim: it is not silent data loss against the ObjectStack
      // adapter today. That hazard needs the dropped key to be the one the
      // write path merges on, and here it is nested one level DOWN — the
      // payload still carries the composite's own key, `location` is a single
      // JSON column, and nothing on the path deep-merges, so the whole value is
      // replaced and the cleared coordinate does not come back. The defect
      // fixed here is the emission itself: a widget that cannot express "clear"
      // in a form that survives serialization, in a class where its three
      // siblings can.
      [fieldName]: fieldValue ? Number(fieldValue) : null,
    });
  };

  /**
   * The blur arm — this widget had no `onBlur` at all. React delivers no
   * `onChange` when `.value` never leaves `''` (the measured shape of PASTING
   * `1e` into an empty box), and `badInput` is still true at blur time.
   *
   * ⚠️ The latitude box COMPOSES the host's `onBlur`, which `toDomProps`
   * already delivers into `domProps`; a bare handler after that spread would
   * silently drop a declared pass-through key. The longitude box takes no
   * spread (objectui#3318), so it has none to compose.
   */
  const handleLatBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    lat.readBadInput(e.target);
    domProps.onBlur?.(e);
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      console.error('Geolocation is not supported by this browser');
      return;
    }

    setIsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setIsLoading(false);
      },
      (error) => {
        console.error('Error getting location:', error.message);
        setIsLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      }
    );
  };

  const formatLocation = (loc: GeolocationValue): string => {
    if (!hasCoordinates(loc)) return '';
    return `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}`;
  };

  const openInMaps = () => {
    if (!hasCoordinates(location)) return;
    const url = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
    window.open(url, '_blank');
  };

  if (readonly) {
    // Readonly the composite collapses to the formatted coordinates (plus the
    // "View on map" link), so THAT row is the surface the host label names
    // (objectui#3990) and the surface its help text describes (objectui#4005).
    // The `EmptyValue` placeholder sits inside it, so it needs nothing of its
    // own.
    const formatted = formatLocation(location);
    return (
      <div {...readonlyHostGroupProps} className="flex items-center gap-2">
        <MapPin className="w-4 h-4 text-muted-foreground" />
        {formatted ? <span className="text-sm">{formatted}</span> : <EmptyValue />}
        {hasCoordinates(location) && (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={openInMaps}
            className="p-0 h-auto"
          >
            View on map
          </Button>
        )}
      </div>
    );
  }

  return (
    // `role="group"` only when a host actually named this container
    // (objectui#3961); standalone rendering stays exactly as it was. That
    // condition now lives in `toHostGroupProps` so this container and the
    // readonly row above cannot answer differently about the NAME
    // (objectui#3990). They answer differently about exactly one key, by
    // declaration rather than by drift: this container asks for
    // `'above-the-inputs'` and gets no `aria-describedby`, because the
    // sub-inputs below already carry it (objectui#3318 / objectui#4005).
    <div className="space-y-3" {...hostGroupProps}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={getCurrentLocation}
          disabled={readonly || isLoading}
        >
          <Crosshair className="w-4 h-4 mr-2" />
          {isLoading ? 'Getting location...' : 'Use Current Location'}
        </Button>
        {hasCoordinates(location) && (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={openInMaps}
          >
            <MapPin className="w-4 h-4 mr-2" />
            View on map
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={subId('latitude')} className="text-xs">Latitude</Label>
          <Input
            {...domProps}
            id={subId('latitude')}
            type="number"
            value={location.latitude ?? ''}
            onChange={(e) => {
              lat.readBadInput(e.target);
              handleFieldChange('latitude', e.target.value);
            }}
            onBlur={handleLatBlur}
            placeholder="37.7749"
            disabled={readonly || props.disabled}
            step="any"
            className={cn(lat.refusal ? BAD_INPUT_BORDER : '', props.className)}
            // `refusal` is this box's OWN reading; `error` is the composite's
            // published slot and keeps its single author (objectui#3222).
            aria-invalid={!!error || !!lat.refusal}
          />
          <BadInputMessage refusal={lat.refusal} />
        </div>
        
        <div>
          <Label htmlFor={subId('longitude')} className="text-xs">Longitude</Label>
          <Input
            id={subId('longitude')}
            type="number"
            value={location.longitude ?? ''}
            onChange={(e) => {
              lng.readBadInput(e.target);
              handleFieldChange('longitude', e.target.value);
            }}
            onBlur={(e) => lng.readBadInput(e.target)}
            placeholder="-122.4194"
            disabled={readonly || props.disabled}
            step="any"
            className={lng.refusal ? BAD_INPUT_BORDER : undefined}
            aria-invalid={!!error || !!lng.refusal}
          />
          <BadInputMessage refusal={lng.refusal} />
        </div>
      </div>

      {isPresentNumber(location.accuracy) && (
        <p className="text-xs text-muted-foreground">
          Accuracy: ±{location.accuracy.toFixed(0)}m
        </p>
      )}
    </div>
  );
}
