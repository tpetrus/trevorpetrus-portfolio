import type { PlaceNames } from './location';

// Offline reverse geocoding against the GeoNames `cities1000` extract (https://download.geonames.org/export/dump/,
// CC BY 4.0). The coordinates of a photo only ever meet this data on the machine running the sync; nothing here
// touches the network, and nothing returned carries a coordinate.

/**
 * The farthest a photo may be from the nearest known place and still be named after it. cities1000 lists every
 * settlement over 1,000 people, so within 25 km of a photo there is nearly always one in inhabited country, and a
 * place that close is still "where the photo was taken" at the level of detail a caption shows. Beyond it (open sea,
 * wilderness) the nearest name would mislead, so the location is left out and the sync suggests a sidecar override.
 */
export const MAX_PLACE_DISTANCE_KM = 25;

const EARTH_RADIUS_KM = 6371;
// GeoNames feature code for a "section of populated place": a neighborhood or district. Skipped, or a photo in the
// middle of Lisbon would be captioned with one of its districts instead of "Lisbon".
const SECTION_OF_PLACE = 'PPLX';

export interface Place {
    name: string;
    latitude: number;
    longitude: number;
    /** ISO 3166-1 alpha-2, e.g. `PT`. */
    countryCode: string;
}

export interface Point {
    latitude: number;
    longitude: number;
}

// Column positions in the GeoNames `geoname` table (tab-separated).
const COLUMN = { name: 1, latitude: 4, longitude: 5, featureCode: 7, countryCode: 8 } as const;
const MIN_COLUMNS = COLUMN.countryCode + 1;

/** Parses `cities1000.txt` into the places that can name a photo. Throws on a line that is not a `geoname` row. */
export function parseGeonamesCities(text: string): Place[] {
    const places: Place[] = [];
    for (const [index, line] of text.split('\n').entries()) {
        if (line === '') continue;
        const columns = line.split('\t');
        const latitude = Number(columns[COLUMN.latitude]);
        const longitude = Number(columns[COLUMN.longitude]);
        const countryCode = columns[COLUMN.countryCode];
        if (
            columns.length < MIN_COLUMNS ||
            columns[COLUMN.name] === '' ||
            columns[COLUMN.latitude] === '' ||
            columns[COLUMN.longitude] === '' ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !/^[A-Z]{2}$/.test(countryCode)
        ) {
            throw new Error(`GeoNames line ${index + 1} is not a city row.`);
        }
        if (columns[COLUMN.featureCode] !== SECTION_OF_PLACE) {
            places.push({ name: columns[COLUMN.name], latitude, longitude, countryCode });
        }
    }
    return places;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in kilometers (haversine). */
export function haversineKm(a: Point, b: Point): number {
    const dLatitude = toRadians(b.latitude - a.latitude);
    const dLongitude = toRadians(b.longitude - a.longitude);
    const h =
        Math.sin(dLatitude / 2) ** 2 +
        Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLongitude / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

/**
 * The closest place to `point`, or `undefined` for an empty list. A linear scan: the manual sync runs it once per
 * photo over about 170,000 rows, which takes milliseconds, so an index would only add code.
 */
export function nearestPlace(places: readonly Place[], point: Point): { place: Place; distanceKm: number } | undefined {
    let best: { place: Place; distanceKm: number } | undefined;
    for (const place of places) {
        const distanceKm = haversineKm(point, place);
        if (best === undefined || distanceKm < best.distanceKm) best = { place, distanceKm };
    }
    return best;
}

/**
 * What exifr's `gps()` returned, as a usable point: `undefined` when the photo has no location, the camera wrote
 * garbage, or it wrote (0, 0), which is what cameras without a fix record (open ocean off West Africa).
 */
export function gpsPoint(gps: { latitude?: unknown; longitude?: unknown } | undefined): Point | undefined {
    const latitude = gps?.latitude;
    const longitude = gps?.longitude;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return undefined;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
    return latitude === 0 && longitude === 0 ? undefined : { latitude, longitude };
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
// ICU answers the unassigned code ZZ with "Unknown Region" instead of nothing.
const UNKNOWN_REGION = regionNames.of('ZZ');

/** The English country name for an ISO 3166-1 alpha-2 code, or `undefined` when ICU does not know the code. */
export function countryName(code: string): string | undefined {
    let name: string | undefined;
    try {
        name = regionNames.of(code);
    } catch {
        return undefined;
    }
    return name === UNKNOWN_REGION ? undefined : name;
}

export interface DerivedPlace {
    place: PlaceNames | undefined;
    /** Why there is no place, when that deserves the user's attention. Never contains a coordinate. */
    warning: string | undefined;
}

/** Names the nearest place to `point`, or says why it cannot (too far from any place, or a country ICU lacks). */
export function derivePlace(point: Point, places: readonly Place[]): DerivedPlace {
    const nearest = nearestPlace(places, point);
    if (nearest === undefined || nearest.distanceKm > MAX_PLACE_DISTANCE_KM) {
        const distance =
            nearest === undefined ? '' : `; the nearest known place is ${Math.round(nearest.distanceKm)} km away`;
        return {
            place: undefined,
            warning: `no place within ${MAX_PLACE_DISTANCE_KM} km${distance}. Add a "location" to its sidecar to name one.`,
        };
    }
    const country = countryName(nearest.place.countryCode);
    if (country === undefined) {
        return {
            place: undefined,
            warning: `GeoNames gives the unknown country code "${nearest.place.countryCode}". Add a "location" to its sidecar.`,
        };
    }
    return { place: { city: nearest.place.name, country }, warning: undefined };
}
