import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface FullscreenControls {
  isFullscreen: boolean;
  /** True when using the CSS pseudo-fullscreen fallback (no Fullscreen API). */
  isPseudo: boolean;
  toggle: () => void;
  exit: () => void;
}

/* WebKit-prefixed Fullscreen API (iPad Safari < 16.4 exposes ONLY these; the
   unprefixed API landed in 16.4). Without the prefix those devices silently
   fall back to CSS pseudo-fullscreen, which cannot hide the browser toolbar —
   the "strip at the top" tablet bug. */
interface FsDocument extends Document {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}
interface FsElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}

function fsDoc(): FsDocument {
  return document as FsDocument;
}

function apiAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  return document.fullscreenEnabled === true || fsDoc().webkitFullscreenEnabled === true;
}

function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? fsDoc().webkitFullscreenElement ?? null;
}

function exitNativeFullscreen(): void {
  if (document.exitFullscreen) {
    void document.exitFullscreen().catch(() => {});
  } else {
    fsDoc().webkitExitFullscreen?.();
  }
}

/**
 * Requests native fullscreen for `el`. Resolves on (apparent) success and
 * rejects when the request is denied, so the caller can degrade to pseudo
 * mode. The prefixed WebKit call returns no promise; state changes are
 * observed via the (also prefixed) change event instead.
 */
function requestNativeFullscreen(el: HTMLElement): Promise<void> {
  try {
    if (el.requestFullscreen) {
      return el.requestFullscreen({ navigationUI: 'hide' });
    }
    const webkit = (el as FsElement).webkitRequestFullscreen;
    if (webkit) {
      webkit.call(el);
      return Promise.resolve();
    }
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error('Fullscreen request failed'));
  }
  return Promise.reject(new Error('Fullscreen API unavailable'));
}

const FS_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

/**
 * Cross-browser fullscreen for a target element.
 *
 * - Chrome/Edge/Firefox: native Fullscreen API (unprefixed everywhere modern).
 * - iPad Safari < 16.4: WebKit-prefixed native Fullscreen API.
 * - Browsers without any API (e.g. iPhone Safari): CSS pseudo-fullscreen,
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
      setIsFullscreen(fullscreenElement() !== null && fullscreenElement() === el);
    };
    FS_CHANGE_EVENTS.forEach((ev) => document.addEventListener(ev, onChange));
    return () => FS_CHANGE_EVENTS.forEach((ev) => document.removeEventListener(ev, onChange));
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
    } else if (fullscreenElement()) {
      exitNativeFullscreen();
    }
  }, [exitPseudo]);

  const toggle = useCallback((): void => {
    const el = target.current;
    if (!el) return;

    if (pseudoRef.current || fullscreenElement() === el) {
      exit();
      return;
    }

    const enterPseudo = (): void => {
      pseudoRef.current = true;
      el.classList.add('pseudo-fullscreen');
      setIsPseudo(true);
      setIsFullscreen(true);
    };

    if (apiAvailable()) {
      // If something else is fullscreen (another element), replace it.
      const request = (): void => {
        requestNativeFullscreen(el).catch(() => {
          // Request denied (no gesture, iframe policy…), degrade to pseudo.
          enterPseudo();
        });
      };
      if (fullscreenElement()) {
        if (document.exitFullscreen) {
          void document.exitFullscreen().then(request, request);
        } else {
          fsDoc().webkitExitFullscreen?.();
          request();
        }
      } else {
        request();
      }
    } else {
      enterPseudo();
    }
  }, [target, exit]);

  /* Never leak fullscreen past the component's life. */
  useEffect(() => {
    const el = target.current;
    return () => {
      if (pseudoRef.current) {
        el?.classList.remove('pseudo-fullscreen');
        pseudoRef.current = false;
      } else if (fullscreenElement() && fullscreenElement() === el) {
        exitNativeFullscreen();
      }
    };
  }, [target]);

  return { isFullscreen, isPseudo, toggle, exit };
}
