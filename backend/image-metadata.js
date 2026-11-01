const FORMATS = new Set(["jpg","jpeg","png","gif","webp","svg","avif","tiff","bmp","ico"]);

function text(value, limit = 500) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
      .replace(/\\s+/g, " ").trim().slice(0, limit);
  }
  return "";
}
function positiveDimension(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 100000 ? number : null;
}
function dateValue(value) {
  const raw = text(value, 80);
  if (!raw) return "";
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}
function tagsValue(value) {
  let values = value;
  if (typeof values === "string") {
    try { const parsed = JSON.parse(values); if (Array.isArray(parsed)) values = parsed; } catch (_) {}
  }
  if (!Array.isArray(values)) values = typeof value === "string" ? value.split(/[,;|]/) : [];
  return [...new Set(values.map(item => text(typeof item === "object" && item ? item.name || item.label : item, 80).toLowerCase()).filter(Boolean))].slice(0, 40);
}
function formatValue(value, url) {
  let format = text(value, 80).toLowerCase().split(";")[0].trim();
  if (format.includes("/")) format = format.split("/").pop();
  format = format.replace("jpeg", "jpg").replace("svg+xml", "svg");
  if (FORMATS.has(format)) return format;
  try {
    const match = new URL(String(url || "")).pathname.match(/\\.([a-z0-9]{2,5})$/i);
    const ext = match ? match[1].toLowerCase().replace("jpeg", "jpg") : "";
    return FORMATS.has(ext) ? ext : "";
  } catch (_) { return ""; }
}

/** Extracts consistent, bounded metadata from provider records without fetching arbitrary image URLs. */
export function extractImageMetadata(item = {}) {
  const image = item.image && typeof item.image === "object" ? item.image : {};
  const exif = item.exif && typeof item.exif === "object" ? item.exif : {};
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const width = positiveDimension(item.width ?? item.image_width ?? image.width ?? metadata.width);
  const height = positiveDimension(item.height ?? item.image_height ?? image.height ?? metadata.height);
  const mediaUrl = item.media_url || item.image_url || item.image || item.url || "";
  const mime = item.mime_type || item.mimeType || item.format || metadata.mime_type || "";
  const publishedAt = dateValue(item.published_at || item.publishedAt || item.created_on || item.created || item.date_taken || item.date || "");
  const tags = tagsValue(item.tags || item.keywords || metadata.tags || []);
  return {
    width, height,
    format: formatValue(mime, mediaUrl),
    published_at: publishedAt,
    tags,
    alt_text: text(item.alt_text || item.alt || image.alt || item.accessibility_label || "", 500),
    camera: text(exif.camera || item.camera || metadata.camera || "", 120),
    color_space: text(exif.color_space || item.color_space || metadata.color_space || "", 80),
    orientation: text(exif.orientation || item.orientation || metadata.orientation || "", 80)
  };
}
