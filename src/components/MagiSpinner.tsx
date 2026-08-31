import type { SVGProps } from "react";
import { MagiMark } from "@/components/MagiMark";

// A continuously-rotating MagiMark — the "Magi is working" indicator, used
// anywhere a request is in flight and there's otherwise nothing on screen
// to signal progress (see globals.css for the animation itself).
export function MagiSpinner({ className = "", ...rest }: SVGProps<SVGSVGElement>) {
  return <MagiMark width={14} height={14} {...rest} className={`magi-spinner ${className}`} />;
}
