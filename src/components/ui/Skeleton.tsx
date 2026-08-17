import styles from "./Skeleton.module.css";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function Skeleton({
  width = "100%",
  height = 16,
  className,
}: SkeletonProps) {
  return (
    <span
      className={[styles.skeleton, className ?? ""].filter(Boolean).join(" ")}
      style={{ width, height }}
      aria-hidden
    />
  );
}
