// Browser glue for the gallery lightbox (PhotoSwipe). It binds to the DOM, so it is outside unit-test coverage; it is
// exercised by tests/e2e/lightbox.spec.ts. Imported from components/Gallery.astro, so it only ships on pages that
// render a gallery.
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import 'photoswipe/style.css';

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
        gallery: '#gallery',
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

    lightbox.init();
    return lightbox;
}

// Astro runs a module script once, but View Transitions swap the page's DOM without reloading it. PhotoSwipe binds to
// the elements present at init() and destroy() is final, so each page that has a gallery gets a fresh lightbox, and
// the old one is destroyed before its DOM is swapped away.
let lightbox: PhotoSwipeLightbox | null = null;

document.addEventListener('astro:page-load', () => {
    if (document.querySelector('#gallery') !== null) {
        lightbox = createLightbox();
    }
});

document.addEventListener('astro:before-swap', () => {
    lightbox?.destroy();
    lightbox = null;
});
