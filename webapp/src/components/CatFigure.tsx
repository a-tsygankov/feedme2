import type { Pose } from "../lib/pose.ts";

interface Props {
  pose: Pose;
  color: string;
  /** Rendered width and height in CSS px. The masks are 256 px, so keep this <= 128 to stay sharp at 2x DPR. */
  size?: number;
  className?: string;
  /** Accessible name. Omit when the figure is decorative (a neighbouring text already names the cat). */
  label?: string;
}

/** The silhouette as a CSS mask, tinted with the cat's colour, so one
 * black master serves every cat on both themes. */
export function CatFigure({ pose, color, size = 96, className, label }: Props) {
  const url = `url(/cats/${pose}.png)`;
  return (
    <div
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      data-testid="cat-figure"
      data-pose={pose}
      className={className}
      style={{
        width: size, height: size, backgroundColor: color,
        display: "block", flexShrink: 0,
        // Forced-colors mode would repaint the background and show a solid square instead of the cat.
        forcedColorAdjust: "none",
        WebkitMaskImage: url, maskImage: url,
        WebkitMaskSize: "contain", maskSize: "contain",
        WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
        WebkitMaskPosition: "center", maskPosition: "center",
      }}
    />
  );
}
