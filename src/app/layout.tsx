import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "terms-studio",
  description: "보험 약관 생성 도구",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
