'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Browser speech-to-text (Web Speech API). Audio is handled by the browser; NeedMesh only receives
 * the transcript, which goes through the same intent compiler and confirmation as typed text.
 */
export function VoiceInput({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => setSupported(recognitionCtor() !== null), []);

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = 'en-US';
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const text = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (text) onTranscript(text);
    };
    r.onerror = (e) =>
      setError(
        e.error === 'not-allowed'
          ? 'Microphone permission was denied.'
          : `Voice input failed (${e.error}).`,
      );
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    setListening(true);
    r.start();
  };

  if (!supported)
    return (
      <span className="text-[11px] text-muted">
        Voice input needs a browser with the Web Speech API (Chrome or Edge).
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        className={clsx(
          'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs',
          listening
            ? 'border-breach bg-breach-soft text-breach'
            : 'border-hairline-strong text-ink hover:border-signal',
        )}
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
          <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
        </svg>
        {listening ? 'Listening… tap to stop' : 'Speak the need'}
      </button>
      {error ? (
        <span role="alert" className="text-[11px] text-breach">
          {error}
        </span>
      ) : null}
    </span>
  );
}
