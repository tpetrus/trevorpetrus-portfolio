// Browser glue for dismissing tooltips with Escape (WCAG 1.4.13). DOM only, so it is outside unit coverage; the
// end-to-end specs in tests/e2e/projects.spec.ts exercise it. Imported from components/ProjectCard.astro.
//
// The tooltip's visibility is CSS; this only sets [data-tooltip-dismissed] on <html>, which hides every tooltip until
// the pointer or focus leaves the element that owns one. The document survives View Transitions, so the listeners are
// registered once here and the attribute is cleared on each page load.

const ATTRIBUTE = 'data-tooltip-dismissed';
const root = document.documentElement;

// Escape never moves focus and is not prevented, so dialogs and the lightbox keep their own Escape handling.
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') root.setAttribute(ATTRIBUTE, '');
});

// pointerleave and blur do not bubble, so pointerout and focusout stand in for them. They also fire when moving between
// children of the owner (the icon onto the tooltip), which must not re-arm the tooltip: relatedTarget tells them apart.
function clearOnLeave(event: Event, next: EventTarget | null): void {
    const owner = event.target instanceof Element ? event.target.closest('a, button') : null;
    if (owner === null || owner.querySelector('[data-tooltip]') === null) return;
    if (next instanceof Node && owner.contains(next)) return;
    root.removeAttribute(ATTRIBUTE);
}

document.addEventListener('pointerout', (event) => clearOnLeave(event, event.relatedTarget));
document.addEventListener('focusout', (event) => clearOnLeave(event, event.relatedTarget));
document.addEventListener('astro:page-load', () => root.removeAttribute(ATTRIBUTE));
