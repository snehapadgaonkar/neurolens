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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen antialiased">
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
