import { tillyIcon } from "@/app/lib/tilly-icon";

const SIZES = new Set([192, 512]);

type RouteContext = { params: Promise<{ size: string }> };

// Home-screen icons listed in app/manifest.ts.
export async function GET(
  _request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  return tillyIcon(size);
}
