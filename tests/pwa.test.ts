import { afterEach, describe, expect, it } from "vitest";
import manifest from "../app/manifest";
import { GET as getIcon } from "../app/pwa-icon/[size]/route";
import { GET as getPublicKey } from "../app/api/push/public-key/route";

const iconRequest = (size: string) =>
  getIcon(new Request(`http://localhost/pwa-icon/${size}`), {
    params: Promise.resolve({ size }),
  });

describe("installable app", () => {
  it("opens standalone from the home screen with a maskable icon", () => {
    const app = manifest();
    expect(app.display).toBe("standalone");
    expect(app.start_url).toBe("/");
    expect(app.icons).toContainEqual(
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    );
  });

  it.each(["192", "512"])("serves a %spx PNG icon", async (size) => {
    const response = await iconRequest(size);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it.each(["100", "abc"])("returns 404 for icon size %s", async (size) => {
    const response = await iconRequest(size);
    expect(response.status).toBe(404);
  });
});

describe("push public key", () => {
  const original = process.env.VAPID_PUBLIC_KEY;
  afterEach(() => {
    process.env.VAPID_PUBLIC_KEY = original;
  });

  it("returns the public key read at request time", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public-key";
    const response = await getPublicKey();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      publicKey: "test-public-key",
    });
  });

  it("returns 503 when push is not configured", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    const response = await getPublicKey();
    expect(response.status).toBe(503);
  });
});
