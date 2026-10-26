import { describe, expect, it } from 'vitest';

import {
    countryName,
    derivePlace,
    gpsPoint,
    haversineKm,
    MAX_PLACE_DISTANCE_KM,
    nearestPlace,
    parseGeonamesCities,
    type Place,
} from './geonames';

const LISBON_POINT = { latitude: 38.7223, longitude: -9.1393 };

// geonameid, name, asciiname, alternatenames, latitude, longitude, feature class, feature code, country code, ...
function row(name: string, latitude: string, longitude: string, featureCode: string, countryCode: string): string {
    return ['1', name, name, '', latitude, longitude, 'P', featureCode, countryCode, '', '', '', '', '', '1000'].join(
        '\t',
    );
}

const LISBON: Place = { name: 'Lisbon', latitude: 38.71667, longitude: -9.13333, countryCode: 'PT' };
const PORTO: Place = { name: 'Porto', latitude: 41.14961, longitude: -8.61099, countryCode: 'PT' };

describe('parseGeonamesCities', () => {
    it('reads the name, position and country of each row', () => {
        const text = [
            row('Lisbon', '38.71667', '-9.13333', 'PPLC', 'PT'),
            row('Porto', '41.14961', '-8.61099', 'PPLA', 'PT'),
        ];
        expect(parseGeonamesCities(`${text.join('\n')}\n`)).toEqual([LISBON, PORTO]);
    });

    it('skips sections of a populated place, such as districts', () => {
        const text = [
            row('Intendente', '38.7218', '-9.1359', 'PPLX', 'PT'),
            row('Lisbon', '38.71667', '-9.13333', 'PPLC', 'PT'),
        ];
        expect(parseGeonamesCities(text.join('\n'))).toEqual([LISBON]);
    });

    it('accepts an empty file', () => {
        expect(parseGeonamesCities('')).toEqual([]);
    });

    it.each([
        ['too few columns', 'a\tb\tc'],
        ['an empty name', row('', '1', '2', 'PPL', 'PT')],
        ['an empty latitude', row('A', '', '2', 'PPL', 'PT')],
        ['an empty longitude', row('A', '1', '', 'PPL', 'PT')],
        ['a latitude that is not a number', row('A', 'north', '2', 'PPL', 'PT')],
        ['a longitude that is not a number', row('A', '1', 'east', 'PPL', 'PT')],
        ['a country code that is not two capitals', row('A', '1', '2', 'PPL', 'Portugal')],
    ])('throws, naming the line, for %s', (_label, bad) => {
        expect(() => parseGeonamesCities(`${row('Fine', '1', '2', 'PPL', 'PT')}\n${bad}\n`)).toThrow(
            /GeoNames line 2 is not a city row/,
        );
    });
});

describe('haversineKm', () => {
    it('is zero for the same point', () => {
        expect(haversineKm(LISBON_POINT, LISBON_POINT)).toBe(0);
    });

    it('matches a known distance (Lisbon to Porto is about 274 km)', () => {
        expect(haversineKm(LISBON, PORTO)).toBeGreaterThan(270);
        expect(haversineKm(LISBON, PORTO)).toBeLessThan(278);
    });

    it('is symmetric and handles the antimeridian and the poles', () => {
        const a = { latitude: 10, longitude: 179.5 };
        const b = { latitude: 10, longitude: -179.5 };
        expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
        expect(haversineKm(a, b)).toBeLessThan(120);
        expect(haversineKm({ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 0 })).toBeCloseTo(20015, -1);
    });
});

describe('nearestPlace', () => {
    it('returns the closest place and its distance', () => {
        const result = nearestPlace([PORTO, LISBON], LISBON_POINT);
        expect(result?.place).toBe(LISBON);
        expect(result?.distanceKm).toBeLessThan(1);
    });

    it('keeps the closer place when a farther one comes later in the list', () => {
        expect(nearestPlace([LISBON, PORTO], LISBON_POINT)?.place).toBe(LISBON);
    });

    it('returns undefined for no places', () => {
        expect(nearestPlace([], LISBON_POINT)).toBeUndefined();
    });
});

describe('gpsPoint', () => {
    it('returns a usable fix', () => {
        expect(gpsPoint({ latitude: 38.7, longitude: -9.1 })).toEqual({ latitude: 38.7, longitude: -9.1 });
        expect(gpsPoint({ latitude: 0, longitude: 12 })).toEqual({ latitude: 0, longitude: 12 });
        expect(gpsPoint({ latitude: -90, longitude: 180 })).toEqual({ latitude: -90, longitude: 180 });
    });

    it('treats (0, 0) as no fix', () => {
        expect(gpsPoint({ latitude: 0, longitude: 0 })).toBeUndefined();
    });

    it.each([
        ['no GPS', undefined],
        ['an empty result', {}],
        ['only a latitude', { latitude: 1 }],
        ['only a longitude', { longitude: 1 }],
        ['strings', { latitude: '38.7', longitude: '-9.1' }],
        ['NaN', { latitude: Number.NaN, longitude: 1 }],
        ['infinity', { latitude: 1, longitude: Number.POSITIVE_INFINITY }],
        ['a latitude out of range', { latitude: 91, longitude: 0 }],
        ['a longitude out of range', { latitude: 0, longitude: -181 }],
    ])('rejects %s', (_label, gps) => {
        expect(gpsPoint(gps)).toBeUndefined();
    });
});

describe('countryName', () => {
    it('gives the English name', () => {
        expect(countryName('PT')).toBe('Portugal');
        expect(countryName('US')).toBe('United States');
    });

    it('is undefined for the unassigned code, a code ICU does not have and a malformed code', () => {
        expect(countryName('ZZ')).toBeUndefined();
        expect(countryName('QQ')).toBeUndefined();
        expect(countryName('not a code')).toBeUndefined();
    });
});

describe('derivePlace', () => {
    it('names the nearest place and its country', () => {
        expect(derivePlace(LISBON_POINT, [PORTO, LISBON])).toEqual({
            place: { city: 'Lisbon', country: 'Portugal' },
            warning: undefined,
        });
    });

    it('names a place just inside the threshold and omits one just beyond it', () => {
        // One degree of latitude is about 111.19 km, so these places sit half a kilometer either side of 25 km.
        const origin = { latitude: 10, longitude: 20 };
        const at = (km: number): Place => ({
            name: 'Edge',
            latitude: origin.latitude + km / 111.1949,
            longitude: origin.longitude,
            countryCode: 'PT',
        });
        expect(derivePlace(origin, [at(MAX_PLACE_DISTANCE_KM - 0.5)]).place).toEqual({
            city: 'Edge',
            country: 'Portugal',
        });
        const beyond = derivePlace(origin, [at(MAX_PLACE_DISTANCE_KM + 0.5)]);
        expect(beyond.place).toBeUndefined();
        expect(beyond.warning).toMatch(/no place within 25 km; the nearest known place is 26 km away.*sidecar/);
    });

    it('omits the place and warns when there are no places at all', () => {
        const result = derivePlace(LISBON_POINT, []);
        expect(result.place).toBeUndefined();
        expect(result.warning).toMatch(/^no place within 25 km\. Add a "location"/);
    });

    it('never puts a coordinate in a warning', () => {
        const { warning } = derivePlace({ latitude: 12.3456, longitude: 65.4321 }, [LISBON]);
        expect(warning).not.toMatch(/12\.3456|65\.4321/);
    });

    it('omits the place and warns for a country code ICU does not know', () => {
        const result = derivePlace(LISBON_POINT, [{ ...LISBON, countryCode: 'ZZ' }]);
        expect(result.place).toBeUndefined();
        expect(result.warning).toMatch(/unknown country code "ZZ".*sidecar/);
    });
});
