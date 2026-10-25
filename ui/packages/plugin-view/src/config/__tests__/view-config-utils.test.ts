/**
 * Tests for field-role detection helpers used by CreateViewDialog.
 */

import { describe, it, expect } from 'vitest';
import {
  isImageLikeField,
  isGeoLikeField,
  pickPreferredField,
  deriveFieldOptions,
} from '../view-config-utils';

describe('isImageLikeField', () => {
  it('matches by raw type', () => {
    expect(isImageLikeField({ type: 'image', name: 'foo' })).toBe(true);
    expect(isImageLikeField({ type: 'attachment', name: 'foo' })).toBe(true);
    expect(isImageLikeField({ type: 'file', name: 'foo' })).toBe(true);
    expect(isImageLikeField({ type: 'url', name: 'foo' })).toBe(true);
  });

  it('matches by name conventions', () => {
    expect(isImageLikeField({ type: 'text', name: 'avatar_url' })).toBe(true);
    expect(isImageLikeField({ type: 'text', name: 'cover_photo' })).toBe(true);
    expect(isImageLikeField({ type: 'text', name: 'company_logo' })).toBe(true);
    expect(isImageLikeField({ type: 'text', name: 'thumbnail' })).toBe(true);
  });

  it('rejects plain text fields', () => {
    expect(isImageLikeField({ type: 'text', name: 'first_name' })).toBe(false);
    expect(isImageLikeField({ type: 'text', name: 'company' })).toBe(false);
    expect(isImageLikeField({ type: 'select', name: 'status' })).toBe(false);
  });

  it('handles FieldOption shape (rawType/rawName/value)', () => {
    expect(isImageLikeField({ rawType: 'image', value: 'pic' })).toBe(true);
    expect(isImageLikeField({ rawType: 'text', rawName: 'avatar', value: 'avatar' })).toBe(true);
    expect(isImageLikeField({ rawType: 'text', rawName: 'name', value: 'name' })).toBe(false);
  });

  it('handles null/undefined safely', () => {
    expect(isImageLikeField(null)).toBe(false);
    expect(isImageLikeField(undefined)).toBe(false);
    expect(isImageLikeField({})).toBe(false);
  });
});

describe('isGeoLikeField', () => {
  it('matches dedicated geo types for both axes', () => {
    expect(isGeoLikeField({ type: 'geolocation', name: 'loc' }, 'latitude')).toBe(true);
    expect(isGeoLikeField({ type: 'geolocation', name: 'loc' }, 'longitude')).toBe(true);
    expect(isGeoLikeField({ type: 'geo_point', name: 'loc' }, 'latitude')).toBe(true);
  });

  it('matches latitude by name', () => {
    expect(isGeoLikeField({ type: 'number', name: 'lat' }, 'latitude')).toBe(true);
    expect(isGeoLikeField({ type: 'number', name: 'latitude' }, 'latitude')).toBe(true);
    expect(isGeoLikeField({ type: 'number', name: 'office_lat' }, 'latitude')).toBe(true);
    expect(isGeoLikeField({ type: 'number', name: 'lat_coord' }, 'latitude')).toBe(true);
  });

  it('matches longitude by name', () => {
    expect(isGeoLikeField({ type: 'number', name: 'lng' }, 'longitude')).toBe(true);
    expect(isGeoLikeField({ type: 'number', name: 'lon' }, 'longitude')).toBe(true);
    expect(isGeoLikeField({ type: 'number', name: 'longitude' }, 'longitude')).toBe(true);
    expect(isGeoLikeField({ type: 'number', name: 'office_lng' }, 'longitude')).toBe(true);
  });

  it('rejects non-geo numeric fields', () => {
    expect(isGeoLikeField({ type: 'number', name: 'lead_score' }, 'latitude')).toBe(false);
    expect(isGeoLikeField({ type: 'number', name: 'annual_revenue' }, 'longitude')).toBe(false);
    expect(isGeoLikeField({ type: 'number', name: 'employees' }, 'latitude')).toBe(false);
  });

  it('does not cross axes (lat name ≠ lng axis)', () => {
    expect(isGeoLikeField({ type: 'number', name: 'lat' }, 'longitude')).toBe(false);
    expect(isGeoLikeField({ type: 'number', name: 'lng' }, 'latitude')).toBe(false);
  });

  it('handles FieldOption shape', () => {
    expect(isGeoLikeField({ rawType: 'number', rawName: 'lat', value: 'lat' }, 'latitude')).toBe(true);
    expect(isGeoLikeField({ rawType: 'number', rawName: 'score', value: 'score' }, 'latitude')).toBe(false);
  });

  it('handles null/undefined safely', () => {
    expect(isGeoLikeField(null, 'latitude')).toBe(false);
    expect(isGeoLikeField(undefined, 'longitude')).toBe(false);
  });
});

describe('pickPreferredField', () => {
  const opts = [
    { value: 'first_name', label: 'First Name' },
    { value: 'status', label: 'Status' },
    { value: 'priority', label: 'Priority' },
    { value: 'industry', label: 'Industry' },
  ];

  it('picks the first preferred match', () => {
    expect(pickPreferredField(opts, ['status', 'stage'])).toBe('status');
  });

  it('respects preferred order (status > priority)', () => {
    expect(pickPreferredField(opts, ['priority', 'status'])).toBe('priority');
  });

  it('falls back to first option when no preferred match', () => {
    expect(pickPreferredField(opts, ['xyz', 'abc'])).toBe('first_name');
  });

  it('returns undefined for empty options', () => {
    expect(pickPreferredField([], ['status'])).toBeUndefined();
  });

  it('matches via substring', () => {
    expect(pickPreferredField(opts, ['name'])).toBe('first_name');
  });
});

describe('deriveFieldOptions carries rawType/rawName', () => {
  it('exposes raw type for downstream predicates', () => {
    const opts = deriveFieldOptions({
      fields: {
        photo: { type: 'image', label: 'Photo' },
        score: { type: 'number', label: 'Score' },
      },
    });
    const photo = opts.find((o) => o.value === 'photo');
    expect(photo?.rawType).toBe('image');
    expect(photo?.rawName).toBe('photo');
    expect(isImageLikeField(photo!)).toBe(true);
  });
});
