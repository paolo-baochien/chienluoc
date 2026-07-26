import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    "https://chien-luoc-bao-lan.paolo-pasmarket.chatgpt.site",
  ),
  title: "Chiến lược Trainer · Bảo Lan",
  description:
    "Allenamento vocale per la preparazione agli esami di Việt Võ Đạo.",
  manifest: "/manifest.webmanifest",
  applicationName: "Chiến lược Trainer",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Chiến lược",
  },
  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  openGraph: {
    title: "Chiến lược Trainer · Bảo Lan",
    description: "Allenati per il tuo esame di Việt Võ Đạo.",
    locale: "it_IT",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Chiến lược Trainer per la preparazione agli esami di Việt Võ Đạo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Chiến lược Trainer · Bảo Lan",
    description: "Allenati per il tuo esame di Việt Võ Đạo.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#171713",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
