interface BrandMarkProps {
  size?: number;
  className?: string;
}

/**
 * Crisp brand mark for UI lockups.
 * Uses 512/1024 sources — never asks the browser to invent pixels.
 */
export function BrandMark({ size = 56, className }: BrandMarkProps) {
  const display = Math.min(Math.max(size, 24), 128);

  return (
    <img
      className={className}
      src="/assets/axm-mark.png"
      srcSet="/assets/axm-mark-512.png 512w, /assets/axm-mark.png 1024w"
      sizes={`${display}px`}
      width={display}
      height={display}
      alt=""
      decoding="async"
      draggable={false}
    />
  );
}
