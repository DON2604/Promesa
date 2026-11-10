import Link from 'next/link';
import clsx from 'clsx';

/** NeedMesh mark: three nodes (need, merchants, recipient) joined into one mesh. */
export function NeedMeshMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={clsx('size-7', className)}>
      <path
        d="M16 6 7 22M16 6l9 16M7 22h18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M16 6 16 22M7 22 16 22" stroke="var(--signal)" strokeWidth="1.6" fill="none" />
      <circle cx="16" cy="6" r="3.2" fill="var(--paper)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7" cy="22" r="3.2" fill="var(--paper)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="25" cy="22" r="3.2" fill="var(--paper)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="22" r="2.2" fill="var(--signal)" />
    </svg>
  );
}

/** Promesa mark: a folded sheet whose crease doubles as a seam between promise and outcome. */
export function PromesaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={clsx('size-7', className)}>
      <path
        d="M6 5h14l6 6v16H6z"
        fill="var(--paper)"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M20 5v6h6"
        fill="var(--cutout)"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 17.5h12" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 20.5h12" stroke="var(--signal)" strokeWidth="1.6" />
    </svg>
  );
}

export function Wordmark({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={clsx('inline-flex items-center gap-2 text-ink', className)}
      aria-label="NeedMesh home"
    >
      <NeedMeshMark />
      <span className="font-display text-[21px] font-medium tracking-tight">NeedMesh</span>
    </Link>
  );
}
