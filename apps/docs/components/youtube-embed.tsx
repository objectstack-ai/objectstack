'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';

type YouTubeEmbedProps = {
  /** The video id — the part after `youtu.be/`. */
  videoId: string;
  /** Video title. Used for the iframe title and the play button's label. */
  title: string;
  /** Cover shown until the viewer clicks play. Served from `public/`. */
  poster: string;
};

/**
 * Click-to-play YouTube embed.
 *
 * A facade, not a bare `<iframe>`: nothing is requested from YouTube until the
 * viewer actually clicks play, so the homepage costs no third-party frame,
 * script or cookie on load. The cover is the same one the README links from
 * (`docs/screenshots/hero-cover-dark.png`, re-encoded to WebP into `public/` —
 * `HERO_COVER` in `lib/site.ts` owns the path and the re-encode recipe), which
 * is 2:1 rather than the video's 16:9 — hence the fixed 2:1 frame with the
 * player centred inside it at its own aspect ratio. Cropping the cover to 16:9
 * would cut through the logo on the left edge, and letting the frame change
 * shape on click would shove the rest of the page down mid-interaction.
 */
export function YouTubeEmbed({ videoId, title, poster }: YouTubeEmbedProps) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="relative aspect-[2/1] w-full overflow-hidden rounded-xl border border-fd-border bg-black shadow-[0_24px_60px_-24px_rgb(0_0_0/0.45)]">
      {playing ? (
        <iframe
          className="absolute inset-0 m-auto aspect-video h-full"
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play the video: ${title}`}
          className="group absolute inset-0 h-full w-full cursor-pointer"
        >
          {/* Plain <img>, as everywhere else on this site — see lib/layout.shared.tsx. */}
          <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
          <span
            aria-hidden
            className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/25"
          />
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow-lg transition-transform group-hover:scale-110 md:size-20"
          >
            <Play className="ml-1 size-7 fill-black text-black md:size-8" />
          </span>
        </button>
      )}
    </div>
  );
}
