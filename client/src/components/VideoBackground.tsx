/**
 * Fixed, full-viewport looping video used as an ambient backdrop on the
 * pre-room pages: moonlit cherry blossoms with petals drifting on the wind.
 * It sits behind everything (negative z-index) and is finished with a scrim +
 * gradient so foreground text stays legible. The clip is a seamless crossfade
 * loop so the drifting petals never hard-cut. Muted + playsInline
 * so it autoplays on every browser, and it respects reduced-motion by falling
 * back to the still poster frame.
 */
export function VideoBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <img
        className="hidden h-full w-full object-cover opacity-80 motion-reduce:block"
        src="/havnn-bg-poster.jpg"
        alt=""
      />
      <video
        className="h-full w-full object-cover opacity-80 motion-reduce:hidden"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/havnn-bg-poster.jpg"
        src="/havnn-bg.mp4"
      />
      {/* Scrim: tint toward the theme surface so content reads clearly while the
          meadow still breathes through, and fade the edges into the background. */}
      <div className="absolute inset-0 bg-surface/40" />
      <div className="absolute inset-0 bg-gradient-to-b from-surface/30 via-transparent to-surface" />
    </div>
  );
}
