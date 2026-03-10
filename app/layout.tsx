import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KISSa",
  description: "Backend-first cafe operations platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}


