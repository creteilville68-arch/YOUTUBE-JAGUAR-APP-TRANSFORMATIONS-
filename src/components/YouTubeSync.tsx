import { useEffect, useRef, useState } from "react";
import { speak, stopSpeaking } from "../lib/speech";

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          videoId: string;
          playerVars?: Record<string, unknown>;
          events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void };
        },
      ) => {
        seekTo: (s: number, allowSeekAhead: boolean) => void;
        playVideo: () => void;
        pauseVideo: () => void;
        getCurrentTime: () => number;
        getPlayerState: () => number;
        destroy: () => void;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type Sent = { target: string; native: string };

function ensureYouTubeApi(): Promise<NonNullable<Window["YT"]>> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.getElementById("yt-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "yt-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }
  });
}

export function YouTubeSync({
  videoId,
  sentences,
  timeMap,
  langCode,
}: {
  videoId: string;
  sentences: Sent[];
  timeMap: { start: number; text: string }[];
  langCode: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<{ destroy?: () => void } | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const timings = timeMap.length === sentences.length ? timeMap : [];

  useEffect(() => {
    let cancelled = false;
    void ensureYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new YT.Player(containerRef.current, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: () => setReady(true),
          onStateChange: (e) => setPlaying(e.data === 1),
        },
      });
    });
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy?.();
      } catch {
        // player already gone
      }
    };
  }, [videoId]);

  useEffect(() => {
    if (!ready || timings.length === 0) return;
    const iv = setInterval(() => {
      const p = playerRef.current as unknown as { getCurrentTime?: () => number } | null;
      if (!p?.getCurrentTime) return;
      const t = p.getCurrentTime();
      let idx = -1;
      for (let i = 0; i < timings.length; i++) {
        if (t + 0.25 >= timings[i].start) idx = i;
      }
      setActiveIdx(idx);
    }, 400);
    return () => clearInterval(iv);
  }, [ready, timings]);

  function seek(i: number) {
    if (timings.length === 0) return;
    const p = playerRef.current as unknown as {
      seekTo?: (s: number, a: boolean) => void;
      playVideo?: () => void;
    } | null;
    if (!p?.seekTo) return;
    stopSpeaking();
    p.seekTo(Math.max(0, timings[i].start - 0.2), true);
    p.playVideo?.();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="lg:sticky lg:top-20 lg:self-start">
        <div className="overflow-hidden rounded-2xl border border-paper-200 bg-ink-900 shadow-sm">
          <div ref={containerRef} className="aspect-video w-full" />
        </div>
        <p className="mt-2 text-xs text-ink-400">
          Clique em qualquer frase para pular para o momento exato do vídeo.
        </p>
      </div>
      <div className="space-y-1.5">
        {sentences.map((s, i) => {
          const active = i === activeIdx && playing;
          return (
            <button
              key={i}
              onClick={() => seek(i)}
              className={`block w-full rounded-xl px-3.5 py-2.5 text-left transition ${
                active
                  ? "bg-terracotta-50 ring-1 ring-terracotta-400"
                  : "hover:bg-paper-100"
              }`}
            >
              <p className={`font-serif text-base leading-snug ${active ? "text-terracotta-600" : "text-ink-900"}`}>
                {s.target}
              </p>
              <p className="mt-0.5 text-xs text-ink-400">{s.native}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
