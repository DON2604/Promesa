import { PublicHeader } from '@/components/public-chrome';
import { ButtonLink, Kicker } from '@/components/ui';

export default function NotFound() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <Kicker>404</Kicker>
        <h1 className="font-display mt-3 text-4xl">There is no promise on this page.</h1>
        <p className="mt-3 text-muted">
          The address may be mistyped, or the record belongs to another workspace.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <ButtonLink href="/">Home</ButtonLink>
          <ButtonLink href="/dashboard" variant="secondary">
            Overview
          </ButtonLink>
        </div>
      </main>
    </>
  );
}
