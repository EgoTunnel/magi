import type { SVGProps } from "react";

// Three independent strokes — two verticals and a diagonal chevron — that
// resolve into an abstract M. Drawn on a 24x24 grid with a built-in 2-unit
// margin; the outer strokes stop short of the chevron's shoulders so the
// three elements stay visibly distinct rather than fusing into a solid M.
export function MagiMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      width={20}
      height={20}
      {...props}
    >
      <path d="M4 5L4 19M20 5L20 19M7.5 8L12 14L16.5 8" />
    </svg>
  );
}
