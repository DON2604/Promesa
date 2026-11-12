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
      <main id="main" className="mx-auto max-w-[1100px] px-5 pb-24 pt-14 sm:px-8">
        <Kicker>Sign in</Kicker>
        <h1 className="font-display mt-3 text-[clamp(2rem,4.4vw,3.4rem)] leading-[1.04]">
          One mission, many people.
        </h1>
        <p className="mt-4 max-w-2xl text-[16px] text-muted">
          Organizations post needs, sponsors fund specific merchant orders through PayPal, and
          merchants fulfil them. Each person signs in with their own account. The organizations are
          fictional and seeded for this Sandbox environment.
        </p>
        <div className="mt-10">
          <Suspense fallback={<LoadingSheet label="Loading sign-in" />}>
            <PersonaPicker />
          </Suspense>
        </div>
      </main>
    </>
  );
}
