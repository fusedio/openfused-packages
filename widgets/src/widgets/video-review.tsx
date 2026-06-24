// widgets/video-review.tsx — timestamped video feedback (INPUT): the human
// scrubs a video, drops timecoded notes, and QAs the agent's previous round of
// fixes. Built for the PARLEY loop (spec/json-ui-local.md § The parley): an
// agent producing a video pushes a view with this component, the human's notes
// ride the ordinary params channel as they are written (the debounced `params`
// reporter — no extra machinery), and the agent re-edits and pushes the next
// cut with the prior round baked into `rounds`.
//
// Like `button`, this is an openfused FEEDBACK PRIMITIVE, not an app-parity
// component — the contract is owned by spec/ui/json-ui.md § Actions & selection.
//
// Prop contract:
//   • `src`          — video URL, passed verbatim to <video> (missing src
//                      renders a placeholder, like `image`).
//   • `title`        — optional card title.
//   • `param`        — param receiving the OPEN comments as an ARRAY of
//                      `{t, text}` (t = seconds into the video). Selection-as-
//                      feedback: arrays are for feedback, never SQL.
//   • `defaultValue` — optional initial comments array, seeded on mount iff
//                      authored (the slider's `initIfAbsent` discipline). Also
//                      what the planner harvests for first-paint params.
//   • `rounds`       — past feedback rounds `[{n, label?, comments:[{t,text}]}]`,
//                      display-only: each comment gets ✓ approve / ↺ re-flag QA
//                      buttons. The agent bakes the round it just addressed into
//                      the NEXT pushed config (params reset per push).
//   • `qaParam`      — param receiving the QA verdicts as an OBJECT map
//                      `{"<n>-<idx>": "approved"|"reflagged"}`. Re-flagging also
//                      re-opens the comment into the open-comments param with a
//                      " (re-flagged)" suffix, so the agent's work list is
//                      always just the open array.
//
// The component never reports actions itself — pair it with `button`
// (`{action: "re-edit", submit: …}`) for the explicit "send this round" signal;
// on a parley page the notes additionally stream live via `params` events.
//
// Player: click-to-play, speed buttons, a scrub track with an audio WAVEFORM
// (decoded once from the source via the Web Audio API; the played portion is
// tinted amber, the rest faint), a progress fill and comment pins (amber =
// open, blue/green/red = pending/approved/re-flagged), and keyboard shortcuts
// scoped to the focused widget (space play, ←/→ ±2 s, ,/. frame step, 1/2 =
// 1×/2× speed, C = note at the playhead). The playhead/timecode are updated
// via direct DOM writes from a rAF loop while playing — no per-frame React
// re-render of the notes list; the waveform's played/unplayed split is
// repainted in the same loop (a cheap fillRect pass, not a React render).
//
// The waveform decode needs the raw audio bytes, so it only works when the
// source is fetchable same-origin / CORS-enabled / a data: URL. A cross-origin
// fetch, a video with no audio track, or a decode failure simply leaves the
// track waveform-less — never an error.

import React from "react";
import { z } from "zod";
import {
  useFusedParam,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { Card, EmptyState } from "../components/card";

// ----------------------------------------------------------------- props schema
const commentSchema = z.object({
  t: z.number().describe("Timestamp in seconds into the video."),
  text: z.string().describe("The note text."),
});

export const videoReviewProps = z
  .object({
    src: z
      .string()
      .describe(
        "Video URL (http(s), data:, or anything a <video> src accepts). Passed verbatim.",
      ),
    title: z.string().optional().describe("Card title shown above the player."),
    param: z
      .string()
      .optional()
      .describe(
        "Param receiving the open review comments as an ARRAY of {t, text} objects (t = seconds). Comments are feedback for the agent — never reference an array param in SQL.",
      ),
    defaultValue: z
      .array(commentSchema)
      .optional()
      .describe(
        "Initial open comments seeded into the param on mount (use [] to make the param present from first paint).",
      ),
    rounds: z
      .array(
        z.object({
          n: z.number().describe("Round number (used in the QA verdict key)."),
          label: z
            .string()
            .optional()
            .describe('Optional round caption, e.g. "submitted 2026-06-11".'),
          comments: z.array(commentSchema).describe("The round's comments."),
        }),
      )
      .optional()
      .describe(
        "Past feedback rounds the agent already addressed, newest-first display. Each comment gets approve / re-flag QA buttons; re-flagging re-opens it into the open-comments param.",
      ),
    qaParam: z
      .string()
      .optional()
      .describe(
        'Param receiving QA verdicts on past-round comments as an OBJECT map {"<round>-<index>": "approved"|"reflagged"}. Feedback-only — never reference it in SQL.',
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type VideoReviewProps = z.infer<typeof videoReviewProps>;

interface VrComment {
  t: number;
  text: string;
}

interface VrRound {
  n: number;
  label?: string;
  comments: VrComment[];
}

type QaMap = Record<string, string>;

const SPEEDS = [0.5, 1, 1.5, 2] as const;
const FRAME_S = 1 / 24;
const WAVE_BARS = 480;

/** Downsample a decoded buffer to `n` normalized (0..1) peak magnitudes. */
function computePeaks(audio: AudioBuffer, n: number): number[] {
  const data = audio.getChannelData(0);
  const block = Math.floor(data.length / n) || 1;
  const peaks = new Array<number>(n).fill(0);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const start = i * block;
    const end = Math.min(start + block, data.length);
    let m = 0;
    for (let j = start; j < end; j++) {
      const a = Math.abs(data[j]);
      if (a > m) m = a;
    }
    peaks[i] = m;
    if (m > max) max = m;
  }
  if (max > 0) for (let i = 0; i < n; i++) peaks[i] /= max;
  return peaks;
}

/** mm:ss.t — tabular, matches the review-tool convention. */
function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

function isComment(v: unknown): v is VrComment {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as VrComment).t === "number" &&
    Number.isFinite((v as VrComment).t) &&
    typeof (v as VrComment).text === "string"
  );
}

/** Param values arrive from the store/URL untyped — keep only valid comments. */
function sanitizeComments(value: unknown): VrComment[] {
  return Array.isArray(value) ? value.filter(isComment) : [];
}

function sanitizeRounds(value: unknown): VrRound[] {
  if (!Array.isArray(value)) return [];
  const out: VrRound[] = [];
  for (const r of value) {
    if (typeof r !== "object" || r === null) continue;
    const n = (r as VrRound).n;
    if (typeof n !== "number" || !Number.isFinite(n)) continue;
    const label = (r as VrRound).label;
    out.push({
      n,
      label: typeof label === "string" ? label : undefined,
      comments: sanitizeComments((r as VrRound).comments),
    });
  }
  return out;
}

// -------------------------------------------------------------------- component
function VideoReview({ element }: ComponentRenderProps<VideoReviewProps>) {
  const { src, title, param, qaParam, style } = element.props;
  const rounds = React.useMemo(
    () => sanitizeRounds(element.props.rounds),
    [element.props.rounds],
  );

  // ---- open comments param (slider's authored-default discipline: seed iff
  // the raw prop is present, so an unauthored widget never broadcasts []).
  const authoredDefault =
    (element.props as Record<string, unknown>).defaultValue !== undefined;
  const seed = sanitizeComments(element.props.defaultValue);
  const { value: commentsValue, setValue: setCommentsValue } = useFusedParam<
    VrComment[]
  >({
    param: param || undefined,
    defaultValue: seed,
    broadcastDefaultValue: authoredDefault,
  });
  const comments = React.useMemo(
    () => sanitizeComments(commentsValue),
    [commentsValue],
  );
  const setComments = (next: VrComment[]) =>
    setCommentsValue([...next].sort((a, b) => a.t - b.t));

  // ---- QA verdicts param. With qaParam unset the hook is plain local state —
  // the buttons still work visually and re-flag still re-opens comments.
  const { value: qaValue, setValue: setQaValue } = useFusedParam<QaMap>({
    param: qaParam || undefined,
    defaultValue: {},
    broadcastDefaultValue: false,
  });
  const qa: QaMap = React.useMemo(() => {
    if (typeof qaValue !== "object" || qaValue === null || Array.isArray(qaValue))
      return {};
    const out: QaMap = {};
    for (const [k, v] of Object.entries(qaValue)) {
      if (v === "approved" || v === "reflagged") out[k] = v;
    }
    return out;
  }, [qaValue]);

  // ---- player state
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const cursorRef = React.useRef<HTMLDivElement | null>(null);
  const fillRef = React.useRef<HTMLDivElement | null>(null);
  const tcRef = React.useRef<HTMLSpanElement | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const waveRef = React.useRef<HTMLCanvasElement | null>(null);
  const peaksRef = React.useRef<number[]>([]);
  const waveColorsRef = React.useRef<{ played: string; base: string } | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [rate, setRate] = React.useState(1);

  // A parley push swaps `src` on the SAME instance: reset the player state so a
  // new cut never inherits the previous clip's timeline. Loading a new source
  // pauses the element and its `playbackRate` reverts to 1× in the DOM, but the
  // React state does not follow on its own — `duration` would scale scrub/pins
  // to the old clip until metadata loads, and the speed UI would show a stale
  // active rate. `onLoadedMetadata` repopulates `duration` for the new clip.
  React.useEffect(() => {
    setDuration(0);
    setPlaying(false);
    setRate(1);
    if (videoRef.current) videoRef.current.playbackRate = 1;
  }, [src]);

  // Repaint the waveform bars, tinting the played portion amber. Cheap enough
  // to run every animation frame — it's a direct canvas pass, not a React
  // render, matching the playhead's direct-DOM-write discipline.
  const drawWave = React.useCallback(() => {
    const cv = waveRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (cv.width !== bw || cv.height !== bh) {
      cv.width = bw;
      cv.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const peaks = peaksRef.current;
    if (peaks.length === 0) return;
    if (!waveColorsRef.current) {
      const cs = getComputedStyle(cv);
      waveColorsRef.current = {
        played: cs.getPropertyValue("--ofw-accent").trim() || "#f5a623",
        base: cs.getPropertyValue("--ofw-text-faint").trim() || "#5a6678",
      };
    }
    const { played, base } = waveColorsRef.current;
    const v = videoRef.current;
    const dur = v?.duration || 0;
    const playedX = dur > 0 ? (v!.currentTime / dur) * w : 0;
    const mid = h / 2;
    const n = peaks.length;
    const colW = w / n;
    const barW = Math.max(1, colW - (colW > 2 ? 1 : 0));
    for (let i = 0; i < n; i++) {
      const x = i * colW;
      const amp = Math.max(0.02, peaks[i]) * (h - 2);
      ctx.fillStyle = x < playedX ? played : base;
      ctx.fillRect(x, mid - amp / 2, barW, amp);
    }
  }, []);

  // Playhead + timecode via direct DOM writes (no React re-render per frame).
  const tick = React.useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const dur = v.duration || 0;
    const pct = dur > 0 ? (v.currentTime / dur) * 100 : 0;
    if (cursorRef.current) cursorRef.current.style.left = `${pct}%`;
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
    if (tcRef.current)
      tcRef.current.textContent = `${fmt(v.currentTime)} / ${fmt(dur)}`;
    drawWave();
  }, [drawWave]);

  React.useEffect(() => {
    if (!playing) return;
    const loop = () => {
      tick();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, tick]);

  // Decode the source's audio once per `src` and stash the peaks. Best-effort:
  // a cross-origin fetch, an audio-less video, or a decode failure just leaves
  // the track bare (no waveform), never an error.
  React.useEffect(() => {
    peaksRef.current = [];
    drawWave();
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!src || !Ctx) return;
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(src);
        if (!resp.ok || cancelled) return;
        const bytes = await resp.arrayBuffer();
        if (cancelled) return;
        const ac = new Ctx();
        try {
          const audio = await ac.decodeAudioData(bytes);
          if (cancelled) return;
          peaksRef.current = computePeaks(audio, WAVE_BARS);
          drawWave();
        } finally {
          // Close even when decodeAudioData rejects — browsers cap concurrent
          // AudioContexts (~6), so leaking one per failed decode across parley
          // pushes would eventually starve the waveform for later clips.
          void ac.close();
        }
      } catch {
        /* no fetchable audio / decode failure → render without a waveform */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, drawWave]);

  // Repaint on track resize so the bars stay crisp and fill the width.
  React.useEffect(() => {
    const cv = waveRef.current;
    if (!cv || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => drawWave());
    ro.observe(cv);
    return () => ro.disconnect();
  }, [drawWave]);

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const dur = v.duration || 0;
    v.currentTime = Math.max(0, Math.min(dur > 0 ? dur : t, t));
    tick();
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  const setSpeed = (s: number) => {
    setRate(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
  };

  // ---- composer
  const [composerAt, setComposerAt] = React.useState<number | null>(null);
  const [composerText, setComposerText] = React.useState("");
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);

  const openComposer = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setComposerAt(v.currentTime);
    setComposerText("");
  };
  React.useEffect(() => {
    if (composerAt !== null) composerRef.current?.focus();
  }, [composerAt]);

  const saveNote = () => {
    const text = composerText.trim();
    if (composerAt === null || !text) return;
    setComments([...comments, { t: Math.round(composerAt * 100) / 100, text }]);
    setComposerAt(null);
  };

  // ---- QA actions
  const approve = (key: string) => setQaValue({ ...qa, [key]: "approved" });
  const reflag = (key: string, cm: VrComment) => {
    setQaValue({ ...qa, [key]: "reflagged" });
    setComments([...comments, { t: cm.t, text: `${cm.text} (re-flagged)` }]);
  };

  // ---- keyboard, scoped to the focused widget (never the document)
  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    const v = videoRef.current;
    if (!v) return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowLeft":
        e.preventDefault();
        seekTo(v.currentTime - (e.shiftKey ? 10 : 2));
        break;
      case "ArrowRight":
        e.preventDefault();
        seekTo(v.currentTime + (e.shiftKey ? 10 : 2));
        break;
      case ",":
        seekTo(v.currentTime - FRAME_S);
        break;
      case ".":
        seekTo(v.currentTime + FRAME_S);
        break;
      case "1":
        e.preventDefault();
        setSpeed(1);
        break;
      case "2":
        e.preventDefault();
        setSpeed(2);
        break;
      case "c":
      case "C":
        e.preventDefault();
        openComposer();
        break;
    }
  };

  // Scrub: click anywhere on the track to seek, or press-and-drag to scrub
  // continuously. Pointer capture keeps the drag alive even when the cursor
  // leaves the thin track. `dur` is read live off the element so scrubbing
  // works before the `duration` state settles.
  const dragging = React.useRef(false);

  const seekFromClientX = (clientX: number, rect: DOMRect) => {
    const v = videoRef.current;
    const dur = (v?.duration || 0) > 0 ? v!.duration : duration;
    if (rect.width <= 0 || dur <= 0) return;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seekTo(frac * dur);
  };

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // primary button only
    dragging.current = true;
    videoRef.current?.pause();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw if the pointer is already gone */
    }
    seekFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
  };

  const onTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    seekFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  if (!src) {
    return (
      <Card title={title} style={parseStyle(style)}>
        <EmptyState label="video-review: missing src" />
      </Card>
    );
  }

  // Round comments render newest round first; verdict keys are "<n>-<idx>".
  const orderedRounds = [...rounds].reverse();

  const pin = (
    key: string,
    cm: VrComment,
    cls: string,
  ): React.ReactNode =>
    duration > 0 ? (
      <button
        key={key}
        type="button"
        className={`ofw-vr__pin ${cls}`}
        style={{ left: `${(cm.t / duration) * 100}%` }}
        title={`${fmt(cm.t)} — ${cm.text}`}
        onClick={() => {
          seekTo(cm.t);
          videoRef.current?.pause();
        }}
      />
    ) : null;

  return (
    <Card title={title} className="ofw-card--vr" style={parseStyle(style)}>
      <div className="ofw-vr" tabIndex={0} onKeyDown={handleKey}>
        <video
          ref={videoRef}
          className="ofw-vr__video"
          src={src}
          playsInline
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={tick}
          onSeeked={tick}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration || 0);
            tick();
          }}
        />

        <div className="ofw-vr__bar">
          <button
            type="button"
            className="ofw-btn ofw-vr__ctl"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <span ref={tcRef} className="ofw-vr__tc">
            00:00.0 / 00:00.0
          </span>
          <span className="ofw-vr__spacer" />
          <span className="ofw-vr__speeds" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={`ofw-btn ofw-vr__ctl${rate === s ? " ofw-vr__ctl--active" : ""}`}
                onClick={() => setSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </span>
          <button type="button" className="ofw-btn ofw-vr__ctl" onClick={openComposer}>
            + Note (C)
          </button>
        </div>

        <div className="ofw-vr__tl">
          <div className="ofw-vr__markers">
            {orderedRounds.map((r) =>
              r.comments.map((cm, idx) => {
                const status = qa[`${r.n}-${idx}`] ?? "pending";
                return pin(
                  `r${r.n}-${idx}`,
                  cm,
                  `ofw-vr__pin--${status}`,
                );
              }),
            )}
            {comments.map((cm, idx) => pin(`c${idx}`, cm, "ofw-vr__pin--open"))}
          </div>
          <div
            className="ofw-vr__track"
            role="slider"
            aria-label="Scrub the video"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={(e) => {
              seekFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
              openComposer();
            }}
          >
            <canvas ref={waveRef} className="ofw-vr__wave" />
            <div ref={fillRef} className="ofw-vr__fill" />
            <div ref={cursorRef} className="ofw-vr__cursor">
              <span className="ofw-vr__knob" />
            </div>
          </div>
        </div>

        <div className="ofw-vr__hint">
          space play · ←/→ ±2s · ,/. frame · 1/2 = 1×/2× speed · C note · drag the bar to scrub · double-click to note there
        </div>

        {composerAt !== null ? (
          <div className="ofw-vr__composer">
            <span className="ofw-vr__at">@ {fmt(composerAt)}</span>
            <textarea
              ref={composerRef}
              className="ofw-input ofw-vr__text"
              value={composerText}
              placeholder="What should change here? e.g. 'cut this sentence' / 'tighten this pause'"
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  saveNote();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setComposerAt(null);
                }
                e.stopPropagation();
              }}
            />
            <div className="ofw-vr__composer-row">
              <button
                type="button"
                className="ofw-btn"
                onClick={() => setComposerAt(null)}
              >
                Cancel (esc)
              </button>
              <button
                type="button"
                className="ofw-btn ofw-btn--primary"
                onClick={saveNote}
                disabled={!composerText.trim()}
              >
                Add note (⌘↵)
              </button>
            </div>
          </div>
        ) : null}

        <div className="ofw-vr__notes">
          {comments.length > 0 ? (
            <div className="ofw-vr__notes-head">
              {comments.length} open note{comments.length === 1 ? "" : "s"}
            </div>
          ) : null}
          {comments.map((cm, idx) => (
            <div key={`c${idx}`} className="ofw-vr__note">
              <button
                type="button"
                className="ofw-vr__t"
                onClick={() => {
                  seekTo(cm.t);
                  videoRef.current?.pause();
                }}
              >
                {fmt(cm.t)}
              </button>
              <span className="ofw-vr__note-text">{cm.text}</span>
              <button
                type="button"
                className="ofw-vr__del"
                aria-label="Delete note"
                onClick={() =>
                  setComments(comments.filter((_, i) => i !== idx))
                }
              >
                ✕
              </button>
            </div>
          ))}

          {orderedRounds.map((r) => {
            const done = r.comments.filter(
              (_, i) => qa[`${r.n}-${i}`] === "approved",
            ).length;
            return (
              <React.Fragment key={`r${r.n}`}>
                <div className="ofw-vr__round-label">
                  round {r.n}
                  {r.label ? ` — ${r.label}` : ""} ({done}/{r.comments.length} done)
                </div>
                {r.comments.map((cm, idx) => {
                  const key = `${r.n}-${idx}`;
                  const status = qa[key] ?? "pending";
                  return (
                    <div
                      key={key}
                      className={`ofw-vr__note ofw-vr__note--qa ofw-vr__note--${status}`}
                    >
                      <button
                        type="button"
                        className="ofw-vr__t ofw-vr__t--past"
                        onClick={() => {
                          seekTo(cm.t);
                          videoRef.current?.pause();
                        }}
                      >
                        {fmt(cm.t)}
                        {status === "approved" ? " ✓" : status === "reflagged" ? " ↺" : ""}
                      </button>
                      <span className="ofw-vr__note-text">{cm.text}</span>
                      {status === "pending" ? (
                        <span className="ofw-vr__qa-actions">
                          <button
                            type="button"
                            className="ofw-vr__qa-btn ofw-vr__qa-btn--approve"
                            onClick={() => approve(key)}
                          >
                            ✓ Looks good
                          </button>
                          <button
                            type="button"
                            className="ofw-vr__qa-btn ofw-vr__qa-btn--reflag"
                            onClick={() => reflag(key, cm)}
                          >
                            ↺ Still needs fix
                          </button>
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: VideoReview,
    props: videoReviewProps,
    description:
      "Timestamped video feedback for agent-made videos — built for the parley loop. Plays a video with a scrub bar (showing an audio waveform of the source), comment pins, and keyboard shortcuts (space play, ←/→ ±2s, ,/. frame step, 1/2 = 1×/2× speed, C note); the human drops timecoded notes ({t, text}) that are written to `param` as an array and stream to the agent via ordinary params events. Past rounds passed in `rounds` get approve / re-flag QA buttons (verdicts written to `qaParam`; a re-flag re-opens the comment into the open array). Pair with a `button` for the explicit submit signal. Feedback params are arrays/objects — never reference them in SQL.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
