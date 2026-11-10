'use client';

import { useRef } from 'react';
import { useAnimeScope } from '@/lib/motion';

const HERO_SEEN_KEY = 'promesa:hero-seen';

function firstVisit(): boolean {
  try {
    if (sessionStorage.getItem(HERO_SEEN_KEY)) return false;
    sessionStorage.setItem(HERO_SEEN_KEY, '1');
    return true;
  } catch {
    return true;
  }
}

/**
 * Hero sculpture: a promise sheet folded over a payment receipt, with a seam that shows the two
 * records drifting apart. Everything here is a labelled specimen, not account data.
 */
export function FoldSpecimen() {
  const root = useRef<HTMLDivElement>(null);

  useAnimeScope(
    root,
    ({ createTimeline, createDrawable, stagger }) => {
      if (!firstVisit()) return;
      createTimeline({ defaults: { ease: 'out(4)' } })
        .add('[data-sheet]', {
          opacity: [0, 1],
          translateY: [28, 0],
          duration: 900,
          delay: stagger(110),
        })
        .add(
          createDrawable('[data-thread]'),
          { draw: ['0 0', '0 1'], duration: 900, ease: 'inOut(2)' },
          '-=450',
        )
        .add('[data-fault]', { translateY: [0, 7], duration: 520, ease: 'out(3)' }, '-=200')
        .add('[data-note]', { opacity: [0, 1], translateX: [-8, 0], duration: 420 }, '-=300');
    },
    'hero',
  );

  return (
    <div ref={root} className="relative mx-auto aspect-[5/6] w-full max-w-[460px]" aria-hidden>
      {/* Receipt: the payment record */}
      <div
        data-sheet
        data-rot="5"
        style={{ rotate: '5deg' }}
        className="sheet perforated absolute right-0 top-[6%] w-[62%] px-5 pb-6 pt-7 font-mono text-[11px] leading-relaxed text-muted"
      >
        <p className="tracking-[0.18em] text-ink">PAYMENT RECORD</p>
        <div className="rule-dotted my-3" />
        <div className="flex justify-between">
          <span>Status</span>
          <span className="text-good">● Completed</span>
        </div>
        <div className="flex justify-between">
          <span>Amount</span>
          <span className="text-ink">$85.00 USD</span>
        </div>
        <div className="flex justify-between">
          <span>Merchant</span>
          <span>Kraftfold</span>
        </div>
        <div className="rule-dotted my-3" />
        <p className="text-[10px] uppercase tracking-[0.16em]">Specimen · not a transaction</p>
      </div>

      {/* Promise sheet: what the buyer actually needed */}
      <div
        data-sheet
        data-rot="-3"
        style={{ rotate: '-3deg' }}
        className="sheet sheet-folded absolute left-0 top-[24%] w-[78%] overflow-hidden"
      >
        <div className="px-6 pb-4 pt-6">
          <p className="kicker">Promise · confirmed intent</p>
          <p className="font-display mt-2 text-[26px] leading-[1.1] text-ink">
            100 food-safe paper boxes
          </p>
          <ul className="mt-3 space-y-1 text-[13px] text-ink">
            <li>Before Fri, 5:00 PM ET</li>
            <li>Under $100.00</li>
            <li>No plastic</li>
          </ul>
        </div>
        <div className="seam mx-6" />
        <div
          data-fault
          style={{ transform: 'translateY(7px)' }}
          className="bg-paper-2 px-6 pb-7 pt-4"
        >
          <p className="kicker">Reality · seller update</p>
          <p className="mt-2 text-[13px] text-caution">
            ▲ Delivery estimate moved to Mon, 12:00 PM ET
          </p>
        </div>
      </div>

      {/* Threads tying the records together */}
      <svg
        viewBox="0 0 460 552"
        className="pointer-events-none absolute inset-0 size-full"
        fill="none"
      >
        <path
          data-thread
          d="M330 120 C 300 190, 250 200, 240 250"
          stroke="var(--signal)"
          strokeWidth="1.4"
        />
        <path
          data-thread
          d="M360 200 C 380 330, 320 420, 250 470"
          stroke="var(--caution)"
          strokeWidth="1.4"
          strokeDasharray="4 5"
        />
        <circle cx="240" cy="250" r="3.5" fill="var(--signal)" />
        <circle cx="250" cy="470" r="3.5" fill="var(--caution)" />
      </svg>

      <p data-note className="kicker absolute bottom-[3%] left-[4%]">
        Payment ✓ · Promise ▲
      </p>
    </div>
  );
}
