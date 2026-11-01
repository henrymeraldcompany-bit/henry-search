function cleanText(value, limit) {
  return String(value || "").replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, " ")
    .replace(/<style\\b[^>]*>[\\s\\S]*?<\\/style>/gi, " ").replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\\s+/g, " ").trim().slice(0, limit);
}
function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch (_) { return ""; }
}
export function createWikimediaVideoProvider(options = {}) {
  return async function searchWikimediaVideos(query) {
    const q = String(query || "").trim().slice(0, 160);
    if (!q) return [];
    if (typeof options.requestJson !== "function") throw new TypeError("requestJson is required");
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    for (const [key, value] of [
      ["action","query"],["generator","search"],["gsrnamespace","6"],
      ["gsrsearch","filetype:video " + q],["gsrlimit","20"],
      ["prop","imageinfo"],["iiprop","url|mime|extmetadata"],
      ["iiurlwidth","640"],["format","json"]
    ]) url.searchParams.set(key, value);
    const data = await options.requestJson(url.href);
    const clean = options.cleanText || cleanText;
    const pages = Object.values(data && data.query && data.query.pages || {});
    return pages.map(page => {
      const info = page && page.imageinfo && page.imageinfo[0];
      if (!info || !/^video\\//i.test(String(info.mime || ""))) return null;
      const pageUrl = safeUrl(info.descriptionurl);
      const mediaUrl = safeUrl(info.url);
      if (!pageUrl || !mediaUrl) return null;
      const thumbnail = safeUrl(info.thumburl);
      const metadata = info.extmetadata || {};
      const license = metadata.LicenseShortName && metadata.LicenseShortName.value || "";
      const date = metadata.DateTimeOriginal && metadata.DateTimeOriginal.value || metadata.DateTime && metadata.DateTime.value || "";
      const published = date && Number.isFinite(Date.parse(date)) ? new Date(Date.parse(date)).toISOString() : "";
      const fileTitle = String(page.title || "").replace(/^File:/i, "");
      return {
        kind:"video", source:"Wikimedia Commons", source_id:String(page.pageid || pageUrl),
        title:clean((metadata.ObjectName && metadata.ObjectName.value) || fileTitle,250),
        description:clean((metadata.ImageDescription && metadata.ImageDescription.value) || "",1000),
        page_url:pageUrl, media_url:mediaUrl, thumbnail_url:thumbnail, embed_url:"",
        author:clean((metadata.Artist && metadata.Artist.value) || "",200),
        license:clean(license,100), published_at:published, duration_seconds:null,
        nsfw:0, tags:""
      };
    }).filter(Boolean);
  };
}
