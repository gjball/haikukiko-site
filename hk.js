// Haiku Kiko data layer: everything editable lives in Supabase.
const HK = (() => {
  const SB = "https://uuycejeoptsgglhjeqvb.supabase.co";
  const KEY = "sb_publishable_JvuFtdL65aEe5hrBmVr3pA_Ze4IgPWq";
  const H = { apikey: KEY, Authorization: "Bearer " + KEY };
  const dev = new URLSearchParams(location.search).has("dev");
  // Environment: the dev site (dev-… preview address or dev.haikukiko.com) reads its own dev_ tables.
  const ENV = /^dev[-.]|^localhost|^127\./.test(location.hostname) ? "dev" : "live";
  const T = ENV === "dev" ? "dev_" : "";
  async function get(path) {
    const r = await fetch(SB + "/rest/v1/" + T + path, { headers: H });
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  }
  async function rpc(fn, body) {
    const r = await fetch(SB + "/rest/v1/rpc/" + T + fn, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(fn + " " + r.status);
    return r.status === 204 ? null : r.json();
  }
  const live = dev ? "" : "&status=eq.live";
  return {
    dev, env: ENV,
    q: dev ? "?dev" : "",
    settings: async () => Object.fromEntries((await get("settings?select=key,value")).map(r => [r.key, r.value])),
    sets: () => get("sets?select=*&order=sort.desc" + live),
    set: async slug => (await get("sets?select=*&slug=eq." + encodeURIComponent(slug) + live))[0],
    photos: slug => get("photos?select=*&set_slug=eq." + encodeURIComponent(slug) + live + "&order=n"),
    galleryPhotos: slug => rpc("gallery_photos", { p_set: slug, p_dev: dev }),
    styles: () => get("styles?select=*&active=eq.true&order=sort"),
    options: async slug => { const [st, rows] = await Promise.all([get("styles?select=code&active=eq.true"), get("haiku_options?select=*&set_slug=eq." + encodeURIComponent(slug) + "&order=n,style")]); const ok = new Set(st.map(r => r.code)); return rows.filter(o => ok.has(o.style)); },
    rpc,
    esc: s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    pad: n => String(n).padStart(2, "0"),
    slugFromPath: () => new URLSearchParams(location.search).get("s") || location.pathname.split("/").filter(Boolean)[0] || ""
  };
})();
if (HK.env === "dev") addEventListener("DOMContentLoaded", () => { const b = document.createElement("div"); b.textContent = "DEV"; b.style.cssText = "position:fixed;right:10px;top:10px;z-index:99;font:500 11px 'DM Mono',monospace;letter-spacing:.1em;color:#0d131c;background:#e0b45c;border-radius:999px;padding:5px 10px;pointer-events:none"; document.body.appendChild(b); });
