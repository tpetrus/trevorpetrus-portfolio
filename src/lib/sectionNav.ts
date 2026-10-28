// Pure decisions for the Photography page's section navigation (the back-to-top links and the floating legend). The DOM
// glue in src/scripts/sectionNav.ts measures the page and calls these, so the rules can be unit-tested in node.

/** A section's id and where its top edge is relative to the viewport (negative once scrolled above it). */
export interface SectionPosition {
    id: string;
    top: number;
}

/** The share of the viewport height, from the top, at which a section counts as "being read". */
export const READING_LINE_RATIO = 0.4;

/** The reading line in viewport pixels: a section whose top has passed it is the one the visitor is in. */
export function readingLine(viewportHeight: number): number {
    return viewportHeight * READING_LINE_RATIO;
}

/**
 * The section being read: the last one whose top is at or above the line. Sections must be in page order. Above the
 * first section there is none, so the legend marks nothing while the visitor is still at the page title.
 */
export function currentSectionId(sections: readonly SectionPosition[], line: number): string | undefined {
    let current: string | undefined;
    for (const section of sections) {
        if (section.top <= line) current = section.id;
        else break;
    }
    return current;
}

/**
 * The id to mark as current. At the very end of the page a short last section may never reach the reading line, so the
 * last section wins there; otherwise the reading line decides.
 */
export function activeSectionId(
    sections: readonly SectionPosition[],
    line: number,
    atEnd: boolean,
): string | undefined {
    if (atEnd && sections.length > 0) return sections[sections.length - 1]?.id;
    return currentSectionId(sections, line);
}

/** True when the viewport's bottom edge is at the document's end (within a pixel or two of rounding). */
export function isAtPageEnd(scrollY: number, viewportHeight: number, documentHeight: number): boolean {
    return scrollY + viewportHeight >= documentHeight - 2;
}

/** The back-to-top links show as soon as the page is scrolled at all. */
export function showsBackToTop(scrollY: number): boolean {
    return scrollY > 0;
}

/**
 * The floating legend appears once the inline category nav has left the viewport upward (scrolled past), not when it is
 * merely below the viewport, and goes away again when the nav is back in view.
 */
export function showsLegend(navIntersecting: boolean, navTop: number): boolean {
    return !navIntersecting && navTop < 0;
}
