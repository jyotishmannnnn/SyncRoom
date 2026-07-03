import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface FullscreenControls {
  isFullscreen: boolean;
  /** True when using the CSS pseudo-fullscreen fallback (no Fullscreen API). */
  isPseudo: boolean;
  toggle: () => void;
  exit: () => void;
}

function apiAvailable(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true;
}

/**
 * Cross-browser fullscreen for a target element.
 *
 * - Chrome/Edge/Firefox: native Fullscreen API (unprefixed everywhere modern).
 * - Browsers without the API (e.g. iPhone Safari): CSS pseudo-fullscreen —
 *   the element is pinned inset-0 with a `pseudo-fullscreen` class and Esc
 *   is handled manually, so the cinema experience degrades gracefully.
 * - Unmounting (or the element leaving the DOM) never leaves stale state:
 *   native exit events are observed, and cleanup exits fullscreen if this
 *   hook's element still owns it.
 */
export function useFullscreen(target: RefObject<HTMLElement | null>): FullscreenControls {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPseudo, setIsPseudo] = useState(false);
  const pseudoRef = useRef(false);

  /* Track native fullscreen changes (button, Esc, F11 exits, element removal). */
  useEffect(() => {
    const onChange = (): void => {
      if (pseudoRef.current) return;
      const el = target.current;
      setIsFullscreen(document.fullscreenElement !== null && document.fullscreenElement === el);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [target]);

  const exitPseudo = useCallback((): void => {
    pseudoRef.current = false;
    target.current?.classList.remove('pseudo-fullscreen');
    setIsPseudo(false);
    setIsFullscreen(false);
  }, [target]);

  /* Esc exits pseudo mode (native mode gets this from the browser). */
  useEffect(() => {
    if (!isPseudo) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') exitPseudo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPseudo, exitPseudo]);

  const exit = useCallback((): void => {
    if (pseudoRef.current) {
      exitPseudo();
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [exitPseudo]);

  const toggle = useCallback((): void => {
    const el = target.current;
    if (!el) return;

    if (pseudoRef.current || document.fullscreenElement === el) {
      exit();
      return;
    }

    if (apiAvailable()) {
      // If something else is fullscreen (another element), replace it.
      const request = (): void => {
        el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
          // Request denied (no gesture, iframe policy…) — degrade to pseudo.
          pseudoRef.current = true;
          el.classList.add('pseudo-fullscreen');
          setIsPseudo(true);
          setIsFullscreen(true);
        });
      };
      if (document.fullscreenElement) {
        void document.exitFullscreen().then(request, request);
      } else {
        request();
      }
    } else {
      pseudoRef.current = true;
      el.classList.add('pseudo-fullscreen');
      setIsPseudo(true);
      setIsFullscreen(true);
    }
  }, [target, exit]);

  /* Never leak fullscreen past the component's life. */
  useEffect(() => {
    const el = target.current;
    return () => {
      if (pseudoRef.current) {
        el?.classList.remove('pseudo-fullscreen');
        pseudoRef.current = false;
      } else if (document.fullscreenElement && document.fullscreenElement === el) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [target]);

  return { isFullscreen, isPseudo, toggle, exit };
}
