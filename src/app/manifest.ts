import type { MetadataRoute } from "next";

// Lets Edge/Chrome's "Install this site as an app" create a properly
// identified installed app — the one thing that makes taskbar pinning
// actually stick. A shortcut that launches a script which then spawns a
// --app= browser window (see scripts/desktop/) has no stable app identity
// for Windows to bind a pin to, so pinning it just grabs whatever Edge is
// doing generically; an installed PWA is a first-class OS-registered app
// instead, with its own icon and identity.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Magi",
    short_name: "Magi",
    description: "A personal instrument for thinking",
    start_url: "/",
    display: "standalone",
    background_color: "#16130e",
    theme_color: "#16130e",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
