import type { Metadata, Viewport } from "next";
import { Darumadrop_One, Comic_Relief } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegister from "./sw-register";

// The very first thing the app does on load is fetch from Supabase. Opening the
// TCP + TLS connection to that origin up front (in parallel with parsing the
// page) shaves a round-trip off that first query on slow networks.
const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  } catch {
    return null;
  }
})();

// Darumadrop One is kept for the big Shared Bank total only.
const daruma = Darumadrop_One({
  variable: "--font-daruma",
  weight: "400",
  subsets: ["latin"],
});

// Comic Relief is the default font for everything else.
const comic = Comic_Relief({
  variable: "--font-comic",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "$20 a Day",
  description: "Our shared daily allowance bank",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "$20 a Day",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#5a7fb5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${daruma.variable} ${comic.variable} h-full antialiased`}>
      <head>
        {SUPABASE_ORIGIN && (
          <>
            <link rel="preconnect" href={SUPABASE_ORIGIN} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={SUPABASE_ORIGIN} />
          </>
        )}
        {/* GIPHY is only hit when the gif picker opens, but warming DNS is cheap. */}
        <link rel="dns-prefetch" href="https://api.giphy.com" />
      </head>
      <body className="min-h-full flex flex-col bg-[#bfdcf5] font-comic">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
