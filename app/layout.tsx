import type { Metadata } from "next";
import { Inter, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/toast";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter"
});

const zenKaku = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "900"],
  variable: "--font-zen-kaku"
});

export const metadata: Metadata = {
  title: "KISSa",
  description: "スマートオペレーション管理システム"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${inter.variable} ${zenKaku.variable}`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
