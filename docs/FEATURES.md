# Features

## Rooms

| Feature                   | Notes                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Create room               | Random Meet-style code (`abcd-efgh`, unambiguous alphabet) or custom code (4–10 chars, `a-z 0-9 -`)                     |
| Join by code              | Deep-linkable: `/room/<code>` goes straight to the lobby                                                                |
| Participant list          | Names, host badge, camera/presenting status, mute indicators, live count in the top bar                                 |
| Lock / unlock             | Locked rooms reject new joiners; existing members unaffected                                                            |
| Force-mute                | Host mutes a participant's mic (their client disables the track; they may unmute themselves, by design, matching Meet) |
| Remove participant        | Kicked clients see a dedicated screen and cannot silently rejoin while locked                                           |
| Transfer host             | Explicit via menu; automatic to the longest-present member if the host leaves                                           |
| End meeting               | Ends for everyone, room is destroyed immediately                                                                        |
| Refresh recovery          | Per-tab `participantKey` reclaims the same identity within a 15 s grace window; the tab auto-rejoins                    |
| Duplicate-join prevention | The same tab identity can't join twice; a second tab gets its own identity                                              |
| Room lifetime             | Rooms die 60 s after the last participant leaves, nothing is ever stored                                               |

## Video calling

- Camera, microphone, **screen share** (with audio where the browser supports it, e.g. tab share in Chrome).
- **Device switching** mid-call (camera/mic hot-swap via `replaceTrack`, no renegotiation hiccup) and speaker selection (`setSinkId`).
- **Quality presets** 720p / 1080p / 1440p / **4K**, 30 or 60 fps, with matching encoder bitrate ceilings (4–25 Mbps) and `degradationPreference` tuned per content (`motion` for camera, `detail`/maintain-resolution for screens).
- **Noise suppression, echo cancellation, auto gain**, browser-native constraints, toggleable in Settings.
- **Camera preview lobby** with device pickers and mic/cam toggles before joining.
- **Connection quality** per peer: RTT, packet loss %, outbound bitrate, colored dot on each tile + aggregate in the top bar.
- **Auto-reconnect**: Socket.IO retries with backoff and re-joins silently; ICE restarts on `failed`.
- Fullscreen (F), **picture-in-picture** per tile, adaptive layout (remote screen share becomes the hero tile).
- Graceful degradation: no camera / denied permission → join audio-only with an avatar tile.

Background blur is deliberately deferred (needs a segmentation model; see ROADMAP).

## Chat

Realtime messages, 24-emoji quick picker, typing indicator, **read receipts** (✓ delivered, ✓✓ read by everyone), file + image sharing (drag & drop anywhere in the panel or via the paperclip, 10 MB cap, relayed in memory, never stored), copy message, delete own message, timestamps, unread badge on the chat button, desktop notifications when the tab is hidden (opt-in).

## Watch together (media sync)

Paste a link in the **Watch** panel (W):

| Source                                                   | How it plays                             | Sync                                           |
| -------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| YouTube (`watch`, `youtu.be`, `shorts`, `embed`, `live`) | IFrame Player API                        | ✅ full (play/pause/seek/rate/late-join/drift) |
| Direct files (`.mp4 .webm .ogv .mov .m4v`)               | HTML5 `<video>`                          | ✅ full                                        |
| HLS (`.m3u8`)                                            | hls.js (lazy-loaded) or native on Safari | ✅ full                                        |
| MPEG-DASH (`.mpd`)                                       | dash.js (lazy-loaded)                    | ✅ full                                        |
| Google Drive share links                                 | see below                                | ⚠️ conditional                                 |

Host-authoritative sync (full state machine in `ARCHITECTURE.md`): if the host pauses, everyone pauses; play/seek/speed likewise; late joiners land on the current timestamp in the correct state. Drift ≤150 ms is ignored, 150–500 ms is corrected invisibly with a 2–4% playback-rate nudge, ≥500 ms triggers a single seek. Every state is sequence-stamped (stale updates dropped) and every player command is intent-tracked, so sync-induced player events are never re-broadcast, feedback loops are structurally impossible. Seeks emit once after scrubbing ends; identical duplicate events are collapsed.

**Queue**: anyone can add links; the controller plays/removes them; auto-advances when a video ends. **Shared controls**: host can allow everyone to control playback (`host-only` / `everyone`).

### Cinema fullscreen

Enter/exit via the fullscreen buttons, double-click on the stage, or `F`; `Esc` exits (native). Fullscreen is **strictly local**, it never emits a socket event and never affects other participants, and it survives provider switches (YouTube → Drive → MP4) because the stage wrapper, not the player, is fullscreened.

In cinema mode: the video fills the screen (aspect preserved), page chrome disappears, and a YouTube-style floating bar (play/pause for controllers, timeline with scrubbing, local volume/mute, chat, participants, leave, fullscreen toggle) fades after 3 s of inactivity, the cursor hides with it and both return on mouse movement. Webcam thumbnails float in a draggable cluster; chat and participants open as overlays without leaving fullscreen. The same bar is available outside fullscreen as a hover overlay, which also gives guests volume control.

Browsers without the Fullscreen API (e.g. iOS Safari) degrade to a CSS pseudo-fullscreen with identical chrome; `Esc` is handled manually there.

### Google Drive, limitations (read this)

**Accepted link shapes** (the file id is detected automatically): `drive.google.com/file/d/<id>/view|preview|edit`, `drive.google.com/open?id=<id>`, `drive.google.com/uc?id=<id>`, `docs.google.com/uc?id=<id>`, `drive.usercontent.google.com/download?id=<id>`. Folder links are rejected with an explanation (share the file itself, not its folder).

Google intentionally restricts programmatic playback of Drive-hosted video:

1. **What we try first:** the share link is converted to the direct-download endpoint (`uc?export=download&id=…`) and played in the HTML5 player → **full sync works, exactly like YouTube**. This succeeds when the file is shared "Anyone with the link", is under the virus-scan size threshold (~100 MB), and Drive hasn't rate-limited the file ("quota exceeded" on popular files).
2. **Automatic fallback:** if direct playback errors, or never becomes ready within 12 s, the player is swapped for Drive's own preview iframe (a `DriveEmbedAdapter` with `canSync() === false`). The iframe exposes **no playback API**, so in this mode each viewer controls their own playback and **sync is not possible**, one banner plus one (never-repeating) notice state this clearly.
3. Not possible at all: private files, files requiring sign-in, and Drive links behind organization policies.

**Recommendation for movie nights:** upload the file to any static host / object storage (Cloudflare R2, S3, Backblaze) and paste the direct MP4/HLS URL, full sync, no Drive quirks. This is a Google policy constraint, not a SyncRoom bug.

## Settings

Theme (dark / light / system), camera, microphone, speaker, resolution + frame-rate presets, noise suppression, echo cancellation, chat notifications, keyboard-shortcut reference. Persisted in `localStorage`.

## Keyboard shortcuts

`M` mic · `V` camera · `S` screen share · `C` chat · `P` people · `W` watch panel · `F` fullscreen · `Space` play/pause (controllers) · `Esc` close panel. Disabled while typing.

## Error handling

Network drop (auto-reconnect + toast), camera/mic missing, in-use or denied (audio-only join + clear message), peer disconnect (grace window, then tile removal), room expired/not found, locked, full, duplicate tab, rate-limited, invalid/unsupported links, YouTube embed-disabled videos (owner disabled embedding, clear message), Drive fallback (banner), autoplay blocked (prompt to click).
