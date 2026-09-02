// A small set of restrained, geometric line icons. No fills, no decoration —
// typography should carry more of the interface than icons ever do here.
import type { SVGProps } from "react";

function Base(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={16}
      height={16}
      {...props}
    />
  );
}

export function IconProjects(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" />
      <rect x="13.5" y="3.5" width="7" height="7" />
      <rect x="3.5" y="13.5" width="7" height="7" />
      <rect x="13.5" y="13.5" width="7" height="7" />
    </Base>
  );
}

export function IconArchive(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="3.5" y="4" width="17" height="4.5" />
      <path d="M4.5 8.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8.5" />
      <path d="M10 13h4" />
    </Base>
  );
}

export function IconMemory(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="6" r="2" />
      <circle cx="6" cy="15" r="2" />
      <circle cx="18" cy="15" r="2" />
      <path d="M12 8v3M10.3 10.7 7.7 13.3M13.7 10.7l2.6 2.6M8 15h8" />
    </Base>
  );
}

export function IconImageLab(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17.5 9.5 12l3 3 3.5-4L20 15" />
    </Base>
  );
}

export function IconCouncil(props: SVGProps<SVGSVGElement>) {
  // Three sources converging — the Magi motif, kept subtle.
  return (
    <Base {...props}>
      <circle cx="12" cy="4.5" r="1.4" />
      <circle cx="4.5" cy="18" r="1.4" />
      <circle cx="19.5" cy="18" r="1.4" />
      <path d="M12 6v5M4.9 17 11.3 11.7M19.1 17 12.7 11.7" />
      <circle cx="12" cy="12.5" r="1.2" />
    </Base>
  );
}

export function IconSkills(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M14.5 4.5a3.5 3.5 0 0 0-4.6 4.6L4.5 14.5v2h2l5.4-5.4a3.5 3.5 0 0 0 4.6-4.6l-2.3 2.3-2-2z" />
    </Base>
  );
}

export function IconSettings(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 4v2.2M12 17.8V20M4 12h2.2M17.8 12H20M6.3 6.3l1.6 1.6M16.1 16.1l1.6 1.6M17.7 6.3l-1.6 1.6M7.9 16.1l-1.6 1.6" />
    </Base>
  );
}

export function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15 20 20" />
    </Base>
  );
}

export function IconCommand(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M8 6.5A1.5 1.5 0 1 1 9.5 8H8V6.5ZM16 6.5A1.5 1.5 0 1 0 14.5 8H16V6.5ZM8 17.5A1.5 1.5 0 1 0 9.5 16H8v1.5ZM16 17.5a1.5 1.5 0 1 1-1.5-1.5H16v1.5Z" />
      <rect x="8" y="8" width="8" height="8" />
    </Base>
  );
}

export function IconPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function IconSend(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4.5 12 19.5 5 13 19.5l-2-6.5-6.5-2Z" />
    </Base>
  );
}

export function IconSun(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </Base>
  );
}

export function IconMoon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.4 6.4 0 0 0 10.5 10.5Z" />
    </Base>
  );
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M5 7h14M9.5 7V5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M7 7l1 12.5a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9L17 7" />
    </Base>
  );
}

export function IconChevronRight(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="m9 5 7 7-7 7" />
    </Base>
  );
}

export function IconChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="m5 9 7 7 7-7" />
    </Base>
  );
}

export function IconLayers(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="m12 3.5 8 4.3-8 4.3-8-4.3 8-4.3ZM4 12l8 4.3 8-4.3M4 15.8l8 4.3 8-4.3" />
    </Base>
  );
}

export function IconDocument(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Z" />
      <path d="M14 3.5V8h4M9 12h6M9 15.5h6" />
    </Base>
  );
}

export function IconAttach(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M17 8.5 9.5 16a2.6 2.6 0 0 1-3.7-3.7L14 4.2a1.8 1.8 0 0 1 2.6 2.6L9 14.4a1 1 0 0 1-1.4-1.4l6.7-6.7" />
    </Base>
  );
}

export function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9.5h12V10" />
    </Base>
  );
}

export function IconStop(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
    </Base>
  );
}

export function IconRefresh(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M19 12a7 7 0 1 1-2.1-5" />
      <path d="M19 5.5V10h-4.5" />
    </Base>
  );
}

export function IconHistory(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12.5" r="7.5" />
      <path d="M12 8.5v4.3l3 2" />
      <path d="M9 3.5 5.5 6M15 3.5 18.5 6" />
    </Base>
  );
}

export function IconDownload(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12 4v10.5M8 11l4 4 4-4" />
      <path d="M5 17.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1.5" />
    </Base>
  );
}

export function IconPin(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12 21s-6.5-6.2-6.5-11A6.5 6.5 0 0 1 12 3.5 6.5 6.5 0 0 1 18.5 10c0 4.8-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.2" />
    </Base>
  );
}

export function IconPeople(props: SVGProps<SVGSVGElement>) {
  // Two figures, one behind the other — a rolodex of people you know, not a
  // single contact card.
  return (
    <Base {...props}>
      <circle cx="9.5" cy="8.5" r="3" />
      <path d="M4 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M15.5 6.2a3 3 0 0 1 0 5.6" />
      <path d="M17 14.9c1.9.6 3 2.3 3 4.6" />
    </Base>
  );
}

export function IconEdit(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 20l1-4.5L16.5 4l3.5 3.5L8.5 19 4 20Z" />
      <path d="M14 6.5 17.5 10" />
    </Base>
  );
}
