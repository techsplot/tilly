// Read at request time, not build time: the Docker build has no .env, so a
// NEXT_PUBLIC_ variable would be empty in production.
export const dynamic = "force-dynamic";

// GET /api/push/public-key - the VAPID public key the browser subscribes
// with. It is public by design; the private key never leaves the server.
export async function GET(): Promise<Response> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return Response.json(
      { error: "Push notifications are not configured." },
      { status: 503 },
    );
  }
  return Response.json({ publicKey });
}
