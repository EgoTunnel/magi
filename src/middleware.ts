import { NextRequest, NextResponse } from "next/server";

// Magi has no authentication, by design: it is a single-user instrument that
// runs on your own machine, and its SQLite database holds your API keys, your
// archive, and everything you have ever told it.
//
// That is entirely safe on localhost and entirely unsafe anywhere else. It is
// a Next.js app, so the obvious thing for someone to do with it is deploy it —
// at which point their keys are readable and anyone who finds the URL can
// spend their money and read their archive. The same applies, more quietly, to
// `next dev -H 0.0.0.0` on a shared network.
//
// So requests are refused unless they arrived at a loopback address. Setting
// MAGI_ALLOW_REMOTE=1 opts out, for the person who genuinely wants Magi on a
// home server behind their own auth and has decided that deliberately.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

function hostnameOf(host: string): string {
  // Strips the port, keeping bracketed IPv6 literals intact.
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1).toLowerCase();
  return host.split(":")[0]!.toLowerCase();
}

export function middleware(request: NextRequest) {
  if (process.env.MAGI_ALLOW_REMOTE === "1") return NextResponse.next();

  const host = request.headers.get("host");
  // No Host header at all is not something a browser does; treat it as
  // untrusted rather than guessing.
  if (host && LOOPBACK_HOSTS.has(hostnameOf(host))) return NextResponse.next();

  return new NextResponse(
    "Magi refused this request because it did not arrive on localhost.\n\n" +
      "Magi has no authentication and holds your API keys and your entire archive, so it is meant to " +
      "run on your own machine and be reached at http://localhost:3000.\n\n" +
      "If you are deliberately running Magi somewhere else and have put your own authentication in " +
      "front of it, set MAGI_ALLOW_REMOTE=1 to disable this check.\n",
    { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}

export const config = {
  // Everything except Next's own static assets, which carry nothing sensitive
  // and are not worth the per-request check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
