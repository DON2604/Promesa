'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type * as Anime from 'animejs';

type AnimeModule = typeof Anime;

// Start fetching the motion chunk as soon as a motion component is evaluated in the browser, so
// the reveal runs right after hydration instead of after a second network round-trip.
let animePromise: Promise<AnimeModule> | null = null;
export function loadAnime(): Promise<AnimeModule> {
  animePromise ??= import('animejs');
  return animePromise;
}

/** Motion is decorative: skipped for reduced-motion, data-saver, and hidden tabs. */
export function motionAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return false;
  return document.visibilityState === 'visible';
}

/**
 * Runs an Anime.js scope against `root` once per `key` change. Content is fully visible without
 * this effect; animations only start from offsets and always end at the natural layout.
 */
export function useAnimeScope(
  root: RefObject<HTMLElement | SVGElement | null>,
  setup: (anime: AnimeModule) => void,
  key: unknown,
  enabled = true,
) {
  const setupRef = useRef(setup);
  setupRef.current = setup;

  useEffect(() => {
    if (!enabled || !root.current || !motionAllowed()) return;
    let cancelled = false;
    let revert: (() => void) | undefined;
    void loadAnime().then((anime) => {
      if (cancelled || !root.current) return;
      const scope = anime.createScope({ root: root.current as HTMLElement }).add(() => {
        setupRef.current(anime);
      });
      revert = () => scope.revert();
    });
    return () => {
      cancelled = true;
      revert?.();
    };
  }, [root, key, enabled]);
}
