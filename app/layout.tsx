import type { Metadata, Viewport } from "next";
import ServiceWorkerRegistrar from "@/app/components/ServiceWorkerRegistrar";
import { THEME_COLOR } from "@/app/lib/tilly-icon";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tilly",
  description: "A farm memory you keep by talking.",
  applicationName: "Tilly",
  appleWebApp: { capable: true, title: "Tilly", statusBarStyle: "default" },
};

// No maximumScale or userScalable: farmers must still be able to zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: THEME_COLOR,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
