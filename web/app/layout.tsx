import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { StoreProvider } from "@/lib/store";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "NeuroLens — evidence workspace",
    template: "%s · NeuroLens",
  },
  description:
    "Research-grade audit workspace for neurodegenerative disease progression models: prediction, reliability, explainability, and fairness auditability.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#16191b",
};

/**
 * Geist is loaded through the `geist` package, which wraps next/font/local with
 * its own bundled WOFF2 files.
 *
 * That is a deliberate choice, not a stylistic one: next/font/google fetches at
 * build time, and this project builds in environments with no route to
 * fonts.googleapis.com. A build-time font fetch that can fail is how a design
 * system ends up specifying a typeface the product never actually renders --
 * which is exactly what happened to the previous IBM Plex specification. The
 * bundled files make the font a normal dependency with a version and a licence.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        {/*
          Runs before first paint to set the theme class.

          This has to be an inline blocking script rather than an effect: if the
          class were applied after hydration, a returning dark-mode user would
          see a white flash on every navigation. Reading localStorage and the
          media query here means the correct theme is on <html> before anything
          renders. suppressHydrationWarning on <html> covers the class differing
          from the server render.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("neurolens-theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;var r=document.documentElement;r.classList.toggle("dark",d);r.classList.toggle("light",!d);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
