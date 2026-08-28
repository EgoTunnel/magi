import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@/components/shell/ThemeScript";
import { Sidebar } from "@/components/shell/Sidebar";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";

const fontUi = IBM_Plex_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const fontEditorial = Source_Serif_4({
  variable: "--font-editorial",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const fontTechnical = IBM_Plex_Mono({
  variable: "--font-technical",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Magi — a personal instrument for thinking",
  description: "A persistent personal AI environment. Ancient values, new machinery.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontUi.variable} ${fontEditorial.variable} ${fontTechnical.variable} h-full`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="h-full antialiased">
        <WorkspaceShell sidebar={<Sidebar />}>{children}</WorkspaceShell>
      </body>
    </html>
  );
}
