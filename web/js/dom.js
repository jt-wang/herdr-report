// Small building blocks: element helper, time, status glyphs, icons, agent marks.
import { t, getLang } from "./i18n.js";

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}

// "15 min ago", "3 h ago", "yesterday", "3 days ago"
export function ago(iso, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return t("ago_now");
  if (m < 60) return t("ago_min", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("ago_hour", { n: h });
  const d = Math.round(h / 24);
  return d === 1 ? t("ago_yesterday") : t("ago_days", { n: d });
}

export const time = (ms) => new Date(ms).toLocaleTimeString(getLang() === "zh" ? "zh-CN" : "en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" });

/* Status glyphs. None of them looks like a checkbox: this page is read-only. */
export const GLYPH = {
  needs: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="var(--blue)"><circle cx="12" cy="7.5" r="4.2"/><path d="M3.8 21c.6-4.6 4-7.4 8.2-7.4s7.6 2.8 8.2 7.4z"/></svg>`,
  blocked: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="var(--red)"><path d="M5 2.5h1.9v19H5zM7.8 3.5h11.4l-2.7 4.5 2.7 4.5H7.8z"/></svg>`,
  doing: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6" fill="none" stroke="var(--blue)" stroke-width="2"/><path fill="var(--blue)" d="M12 6a6 6 0 0 1 0 12z"/></svg>`,
  todo: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6" fill="none" stroke="var(--tertiary)" stroke-width="1.8" stroke-dasharray="3.2 2.6"/></svg>`,
  done: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="var(--green)"/></svg>`,
};

export const ICON = {
  area: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" stroke-width="1.5" stroke-linejoin="round"><path d="M12 2.8l8.2 4.6v9.2L12 21.2l-8.2-4.6V7.4z"/><path d="M3.8 7.4L12 12l8.2-4.6M12 12v9.2M7.9 5.1l8.2 4.6"/></svg>`,
  back: `<svg width="12" height="20" viewBox="0 0 12 20"><path d="M10 2L2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  fold: `<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  bell: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>`,
  // a page with lines: "summary"
  summary: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="3" width="15" height="18" rx="3"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></svg>`,
};

/* Project progress circle, as in Things: an outline with a filled wedge. */
export function pie(frac, size = 18) {
  const r = size / 2 - 1, c = size / 2, inner = r - 2.4;
  let wedge = "";
  if (frac >= 1) wedge = `<circle cx="${c}" cy="${c}" r="${inner}" fill="var(--blue)"/>`;
  else if (frac > 0) {
    const a = frac * 2 * Math.PI, x = c + inner * Math.sin(a), y = c - inner * Math.cos(a);
    wedge = `<path fill="var(--blue)" d="M${c} ${c}V${c - inner}A${inner} ${inner} 0 ${frac > .5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}z"/>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r - .75}" fill="none" stroke="var(--blue)" stroke-width="1.5"/>${wedge}</svg>`;
}

/* Agent marks: official one-color marks, tinted; a monogram otherwise. */
const BRAND = {
  claude: { file: "claude", tint: "#D97757", name: "Claude" },
  codex: { file: "openai", tint: "var(--ink)", name: "Codex" },
  cursor: { file: "cursor", tint: "var(--ink)", name: "Cursor" },
  copilot: { file: "copilot", tint: "#8534F3", name: "Copilot" },
};
export function agentName(kind) {
  return BRAND[kind]?.name || (kind ? kind[0].toUpperCase() + kind.slice(1) : "?");
}
export function mark(kind) {
  const b = BRAND[kind];
  if (b) return el("span", { class: "mark", style: `--m:url(marks/${b.file}.svg);--tint:${b.tint}`, "aria-label": b.name });
  return el("span", { class: "mono", "aria-label": kind }, (kind || "?")[0].toUpperCase());
}
