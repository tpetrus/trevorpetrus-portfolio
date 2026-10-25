import { describe, expect, it } from 'vitest';

import { locationKeys } from './exifLocation';

describe('locationKeys', () => {
    it('finds the GPS IFD tags and the derived coordinates, whatever their case', () => {
        expect(
            locationKeys({
                GPSLatitudeRef: 'N',
                GPSLatitude: [51, 30, 0],
                gpsLongitude: [0, 7, 0],
                latitude: 51.5,
                Longitude: -0.12,
                Model: 'X100V',
            }),
        ).toEqual(['GPSLatitudeRef', 'GPSLatitude', 'gpsLongitude', 'latitude', 'Longitude']);
    });

    it('is empty for metadata without location', () => {
        expect(locationKeys({ Make: 'Canon', Model: 'Canon EOS R5', ISO: 400 })).toEqual([]);
    });

    it('does not mistake a key that merely contains "latitude" or "gps" for a location', () => {
        expect(locationKeys({ Exposure: 1, gearGPS: 1, latitudeNote: 'x' })).toEqual([]);
    });

    it('is empty when there is no metadata at all', () => {
        expect(locationKeys(undefined)).toEqual([]);
        expect(locationKeys({})).toEqual([]);
    });
});
