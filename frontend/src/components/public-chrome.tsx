import Link from 'next/link';
import { Wordmark } from './brand';
import { ButtonLink } from './ui';

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-paper">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-8">
        <Wordmark />
        <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-3">
          <Link
            href="/explore"
            className="hidden rounded-md px-3 py-2 text-sm text-muted hover:text-ink sm:inline-flex"
          >
            Explore missions
          </Link>
          <Link
            href="/how-it-works"
            className="hidden rounded-md px-3 py-2 text-sm text-muted hover:text-ink sm:inline-flex"
          >
            How it works
          </Link>
          <ButtonLink href="/sign-in" size="sm" variant="primary">
            Sign in to demo
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="mt-24 border-t border-hairline bg-paper">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-12 text-sm text-muted sm:grid-cols-[1.2fr_1fr] sm:px-8">
        <div className="space-y-3">
          <Wordmark />
          <p className="max-w-md">
            Built for the PayPal AI Hackathon. This is a demonstration environment: merchants,
            organizations and fulfillment events are fictional and clearly labelled. No real money
            moves.
          </p>
        </div>
        <div className="space-y-2 sm:text-right">
          <p>
            PayPal is the payment system of record. NeedMesh does not hold funds, pool donations,
            provide escrow, or guarantee refunds, and is not an official PayPal product. Refunds are
            issued by merchants through PayPal.
          </p>
          <p className="kicker">NeedMesh · PromiseTwin protection built in</p>
        </div>
      </div>
    </footer>
  );
}
