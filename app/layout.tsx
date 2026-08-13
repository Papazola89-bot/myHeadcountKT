import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: "myHeadcountKT — Headcount & Intervensi Pemulihan Khas",
    description: "Sistem pengurusan headcount, perkembangan dan intervensi murid Pemulihan Khas.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "myHeadcountKT",
      description: "Isi sekali. Fahami perkembangan. Bertindak tepat.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1678, height: 943, alt: "myHeadcountKT Headcount & Intervensi Pemulihan Khas" }],
    },
    twitter: { card: "summary_large_image", title: "myHeadcountKT", description: "Isi sekali. Fahami perkembangan. Bertindak tepat.", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ms"><body className={inter.variable}>{children}</body></html>;
}
