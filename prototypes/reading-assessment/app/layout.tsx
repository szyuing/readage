import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reading Edge — 英语阅读难度定位",
  description: "用背景粗定位与真实阅读表现，找到刚刚好的下一篇英文文章。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
