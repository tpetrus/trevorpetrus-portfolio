/** A short, silent, looping clip shown behind a page title. */
export interface TitleVideo {
    webm: string;
    mp4: string;
    poster: string;
    width: number;
    height: number;
}

/**
 * The Photography title loop. The files live in public/video: an AV1 WebM (smaller, for browsers that decode it) and
 * an H.264 MP4 fallback, with a still frame as the poster.
 */
export const PHOTOGRAPHY_TITLE_VIDEO: TitleVideo = {
    webm: '/video/photography-loop.webm',
    mp4: '/video/photography-loop.mp4',
    poster: '/video/photography-loop-poster.webp',
    width: 480,
    height: 270,
};
