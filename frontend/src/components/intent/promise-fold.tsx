'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { loadAnime, motionAllowed, useAnimeScope } from '@/lib/motion';
import { Chip, Kicker } from '@/components/ui';

/**
 * Promise Fold: the compiled intent arrives as a folded contract. Unfolding reveals the editable
 * constraints. The editor is a normal disclosure (aria-expanded/controls) and works without motion.
 */
export function PromiseFold({
  summary,
  status,
  children,
}: {
  summary: ReactNode;
  status: 'complete' | 'incomplete';
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(status === 'incomplete');

  useAnimeScope(
    root,
    ({ animate }) => {
      animate('[data-fold-face]', {
        rotateX: [-62, 0],
        opacity: [0, 1],
        translateY: [-10, 0],
        duration: 760,
        ease: 'out(4)',
      });
    },
    'arrive',
  );

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && motionAllowed()) {
      void loadAnime().then(({ animate }) => {
        if (!panel.current) return;
        animate(panel.current, {
          rotateX: [-80, 0],
          opacity: [0, 1],
          duration: 560,
          ease: 'out(3)',
        });
      });
    }
  };

  return (
    <div ref={root} className="fold-stage">
      <div data-fold-face className="fold-flap sheet sheet-folded">
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <Kicker>Step 2 · The promise, as Promesa understood it</Kicker>
            {status === 'complete' ? (
              <Chip tone="good">Complete</Chip>
            ) : (
              <Chip tone="caution">Needs input</Chip>
            )}
          </div>
          <div className="mt-3">{summary}</div>
        </div>
        <div className="seam mx-5 sm:mx-6" />
        <div className="px-5 py-3 sm:px-6">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-panel`}
            onClick={toggle}
            className="inline-flex items-center gap-2 text-sm font-medium text-ink underline-offset-4 hover:underline"
          >
            <span
              aria-hidden
              className="inline-block transition-transform duration-[var(--dur-base)]"
              style={{ transform: open ? 'rotate(180deg)' : 'none' }}
            >
              ▾
            </span>
            {open ? 'Fold constraints' : 'Unfold to edit constraints'}
          </button>
        </div>
        <div className="fold-stage">
          <div
            ref={panel}
            id={`${id}-panel`}
            hidden={!open}
            className="fold-flap border-t border-dashed border-hairline-strong bg-paper-2 px-5 pb-6 pt-5 sm:px-6"
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
