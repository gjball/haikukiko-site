// Haiku Kiko social bot: posts the next item in public.social_queue to Instagram (and X once set up).
// Called every 10 minutes by pg_cron. Pacing, posting hours and dry-run live in the database
// (social_config, social_interval, social_claim) — this function only does the posting.
//
// Keys live in public.social_secrets (RLS on, no policies → only the service role can read them):
//   ig_user_id, ig_access_token              Instagram API with Instagram Login (long-lived token, auto-refreshed)
//   x_api_key, x_api_secret, x_access_token, x_access_secret   X API, OAuth 1.0a user context
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const IG = "https://graph.instagram.com/v24.0";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b, null, 2), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const { data: cfg } = await db.from("social_config").select("*").single();
  if (!cfg || req.headers.get("x-cron-secret") !== cfg.cron_secret) return json({ error: "forbidden" }, 403);

  const dry = !cfg.live || new URL(req.url).searchParams.has("dry");
  const { data: rows, error } = await db.rpc("social_claim", { p_dry: dry });
  if (error) return json({ error: error.message }, 500);
  const item = rows?.[0];
  if (!item?.due) return json({ posted: false, reason: item?.reason, remaining: item?.remaining });
  if (dry) return json({ posted: false, reason: "dry run — would post", item });

  const secrets = await loadSecrets();
  const { data: row } = await db.from("social_queue").select("ig_id,x_id,attempts").eq("id", item.id).single();
  const done: Record<string, string> = {};
  const errors: string[] = [];

  for (const p of cfg.platforms as string[]) {
    try {
      if (p === "instagram" && !row?.ig_id) done.ig_id = await postInstagram(secrets, item.image_url, item.caption_ig);
      if (p === "x" && !row?.x_id) done.x_id = await postX(secrets, item.image_url, item.caption_x);
    } catch (e) {
      errors.push(`${p}: ${(e as Error).message}`);
    }
  }

  const failed = errors.length > 0;
  await db.from("social_queue").update({
    ...done,
    status: failed ? ((row?.attempts ?? 1) >= 3 ? "failed" : "queued") : "posted",
    posted_at: failed ? null : new Date().toISOString(),
    error: failed ? errors.join(" | ").slice(0, 2000) : null,
  }).eq("id", item.id);

  return json({ posted: !failed, item: `${item.set_slug} #${item.n}`, ...done, errors });
});

async function loadSecrets() {
  const { data } = await db.from("social_secrets").select("key,value,updated_at");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r])) as Record<string, { value: string; updated_at: string }>;
}

// ---------- Instagram (Instagram API with Instagram Login) ----------
async function postInstagram(s: Record<string, { value: string; updated_at: string }>, imageUrl: string, caption: string) {
  if (!s.ig_user_id || !s.ig_access_token) throw new Error("Instagram keys not set");
  let token = s.ig_access_token.value;
  // Long-lived tokens last 60 days; refresh when older than 30
  if (Date.now() - Date.parse(s.ig_access_token.updated_at) > 30 * 864e5) {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`);
    const j = await r.json();
    if (j.access_token) {
      token = j.access_token;
      await db.from("social_secrets").update({ value: token, updated_at: new Date().toISOString() }).eq("key", "ig_access_token");
    }
  }
  const user = s.ig_user_id.value;
  const c = await igCall(`${IG}/${user}/media`, { image_url: imageUrl, caption, access_token: token });
  for (let i = 0; i < 10; i++) {
    const st = await (await fetch(`${IG}/${c.id}?fields=status_code&access_token=${token}`)).json();
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new Error(`container ${st.status_code}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  const p = await igCall(`${IG}/${user}/media_publish`, { creation_id: c.id, access_token: token });
  return p.id as string;
}

async function igCall(url: string, params: Record<string, string>) {
  const r = await fetch(url, { method: "POST", body: new URLSearchParams(params) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j;
}

// ---------- X (API v2, OAuth 1.0a user context) ----------
async function postX(s: Record<string, { value: string }>, imageUrl: string, text: string) {
  for (const k of ["x_api_key", "x_api_secret", "x_access_token", "x_access_secret"]) if (!s[k]) throw new Error("X keys not set");
  const img = await (await fetch(imageUrl)).blob();
  const form = new FormData();
  form.append("media", img, "image.jpg");
  form.append("media_category", "tweet_image");
  const up = await xFetch(s, "https://api.x.com/2/media/upload", form);
  const mediaId = up.data?.id ?? up.media_id_string;
  if (!mediaId) throw new Error("media upload: " + JSON.stringify(up).slice(0, 300));
  const t = await xFetch(s, "https://api.x.com/2/tweets", JSON.stringify({ text, media: { media_ids: [mediaId] } }));
  if (!t.data?.id) throw new Error("tweet: " + JSON.stringify(t).slice(0, 300));
  return t.data.id as string;
}

async function xFetch(s: Record<string, { value: string }>, url: string, body: FormData | string) {
  const headers: Record<string, string> = { authorization: await oauth1(s, "POST", url) };
  if (typeof body === "string") headers["content-type"] = "application/json";
  const r = await fetch(url, { method: "POST", headers, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${new URL(url).pathname} HTTP ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

// JSON and multipart bodies are not part of the OAuth 1.0a signature, so only the oauth_* params are signed.
async function oauth1(s: Record<string, { value: string }>, method: string, url: string) {
  const enc = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const o: Record<string, string> = {
    oauth_consumer_key: s.x_api_key.value,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: s.x_access_token.value,
    oauth_version: "1.0",
  };
  const params = Object.keys(o).sort().map((k) => `${enc(k)}=${enc(o[k])}`).join("&");
  const base = [method, enc(url), enc(params)].join("&");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(`${enc(s.x_api_secret.value)}&${enc(s.x_access_secret.value)}`),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base)))));
  o.oauth_signature = sig;
  return "OAuth " + Object.keys(o).sort().map((k) => `${enc(k)}="${enc(o[k])}"`).join(", ");
}
