import type { Metadata } from "next";
import { M_PLUS_Rounded_1c, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/toast";

const zenKaku = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "900"],
  variable: "--font-zen-kaku"
});

const displayFont = M_PLUS_Rounded_1c({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
  variable: "--font-display"
});

export const metadata: Metadata = {
  title: "KISSa",
  description: "スマートオペレーション管理システム"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${zenKaku.variable} ${displayFont.variable}`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
