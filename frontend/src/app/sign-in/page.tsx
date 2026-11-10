import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PublicHeader } from '@/components/public-chrome';
import { Kicker, LoadingSheet } from '@/components/ui';
import { PersonaPicker } from './persona-picker';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-[1000px] px-5 pb-24 pt-14 sm:px-8">
        <Kicker>Demo identity</Kicker>
        <h1 className="font-display mt-3 text-[clamp(2rem,4.4vw,3.4rem)] leading-[1.04]">
          Choose who you are today.
        </h1>
        <p className="mt-4 max-w-2xl text-[16px] text-muted">
          These are fictional people in fictional organisations, provisioned by the demo seed.
          Signing in sets a short-lived, HTTP-only session cookie. Production uses a real identity
          provider instead.
        </p>
        <div className="mt-10">
          <Suspense fallback={<LoadingSheet label="Loading personas" />}>
            <PersonaPicker />
          </Suspense>
        </div>
      </main>
    </>
  );
}
