import { NextResponse } from "next/server";
import { defaultOuraRedirectUri, exchangeOuraAuthorizationCode } from "@/lib/oura";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function page(body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Oura code exchange</title>
  <style>
    body { margin: 0; padding: 32px; background: #0b0d10; color: #e6e9ef; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    main { max-width: 680px; margin: 0 auto; background: #11151b; border: 1px solid #1c222b; border-radius: 12px; padding: 20px; }
    label { display: block; margin: 14px 0 6px; color: #9aa6b8; font-size: 13px; }
    input { box-sizing: border-box; width: 100%; background: #0c1015; color: #e6e9ef; border: 1px solid #1c222b; border-radius: 8px; padding: 10px 12px; }
    button { margin-top: 16px; background: #7aa2f7; color: #08111f; border: 0; border-radius: 8px; padding: 9px 14px; font-weight: 600; cursor: pointer; }
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
  const redirectUri = process.env.OURA_REDIRECT_URI?.trim() || defaultOuraRedirectUri(request.url);
  return page(`
    <h1>Oura code exchange</h1>
    <form method="post">
      <label for="code">Authorization code</label>
      <input id="code" name="code" autocomplete="off" autofocus />
      <label for="redirectUri">Redirect URI used during authorization</label>
      <input id="redirectUri" name="redirectUri" value="${escapeHtml(redirectUri)}" />
      <button type="submit">Connect Oura</button>
    </form>
  `);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const code = String(form.get("code") ?? "").trim();
  const redirectUri = String(form.get("redirectUri") ?? "").trim();
  if (!code) return page("<h1>Missing authorization code</h1>", 400);

  const result = await exchangeOuraAuthorizationCode(code, request.url, redirectUri || undefined);
  if (!result.ok) {
    return page(`<h1>Oura connection failed</h1><p>${escapeHtml(result.error)}</p>`, 400);
  }

  return page('<h1>Oura connected</h1><p><a href="/">Back to dashboard</a></p>');
}
