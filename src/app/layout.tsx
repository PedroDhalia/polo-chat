import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Plátano Ops", template: "%s · Plátano Ops" },
  description: "Camada operacional para centros de pesquisa clínica — MVP com dados fictícios.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="font-sans text-sm">{children}</body>
    </html>
  );
}
