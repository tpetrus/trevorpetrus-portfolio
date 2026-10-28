// Browser glue for the gallery lightbox (PhotoSwipe). It binds to the DOM, so it is outside unit-test coverage; it is
// exercised by tests/e2e/lightbox.spec.ts. Imported from components/Gallery.astro, so it only ships on pages that
// render a gallery.
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import 'photoswipe/style.css';

import { photoIdFromHash } from '../lib/photoLink';
import '../styles/lightbox.css';

// An arrow leaving a box: "open the original in a new tab". It reuses PhotoSwipe's own button markup, so it gets the
// same sizing, outline and hover states as the built-in buttons.
const VIEW_ORIGINAL_ICON = {
    isCustomSVG: true,
    inner: '<path d="M18 8h6v6h-2v-2.6l-6.3 6.3-1.4-1.4 6.3-6.3H18V8zM9 10h7v2h-5v9h9v-5h2v7H9V10z" id="pswp__icn-original"/>',
    outlineID: 'pswp__icn-original',
};

function createLightbox(): PhotoSwipeLightbox {
    const lightbox = new PhotoSwipeLightbox({
        // One lightbox for every gallery on the page (one per category); each gallery navigates within itself.
        gallery: '[data-gallery]',
        children: 'a',
        // PhotoSwipe's core is loaded on the first click, not with the page.
        pswpModule: () => import('photoswipe'),
    });

    lightbox.on('uiRegister', () => {
        const ui = lightbox.pswp?.ui;

        // The thumbnail link's dataset is the source of truth for both elements, so the lightbox needs no data of its
        // own: whatever the page rendered (and works without) is what it shows.
        ui?.registerElement({
            name: 'view-original',
            order: 15,
            isButton: true,
            tagName: 'a',
            ariaLabel: 'View original',
            title: 'View original',
            html: VIEW_ORIGINAL_ICON,
            appendTo: 'bar',
            onInit: (element, pswp) => {
                // The `download` attribute is ignored for cross-origin URLs, so this is a plain link to the file.
                const link = element as HTMLAnchorElement;
                link.target = '_blank';
                link.rel = 'noopener';
                pswp.on('change', () => {
                    link.href = pswp.currSlide?.data.element?.dataset.original ?? '';
                });
            },
        });

        ui?.registerElement({
            name: 'gallery-caption',
            className: 'pswp__hide-on-close pswp__gallery-caption',
            appendTo: 'root',
            onInit: (element, pswp) => {
                pswp.on('change', () => {
                    const caption = pswp.currSlide?.data.element?.dataset.caption ?? '';
                    element.textContent = caption;
                    element.hidden = caption === '';
                });
            },
        });
    });

    // A deep link's fragment would reopen the viewer on reload or Back after it closes, so it is dropped on close.
    // history.state is kept because Astro's ClientRouter stores its navigation state there.
    lightbox.on('close', () => {
        if (photoIdFromHash(location.hash) !== undefined) {
            history.replaceState(history.state, '', location.pathname + location.search);
        }
    });

    lightbox.init();
    return lightbox;
}

// Astro runs a module script once, but View Transitions swap the page's DOM without reloading it. PhotoSwipe binds to
// the elements present at init() and destroy() is final, so each page that has a gallery gets a fresh lightbox, and
// the old one is destroyed before its DOM is swapped away.
let lightbox: PhotoSwipeLightbox | null = null;

// Destroys the lightbox and resolves once an open viewer is gone from the DOM. PhotoSwipe's destroy() only starts to
// close an open viewer and ignores the call while the viewer is still opening, so the opening animation is waited out
// first; a viewer that is already closing finishes on its own and is waited for too.
function destroyLightbox(instance: PhotoSwipeLightbox): Promise<void> {
    const viewer = instance.pswp;
    if (viewer === undefined) {
        instance.destroy();
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        viewer.on('destroy', () => resolve());
        if (viewer.opener.isOpening) {
            viewer.on('openingAnimationEnd', () => instance.destroy());
        } else {
            instance.destroy();
        }
    });
}

// Two frames: the first runs before the next paint, the second after it.
const afterNextPaint = (): Promise<void> =>
    new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

// Opens the photo a "/photography#photo-<name>" link names (the home collage links this way). The index must be
// among the links of its own gallery, because that is the list PhotoSwipe navigates.
function openFromHash(instance: PhotoSwipeLightbox): void {
    const id = photoIdFromHash(location.hash);
    if (id === undefined) return;
    const photo = document.getElementById(id)?.querySelector<HTMLAnchorElement>('a.photo');
    const gallery = photo?.closest<HTMLElement>('[data-gallery]');
    if (photo == null || gallery == null) return;
    const index = Array.from(gallery.querySelectorAll('a')).indexOf(photo);
    if (index >= 0) instance.loadAndOpen(index, { gallery });
}

document.addEventListener('astro:page-load', () => {
    if (document.querySelector('[data-gallery]') !== null) {
        lightbox = createLightbox();
        openFromHash(lightbox);
    }
});

// Setting the fragment on the page (or following an in-page link) does not reload it, so it opens the photo too.
window.addEventListener('hashchange', () => {
    if (lightbox !== null) openFromHash(lightbox);
});

// Navigating away with the viewer open used to swap the page while the viewer was still live, which crashed Playwright's
// WebKit page process every time. The swap in astro:before-swap is synchronous, so the viewer is closed here instead:
// Astro awaits the loader before it fetches and swaps the next page, and the paint lets the browser drop the viewer's
// layers before the old body goes.
document.addEventListener('astro:before-preparation', (event) => {
    const fetchNextPage = event.loader;
    event.loader = async () => {
        if (lightbox !== null) {
            await destroyLightbox(lightbox);
            await afterNextPaint();
        }
        await fetchNextPage();
    };
});

document.addEventListener('astro:before-swap', () => {
    lightbox?.destroy();
    lightbox = null;
});
