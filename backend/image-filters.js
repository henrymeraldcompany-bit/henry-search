const DATE_WINDOWS = { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
const DIMENSIONS = new Set(["small","medium","large","landscape","portrait","square"]);
const FORMATS = new Set(["jpg","jpeg","png","gif","webp","svg","avif","tiff","bmp"]);

function imageFormat(row) {
  const mime = String(row && (row.format || row.mime_type || row.mimeType) || "").toLowerCase();
  const mapped = mime.includes("/") ? mime.split("/").pop().replace("jpeg","jpg").replace("svg+xml","svg") : mime;
  if (FORMATS.has(mapped)) return mapped === "jpeg" ? "jpg" : mapped;
  const value = String(row && (row.media_url || row.image || row.url) || "");
  try {
    const pathname = new URL(value).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    const ext = match ? match[1].toLowerCase() : "";
    return FORMATS.has(ext) ? (ext === "jpeg" ? "jpg" : ext) : "";
  } catch (_) { return ""; }
}

function imageDimensionsMatch(row, filter) {
  if (!filter || filter === "any") return true;
  const width = Number(row && (row.width || row.image_width));
  const height = Number(row && (row.height || row.image_height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  if (filter === "small") return Math.max(width,height) < 640;
  if (filter === "medium") return Math.max(width,height) >= 640 && Math.max(width,height) < 1600;
  if (filter === "large") return Math.max(width,height) >= 1600;
  if (filter === "landscape") return width > height;
  if (filter === "portrait") return height > width;
  if (filter === "square") return width === height;
  return false;
}

export function filterImageResults(rows, filters = {}, now = Date.now()) {
  if (!Array.isArray(rows)) return [];
  const date = String(filters.date || "any").toLowerCase();
  const source = String(filters.source || "all").trim().toLowerCase();
  const format = String(filters.format || "all").trim().toLowerCase().replace(/^\./,"");
  const dimensions = String(filters.dimensions || "any").toLowerCase();
  if (date !== "any" && !Object.hasOwn(DATE_WINDOWS,date)) return [];
  if (!["all","any",""].includes(dimensions) && !DIMENSIONS.has(dimensions)) return [];
  if (format !== "all" && !FORMATS.has(format)) return [];
  return rows.filter(row => {
    if (!row || typeof row !== "object") return false;
    if (source !== "all" && String(row.source || row.provider || "").trim().toLowerCase() !== source) return false;
    if (format !== "all" && imageFormat(row) !== format) return false;
    if (!imageDimensionsMatch(row, dimensions)) return false;
    if (date !== "any") {
      const published = Date.parse(row.published_at || row.publishedAt || "");
      if (!Number.isFinite(published) || published > now || now - published > DATE_WINDOWS[date]) return false;
    }
    return true;
  });
}
