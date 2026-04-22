import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arrodes — LOTM RAG",
  description:
    "Chapter-grounded Q&A over Lord of the Mysteries and Circle of Inevitability.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
