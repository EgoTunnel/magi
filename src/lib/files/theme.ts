import type { Project } from "@/lib/repo/projects";

// Shared across markdownToDocx/Pptx/Xlsx.ts — a Project's brand_* columns,
// normalized into the shape those converters actually consume. Colors are
// plain hex without a leading '#', matching the format each converter's
// own hardcoded defaults already use (e.g. "1F3864").
export interface DocumentTheme {
  headingFont?: string;
  bodyFont?: string;
  headingColor?: string;
  bodyColor?: string;
  accentColor?: string;
  // headingColor applies only to the top-level heading (H1 / a slide's
  // title); subtitleColor covers H2 and deeper.
  subtitleColor?: string;
  // Table header row text color.
  labelColor?: string;
  secondaryAccentColor?: string;
}

function hex(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim().replace(/^#/, "");
  return trimmed || undefined;
}

function font(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

type BrandFields = Pick<
  Project,
  | "brand_heading_font"
  | "brand_body_font"
  | "brand_primary_color"
  | "brand_accent_color"
  | "brand_text_color"
  | "brand_subtitle_color"
  | "brand_label_color"
  | "brand_secondary_accent_color"
>;

// pick() takes the first defined value for `key` walking the chain in order
// — a lone Project, or [Project, ...ancestors nearest-first] for a branch
// that inherits whatever its own brand guide leaves unset. Returns undefined
// when nothing in the chain has a brand guide at all, so callers can cheaply
// fall back to a converter's own built-in defaults.
export function projectTheme(chain: BrandFields | BrandFields[]): DocumentTheme | undefined {
  const projects = Array.isArray(chain) ? chain : [chain];
  const pickHex = (key: keyof BrandFields) => {
    for (const p of projects) {
      const v = hex(p[key]);
      if (v) return v;
    }
    return undefined;
  };
  const pickFont = (key: keyof BrandFields) => {
    for (const p of projects) {
      const v = font(p[key]);
      if (v) return v;
    }
    return undefined;
  };
  const theme: DocumentTheme = {
    headingFont: pickFont("brand_heading_font"),
    bodyFont: pickFont("brand_body_font"),
    headingColor: pickHex("brand_primary_color"),
    bodyColor: pickHex("brand_text_color"),
    accentColor: pickHex("brand_accent_color"),
    subtitleColor: pickHex("brand_subtitle_color"),
    labelColor: pickHex("brand_label_color"),
    secondaryAccentColor: pickHex("brand_secondary_accent_color"),
  };
  const hasAny = Object.values(theme).some((v) => v !== undefined);
  return hasAny ? theme : undefined;
}
