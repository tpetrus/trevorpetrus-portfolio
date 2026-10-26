import { z } from 'astro/zod';

// Strict, so that a coordinate (or anything else) added to the data file by mistake or by a later change fails the
// build instead of being published. The site only ever stores where a photo was taken as a city and a country.
const placeNames = {
    city: z.string().trim().min(1),
    country: z.string().trim().min(1),
};

/** Who decided the place: `geonames` is derived from the photo's GPS, `sidecar` is the hand-written override. */
export const LOCATION_SOURCES = ['geonames', 'sidecar'] as const;

/** What `src/data/gallery/<collection>.json` stores per photo. Never coordinates. */
export const locationSchema = z.strictObject({ ...placeNames, source: z.enum(LOCATION_SOURCES) });
export type PhotoLocation = z.output<typeof locationSchema>;

/** The sidecar's `location`: a place that replaces the derived one, or `false` to show none. Absent means derive. */
export const sidecarLocationSchema = z.union([z.literal(false), z.strictObject(placeNames)]);
export type SidecarLocation = z.output<typeof sidecarLocationSchema>;

export interface PlaceNames {
    city: string;
    country: string;
}

/**
 * The location an entry gets: the sidecar wins when it says anything (a place, or `false` for none); otherwise the
 * place derived from the photo's GPS, if there was one.
 */
export function resolveLocation(
    derived: PlaceNames | undefined,
    override: SidecarLocation | undefined,
): PhotoLocation | undefined {
    if (override === false) return undefined;
    if (override !== undefined) return { city: override.city, country: override.country, source: 'sidecar' };
    return derived === undefined ? undefined : { city: derived.city, country: derived.country, source: 'geonames' };
}

/** The caption text for a place: `Lisbon, Portugal`. */
export function formatLocation({ city, country }: PlaceNames): string {
    return `${city}, ${country}`;
}

/** A copy of `caption` that carries `location`, or none when `location` is undefined (a stale place is removed). */
export function captionWithLocation<Caption extends { location?: PhotoLocation | undefined }>(
    caption: Caption,
    location: PhotoLocation | undefined,
): Caption {
    const { location: _stale, ...rest } = caption;
    return (location === undefined ? rest : { ...rest, location }) as Caption;
}

/** Whether any entry shows a place derived from GeoNames, which is when the page must credit it (CC BY 4.0). */
export function showsGeonamesPlace(entries: readonly { caption: { location?: PhotoLocation | undefined } }[]): boolean {
    return entries.some(({ caption }) => caption.location?.source === 'geonames');
}
