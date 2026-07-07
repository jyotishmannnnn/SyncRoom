import { useEffect, useRef } from 'react';

/** Ceiling for the ambient track: clearly audible but still subtle. */
const AMBIENT_VOLUME = 0.55;
const FADE_MS = 2500;

/**
 * Fixed, full-viewport looping video used as an ambient backdrop on the
 * pre-room pages: cherry blossoms drifting over a cinematic sky. It sits
 * behind everything (negative z-index) and is finished with a light scrim +
 * gradient so foreground text stays legible while the scenery stays vibrant.
 * Muted + playsInline so it autoplays on every browser, and it respects
 * reduced-motion by falling back to the still poster frame.
 *
 * The clip carries a quiet ambient track. Autoplay policies only allow
 * silent playback, so it starts muted and gently fades the audio in on the
 * first user gesture instead of fighting the browser.
 */
export function VideoBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Under reduced-motion the video is hidden behind the poster; playing
    // audio from an invisible clip would only confuse, so stay silent.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    const unmute = () => {
      window.removeEventListener('pointerdown', unmute, { capture: true });
      window.removeEventListener('keydown', unmute, { capture: true });
      const el = videoRef.current;
      if (!el) return;
      el.volume = 0;
      el.muted = false;
      const started = performance.now();
      const step = (now: number) => {
        const video = videoRef.current;
        if (!video) return;
        const t = Math.min(1, (now - started) / FADE_MS);
        video.volume = AMBIENT_VOLUME * t;
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    window.addEventListener('pointerdown', unmute, { once: true, capture: true });
    window.addEventListener('keydown', unmute, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', unmute, { capture: true });
      window.removeEventListener('keydown', unmute, { capture: true });
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <img
        className="hidden h-full w-full object-cover opacity-90 motion-reduce:block"
        src="/havnn-bg-poster.jpg"
        alt=""
      />
      <video
        ref={videoRef}
        className="h-full w-full object-cover opacity-95 motion-reduce:hidden"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/havnn-bg-poster.jpg"
        src="/havnn-bg.mp4"
      />
      {/* Scrim: a light tint toward the theme surface so content reads clearly
          while the blossoms stay prominent, fading the edges into the page. */}
      <div className="absolute inset-0 bg-surface/25" />
      <div className="absolute inset-0 bg-gradient-to-b from-surface/30 via-transparent to-surface" />
    </div>
  );
}
