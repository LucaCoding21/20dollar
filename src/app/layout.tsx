import type { Metadata, Viewport } from "next";
import { Darumadrop_One } from "next/font/google";
import "./globals.css";

const daruma = Darumadrop_One({
  variable: "--font-daruma",
  weight: "400",
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
    <html lang="en" className={`${daruma.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#bfdcf5] font-daruma">{children}</body>
    </html>
  );
}
