import { NextResponse } from "next/server";
import { buildOuraAuthorizeUrl, newOauthState } from "@/lib/oura";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const state = newOauthState();
  const url = buildOuraAuthorizeUrl(request.url, state);
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "missing OURA_CLIENT_ID" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const res = NextResponse.redirect(url);
  res.cookies.set("oura_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/api/oura",
    maxAge: 10 * 60,
  });
  return res;
}
