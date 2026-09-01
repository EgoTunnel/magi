import type { SVGProps } from "react";
import { IconCouncil } from "@/components/icons";

// A continuously-rotating IconCouncil — the "the Council is deliberating"
// indicator, the Council-specific counterpart to MagiSpinner (see
// globals.css for the shared animation itself).
export function CouncilSpinner({ className = "", ...rest }: SVGProps<SVGSVGElement>) {
  return <IconCouncil width={14} height={14} {...rest} className={`magi-spinner ${className}`} />;
}
