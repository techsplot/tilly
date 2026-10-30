import { ImageResponse } from "next/og";

export const THEME_COLOR = "#1f4936";
export const BACKGROUND_COLOR = "#eef1e8";

// A sprout on the header green. The sprout stays inside the middle 60% so
// Android's maskable crop (a circle of 80%) never cuts it.
export function tillyIcon(size: number): ImageResponse {
  const unit = size / 100;
  const leaf = {
    position: "absolute" as const,
    width: 22 * unit,
    height: 13 * unit,
    background: "#8fd18a",
  };
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: THEME_COLOR,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 48 * unit,
          top: 38 * unit,
          width: 4 * unit,
          height: 34 * unit,
          borderRadius: 2 * unit,
          background: "#ffffff",
        }}
      />
      <div
        style={{
          ...leaf,
          left: 27 * unit,
          top: 34 * unit,
          borderRadius: `${13 * unit}px 0`,
          transform: "rotate(25deg)",
        }}
      />
      <div
        style={{
          ...leaf,
          left: 50 * unit,
          top: 30 * unit,
          borderRadius: `0 ${13 * unit}px`,
          transform: "rotate(-25deg)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 32 * unit,
          top: 70 * unit,
          width: 36 * unit,
          height: 5 * unit,
          borderRadius: 3 * unit,
          background: "#c9a46a",
        }}
      />
    </div>,
    { width: size, height: size },
  );
}
