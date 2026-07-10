import { useEffect, useRef, useState } from 'react';

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
  // Skip mounting the video entirely under reduced-motion: the poster shows
  // instead and the multi-megabyte clip is never downloaded.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The still poster paints immediately (it is the LCP element); the clip
  // mounts once the browser is idle so it never competes with critical work.
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    if (reducedMotion) return;
    // typeof check: Safari still lacks requestIdleCallback.
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setShowVideo(true), { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => setShowVideo(true), 350);
    return () => window.clearTimeout(id);
  }, [reducedMotion]);

  useEffect(() => {
    // Arm the unmute gesture only once the video exists; under reduced-motion
    // there is no video, so stay silent.
    if (!showVideo) return;

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
        // rAF timestamps can predate the performance.now() captured above;
        // clamp so volume never goes negative (which throws).
        const t = Math.min(1, Math.max(0, (now - started) / FADE_MS));
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
  }, [showVideo]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <picture>
        <source srcSet="/havnn-bg-poster.webp" type="image/webp" />
        <img
          className="absolute inset-0 h-full w-full object-cover opacity-90"
          src="/havnn-bg-poster.jpg"
          alt=""
          decoding="async"
        />
      </picture>
      {showVideo && (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover opacity-95"
          autoPlay
          muted
          loop
          playsInline
          src="/havnn-bg.mp4"
        />
      )}
      {/* Scrim: a light tint toward the theme surface so content reads clearly
          while the blossoms stay prominent, fading the edges into the page. */}
      <div className="absolute inset-0 bg-surface/25" />
      <div className="absolute inset-0 bg-gradient-to-b from-surface/30 via-transparent to-surface" />
    </div>
  );
}
