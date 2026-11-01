function cleanText(value, limit) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ").trim().slice(0, limit);
}
function durationSeconds(value) {
  const match = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match || !match.slice(1).some(part => part !== undefined)) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}
function safeThumbnail(value) {
  try {
    const url = new URL(String(value || ""));
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : "";
  } catch (_) { return ""; }
}
export function createYouTubeProvider(options = {}) {
  return async function searchYouTube(query) {
    const key = String(options.apiKey || "").trim();
    const q = String(query || "").trim().slice(0, 180);
    if (!key || !q) return [];
    if (typeof options.requestJson !== "function") throw new TypeError("requestJson is required");
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    for (const [name, value] of [["part","snippet"],["type","video"],["maxResults","10"],["order","relevance"],["safeSearch","strict"],["q",q],["key",key]]) searchUrl.searchParams.set(name,value);
    const data = await options.requestJson(searchUrl.href);
    const clean = options.cleanText || cleanText;
    const rows = (Array.isArray(data && data.items) ? data.items : []).map(item => {
      const id = item && item.id && item.id.videoId;
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{6,80}$/.test(id)) return null;
      const snippet = item.snippet || {};
      const thumbnails = snippet.thumbnails || {};
      const thumbnail = safeThumbnail((thumbnails.high && thumbnails.high.url) || (thumbnails.medium && thumbnails.medium.url) || (thumbnails.default && thumbnails.default.url));
      const page = "https://www.youtube.com/watch?v=" + encodeURIComponent(id);
      return {kind:"video",source:"youtube.com",source_id:id,title:clean(snippet.title,250),description:clean(snippet.description,1000),page_url:page,media_url:page,thumbnail_url:thumbnail,embed_url:"https://www.youtube-nocookie.com/embed/"+encodeURIComponent(id),author:clean(snippet.channelTitle,200),license:"",published_at:typeof snippet.publishedAt==="string"?snippet.publishedAt:"",duration_seconds:null,nsfw:0,tags:""};
    }).filter(Boolean);
    if (!rows.length) return rows;
    const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    detailsUrl.searchParams.set("part","contentDetails");
    detailsUrl.searchParams.set("id",rows.map(row=>row.source_id).join(","));
    detailsUrl.searchParams.set("key",key);
    try {
      const details = await options.requestJson(detailsUrl.href);
      const durations = new Map((Array.isArray(details && details.items)?details.items:[]).map(item=>[item.id,durationSeconds(item.contentDetails && item.contentDetails.duration)]));
      rows.forEach(row=>{row.duration_seconds=durations.get(row.source_id) ?? null;});
    } catch (_) {}
    return rows;
  };
}
