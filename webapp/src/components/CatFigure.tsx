import type { Pose } from "../lib/pose.ts";

interface Props {
  pose: Pose;
  color: string;
  size?: number;
  className?: string;
  title?: string;
}

/** The silhouette as a CSS mask, tinted with the cat's colour, so one
 * black master serves every cat on both themes. */
export function CatFigure({ pose, color, size = 96, className, title }: Props) {
  const url = `url(/cats/${pose}.png)`;
  return (
    <div
      role="img"
      aria-label={title ?? `cat pose ${pose}`}
      data-testid="cat-figure"
      data-pose={pose}
      className={className}
      style={{
        width: size, height: size, backgroundColor: color,
        WebkitMaskImage: url, maskImage: url,
        WebkitMaskSize: "contain", maskSize: "contain",
        WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
        WebkitMaskPosition: "center", maskPosition: "center",
      }}
    />
  );
}
