import type { MetadataRoute } from "next";
import { BACKGROUND_COLOR, THEME_COLOR } from "@/app/lib/tilly-icon";

// Lets a farmer add Tilly to their phone's home screen and open it full
// screen, without the browser's address bar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tilly",
    short_name: "Tilly",
    description: "A farm memory you keep by talking.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      {
        src: "/pwa-icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
