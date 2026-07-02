import { NextResponse } from "next/server";
import { exchangeOuraAuthorizationCode } from "@/lib/oura";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function html(title: string, body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 32px; background: #0b0d10; color: #e6e9ef; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    main { max-width: 560px; margin: 0 auto; background: #11151b; border: 1px solid #1c222b; border-radius: 12px; padding: 20px; }
    a { color: #7aa2f7; }
    p { color: #9aa6b8; line-height: 1.5; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return html("Oura connection failed", `<h1>Oura connection failed</h1><p>${escapeHtml(error)}</p>`, 400);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = cookieValue(request.headers.get("cookie"), "oura_oauth_state");
  if (!code) return html("Missing code", "<h1>Missing Oura authorization code</h1>", 400);
  if (!state || !expectedState || state !== expectedState) {
    return html("Invalid state", "<h1>Invalid Oura authorization state</h1>", 400);
  }

  const result = await exchangeOuraAuthorizationCode(code, request.url);
  if (!result.ok) {
    return html("Oura connection failed", `<h1>Oura connection failed</h1><p>${escapeHtml(result.error)}</p>`, 400);
  }

  const res = html(
    "Oura connected",
    '<h1>Oura connected</h1><p>Your dashboard can now read Oura sleep and activity data.</p><p><a href="/">Back to dashboard</a></p>',
  );
  res.cookies.set("oura_oauth_state", "", { path: "/api/oura", maxAge: 0 });
  return res;
}
