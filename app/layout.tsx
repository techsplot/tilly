import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FarmMind | FieldLedger",
  description: "A simple memory and action assistant for your farm.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
