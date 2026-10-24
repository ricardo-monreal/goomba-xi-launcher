// Goomba XI mark: a crystal inside a broken ring, with a spark of light. Original artwork.
export default function BrandMark({ className = 'brand-mark', title }: { className?: string; title?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id="gxi-crystal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3d6" />
          <stop offset="0.45" stopColor="#f5c46d" />
          <stop offset="1" stopColor="#c46f1e" />
        </linearGradient>
        <linearGradient id="gxi-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9aa4ff" />
          <stop offset="1" stopColor="#3b437d" />
        </linearGradient>
      </defs>
      {/* ring, open at the top and bottom where the crystal passes through */}
      <path d="M26.5 8.6 A24 24 0 0 0 26.5 55.4 L27.6 50.5 A19 19 0 0 1 27.6 13.5 Z" fill="url(#gxi-ring)" />
      <path d="M37.5 8.6 A24 24 0 0 1 37.5 55.4 L36.4 50.5 A19 19 0 0 0 36.4 13.5 Z" fill="url(#gxi-ring)" />
      {/* crystal */}
      <path d="M32 4 L41 30 L32 60 L23 30 Z" fill="url(#gxi-crystal)" />
      <path d="M32 4 L32 60 L23 30 Z" fill="#ffffff" opacity="0.22" />
      {/* spark */}
      <path d="M50 10 L51.2 13.8 L55 15 L51.2 16.2 L50 20 L48.8 16.2 L45 15 L48.8 13.8 Z" fill="#fff3d6" />
    </svg>
  )
}
