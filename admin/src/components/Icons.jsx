export function CopyIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-9A1.5 1.5 0 0 0 4 6.5v9A1.5 1.5 0 0 0 5.5 17H8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function EyeIcon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.7 12s3.4-6 9.3-6 9.3 6 9.3 6-3.4 6-9.3 6-9.3-6-9.3-6Z" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function LinkIcon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m9.4 14.6 5.2-5.2M7.4 17.7l-1.1 1.1a3.4 3.4 0 0 1-4.8-4.8l3.2-3.2a3.4 3.4 0 0 1 4.8 0M16.6 6.3l1.1-1.1a3.4 3.4 0 0 1 4.8 4.8l-3.2 3.2a3.4 3.4 0 0 1-4.8 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function UploadIcon({ size = 42 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M28 9H14a3 3 0 0 0-3 3v24a3 3 0 0 0 3 3h20a3 3 0 0 0 3-3V18l-9-9Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M28 9v9h9M24 33V23m0 0-4 4m4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon({ size = 21 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m7 9.5 5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MoreIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  );
}

export function SearchIcon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.6" />
      <path d="m16 16 4.2 4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function FileMark({ type }) {
  return (
    <span className={`file-mark file-mark--${type}`} aria-hidden="true">
      <span className="file-mark__fold" />
      <span className="file-mark__label">{type.toUpperCase()}</span>
    </span>
  );
}

export function CheckIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12.5 4.4 4.4L19 7.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowUpRightIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OverviewIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function PagesIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="3.5" width="16" height="17" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function PlatformIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m8 10 4 2.2 4-2.2M12 12.2V17" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function MenuIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function SignOutIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10M14.5 8l4 4-4 4M9 12h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GlobeIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.8 12h16.4M12 3.5c2.2 2.4 3.3 5.2 3.3 8.5S14.2 18.1 12 20.5M12 3.5C9.8 5.9 8.7 8.7 8.7 12s1.1 6.1 3.3 8.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function LockIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="10" width="15" height="10.5" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10M12 14.2v2.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function StorageIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <ellipse cx="12" cy="6" rx="7.5" ry="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

