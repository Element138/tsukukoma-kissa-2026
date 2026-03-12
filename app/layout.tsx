import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast";

export const metadata: Metadata = {
  title: "KISSa",
  description: "\u30b9\u30de\u30fc\u30c8\u30aa\u30da\u30ec\u30fc\u30b7\u30e7\u30f3\u7ba1\u7406\u30b7\u30b9\u30c6\u30e0"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
