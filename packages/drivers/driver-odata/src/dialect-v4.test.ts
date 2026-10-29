// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { odataV4Dialect, parseCsdlV4 } from './dialect-v4.js';
import { TRIPPIN_METADATA } from './__fixtures__/recorded-service.js';

const NS = 'Microsoft.OData.SampleService.Models.TripPin';

describe('CSDL v4 $metadata reader', () => {
  const model = parseCsdlV4(TRIPPIN_METADATA);

  it('reads entity sets with their qualified entity type, resolving a namespace alias', () => {
    expect([...model.entitySets.keys()]).toEqual(['People', 'Photos', 'Airlines', 'Flights']);
    expect(model.entitySets.get('People')?.entityType).toBe(`${NS}.Person`);
    expect(model.entitySets.get('Flights')?.entityType).toBe(`${NS}.Flight`);
    expect(model.entitySets.get('People')?.navigationBindings).toEqual({ Friends: 'People', BestFriend: 'People', Photo: 'Photos' });
  });

  it('reads keys, property types, nullability and collections', () => {
    const person = model.entityTypes.get(`${NS}.Person`)!;
    expect(person.key).toEqual(['UserName']);
    expect(person.properties.find((p) => p.name === 'UserName')).toEqual({ name: 'UserName', type: 'Edm.String', isCollection: false, nullable: false });
    expect(person.properties.find((p) => p.name === 'MiddleName')?.nullable).toBe(true);
    expect(person.properties.find((p) => p.name === 'Emails')).toEqual({ name: 'Emails', type: 'Edm.String', isCollection: true, nullable: true });
    expect(person.properties.find((p) => p.name === 'Gender')?.type).toBe(`${NS}.PersonGender`);
    expect(model.enumTypes.has(`${NS}.PersonGender`)).toBe(true);
  });

  it('flattens inheritance: the base key and properties first, through an alias and a full name alike', () => {
    const flight = model.entityTypes.get(`${NS}.Flight`)!;
    expect(flight.key).toEqual(['PlanItemId']);
    expect(flight.properties.map((p) => p.name)).toEqual([
      'PlanItemId', 'ConfirmationCode', 'StartsAt', 'EndsAt', 'Duration', 'SeatNumber',
      'FlightNumber', 'TripDate', 'TrackingId', 'Fare', 'Cancelled',
    ]);
  });

  it('reads navigation properties with their target, cardinality and referential constraints', () => {
    const person = model.entityTypes.get(`${NS}.Person`)!;
    expect(person.navigationProperties.map((n) => [n.name, n.type, n.isCollection])).toEqual([
      ['Friends', `${NS}.Person`, true],
      ['BestFriend', `${NS}.Person`, false],
      ['Photo', `${NS}.Photo`, false],
    ]);
    const airline = model.entityTypes.get(`${NS}.Flight`)!.navigationProperties[0]!;
    expect(airline).toEqual({
      name: 'Airline', type: `${NS}.Airline`, isCollection: false, nullable: false,
      referentialConstraints: [{ property: 'AirlineCode', referencedProperty: 'AirlineCode' }],
    });
  });

  it('refuses a v2 (EDMX 1.0) document by name, since this package ships the v4 dialect only', () => {
    const v2 = '<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"><edmx:DataServices/></edmx:Edmx>';
    expect(() => parseCsdlV4(v2)).toThrow(/not CSDL 4\.x .*Version="1\.0".*v4 dialect only/);
  });

  it('refuses a document that is not XML', () => {
    expect(() => parseCsdlV4('{"value":[]}')).toThrow(/not CSDL 4\.x/);
  });
});

describe('OData v4 envelope', () => {
  it('reads value, nextLink and count', () => {
    expect(odataV4Dialect.readCollection({ value: [{ a: 1 }], '@odata.nextLink': 'People?$skiptoken=2', '@odata.count': 7 }))
      .toEqual({ rows: [{ a: 1 }], nextLink: 'People?$skiptoken=2', count: 7 });
  });

  it('refuses a body that is not a collection', () => {
    expect(() => odataV4Dialect.readCollection({ d: { results: [] } })).toThrow(/without a `value` array/);
  });

  it('reads the error body', () => {
    expect(odataV4Dialect.readError({ error: { code: 'BadRequest', message: 'Bad filter' } }))
      .toEqual({ code: 'BadRequest', message: 'Bad filter' });
    expect(odataV4Dialect.readError('<html>')).toEqual({});
  });

  it('spells set membership as an or-chain, which 4.0 services answer (4.01 added `in`)', () => {
    expect(odataV4Dialect.inList('A', ['1', '2'])).toBe('(A eq 1 or A eq 2)');
  });
});
