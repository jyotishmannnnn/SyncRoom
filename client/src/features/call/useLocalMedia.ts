import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QUALITY_CONSTRAINTS, useSettings } from '@/store/settings';

export type MediaError = 'denied' | 'not-found' | 'in-use' | 'unknown' | null;

export interface LocalMedia {
  stream: MediaStream | null;
  error: MediaError;
  /** (Re)acquire camera+mic using current settings. */
  acquire: () => Promise<MediaStream | null>;
  /** Swap a single device without renegotiating the whole stream. */
  switchCamera: (deviceId: string) => Promise<MediaStreamTrack | null>;
  switchMicrophone: (deviceId: string) => Promise<MediaStreamTrack | null>;
  setTrackEnabled: (kind: 'audio' | 'video', enabled: boolean) => void;
  stop: () => void;
}

function classifyError(err: unknown): MediaError {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') return 'denied';
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') return 'not-found';
    if (err.name === 'NotReadableError' || err.name === 'AbortError') return 'in-use';
  }
  return 'unknown';
}

/**
 * Owns the local camera+microphone stream. Video constraints come from the
 * quality preset; audio applies noise suppression / echo cancellation /
 * auto gain from settings.
 */
export function useLocalMedia(): LocalMedia {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<MediaError>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const buildConstraints = useCallback((): MediaStreamConstraints => {
    const s = useSettings.getState();
    const q = QUALITY_CONSTRAINTS[s.quality];
    return {
      video: {
        deviceId: s.cameraId ? { ideal: s.cameraId } : undefined,
        width: { ideal: q.width },
        height: { ideal: q.height },
        frameRate: { ideal: s.frameRate },
      },
      audio: {
        deviceId: s.micId ? { ideal: s.micId } : undefined,
        noiseSuppression: s.noiseSuppression,
        echoCancellation: s.echoCancellation,
        autoGainControl: true,
      },
    };
  }, []);

  const acquire = useCallback(async (): Promise<MediaStream | null> => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      const media = await navigator.mediaDevices.getUserMedia(buildConstraints());
      media.getVideoTracks().forEach((t) => (t.contentHint = 'motion'));
      streamRef.current = media;
      setStream(media);
      setError(null);
      return media;
    } catch (err) {
      // Retry audio-only so a missing camera doesn't block the call.
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({
          audio: (buildConstraints().audio ?? true) as MediaTrackConstraints,
        });
        streamRef.current = audioOnly;
        setStream(audioOnly);
        setError(classifyError(err));
        return audioOnly;
      } catch (audioErr) {
        streamRef.current = null;
        setStream(null);
        setError(classifyError(audioErr));
        return null;
      }
    }
  }, [buildConstraints]);

  const switchTrack = useCallback(
    async (kind: 'video' | 'audio', deviceId: string): Promise<MediaStreamTrack | null> => {
      const current = streamRef.current;
      if (!current) return null;
      const constraints = buildConstraints();
      try {
        const single = await navigator.mediaDevices.getUserMedia(
          kind === 'video'
            ? {
                video: {
                  ...(constraints.video as MediaTrackConstraints),
                  deviceId: { exact: deviceId },
                },
              }
            : {
                audio: {
                  ...(constraints.audio as MediaTrackConstraints),
                  deviceId: { exact: deviceId },
                },
              },
        );
        const newTrack = kind === 'video' ? single.getVideoTracks()[0] : single.getAudioTracks()[0];
        if (!newTrack) return null;
        if (kind === 'video') newTrack.contentHint = 'motion';
        const old = kind === 'video' ? current.getVideoTracks()[0] : current.getAudioTracks()[0];
        if (old) {
          newTrack.enabled = old.enabled;
          current.removeTrack(old);
          old.stop();
        }
        current.addTrack(newTrack);
        // Stop any extra tracks the temp stream captured.
        single.getTracks().forEach((t) => {
          if (t !== newTrack) t.stop();
        });
        setStream(current);
        return newTrack;
      } catch {
        return null;
      }
    },
    [buildConstraints],
  );

  const switchCamera = useCallback(
    (deviceId: string) => switchTrack('video', deviceId),
    [switchTrack],
  );
  const switchMicrophone = useCallback(
    (deviceId: string) => switchTrack('audio', deviceId),
    [switchTrack],
  );

  const setTrackEnabled = useCallback((kind: 'audio' | 'video', enabled: boolean): void => {
    const current = streamRef.current;
    if (!current) return;
    const tracks = kind === 'audio' ? current.getAudioTracks() : current.getVideoTracks();
    tracks.forEach((t) => (t.enabled = enabled));
  }, []);

  const stop = useCallback((): void => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  useEffect(() => stop, [stop]);

  // Memoized: a stable object identity means effects depending on `local`
  // only re-run when something real changed — an unstable identity here once
  // caused a presence-update/broadcast/render feedback loop.
  return useMemo(
    () => ({ stream, error, acquire, switchCamera, switchMicrophone, setTrackEnabled, stop }),
    [stream, error, acquire, switchCamera, switchMicrophone, setTrackEnabled, stop],
  );
}
