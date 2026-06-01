import type { Metadata, Viewport } from "next";
import { Darumadrop_One, Comic_Relief } from "next/font/google";
import "./globals.css";

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
      <body className="min-h-full flex flex-col bg-[#bfdcf5] font-comic">{children}</body>
    </html>
  );
}
