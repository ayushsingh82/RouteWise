import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "RouteWise — find the LLM spend that never needed a frontier model", template: "%s · RouteWise" },
  description: "Break agent traffic into tasks, replay a cache-and-route policy over your real traces, and see savings tagged by how well they're proven.",
  openGraph: {
    title: "RouteWise",
    description: "Find the LLM spend that never needed a frontier model — and prove it before you change anything.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
