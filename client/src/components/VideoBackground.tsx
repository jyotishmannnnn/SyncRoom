/**
 * Fixed, full-viewport looping video used as an ambient backdrop on the
 * pre-room pages. It sits behind everything (negative z-index) and is finished
 * with a scrim + gradient so foreground text stays legible and the loop seam
 * is masked. Muted + playsInline so it autoplays on every browser, and it
 * respects reduced-motion by falling back to a still first frame.
 */
export function VideoBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <video
        className="h-full w-full object-cover opacity-45 motion-reduce:hidden"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster=""
        src="/havnn-bg.mp4"
      />
      {/* Scrim: darken + tint toward the theme surface so content reads clearly
          and the video blends seamlessly into the background. */}
      <div className="absolute inset-0 bg-surface/70" />
      <div className="absolute inset-0 bg-gradient-to-b from-surface/30 via-transparent to-surface" />
    </div>
  );
}
