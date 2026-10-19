import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tilly",
  description: "A farm memory you keep by talking.",
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
