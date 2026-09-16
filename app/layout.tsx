import type { Metadata } from "next";
import { Rubik, Source_Serif_4, Anybody } from "next/font/google";
import "./globals.css";

const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const serif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
});

// Display font with width axis — used for the CMPNDR wordmark.
const displayWide = Anybody({
  variable: "--font-display-wide",
  subsets: ["latin"],
  weight: ["900"],
});

export const metadata: Metadata = {
  title: "Lens",
  description: "A picks-and-shovels investing dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${rubik.variable} ${serif.variable} ${displayWide.variable} h-full antialiased`}
    >
      <body className="bg-zinc-950 text-zinc-100 min-h-screen">
        {/* Pre-hydration cover: with ?onboarding=1, paint white before React
            hydrates so the dashboard doesn't flash before the onboarding overlay
            mounts. Loaded as an external, render-blocking <script src> (not inline)
            so it executes during HTML parse, before the dashboard markup paints —
            and because it has a src (no inline content) it doesn't trip React 19's
            script warning. Onboarding.tsx removes #onb-preboot once it's up. */}
        <script src="/onb-preboot.js" />
        {children}
      </body>
    </html>
  );
}
