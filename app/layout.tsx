import type { Metadata } from "next";
import "./globals.css";

// Note: using system fonts instead of next/font/google's Geist here, so the
// app doesn't depend on fetching fonts.googleapis.com at build time (some
// environments block that). Feel free to switch back to Geist once deployed
// on Vercel, where that fetch works fine.

export const metadata: Metadata = {
  title: "Chart & Indicator Analyzer",
  description: "Personal technical analysis tool for stock charts and indicators.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
