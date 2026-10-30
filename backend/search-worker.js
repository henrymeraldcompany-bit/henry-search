
function safePublicUrl(value, base) {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) return null;
    if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".onion") ||
        host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
    return url;
  } catch { return null; }
}
function robotsPathAllowed(robotsText, url) {
  const groups = [];
  let group = { agents: [], rules: [] };
  for (const raw of String(robotsText || "").split(/\r?\n/)) {
    const line = raw.split("#", 1)[0].trim();
    if (!line || !line.includes(":")) continue;
    const at = line.indexOf(":");
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (key === "user-agent") {
      if (group.rules.length) { groups.push(group); group = { agents: [], rules: [] }; }
      group.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && group.agents.length && value) {
      group.rules.push({ allow: key === "allow", path: value });
    }
  }
  if (group.agents.length) groups.push(group);
  const specific = groups.filter(g => g.agents.some(a => a !== "*" && "gozie-searchbot".includes(a)));
  const selected = specific.length ? specific : groups.filter(g => g.agents.includes("*"));
  const target = url.pathname + url.search;
  let best = null;
  for (const g of selected) for (const rule of g.rules) {
    const pattern = rule.path.replace(/[.+?^$()|[\]\\]/g, "\\export default {").replace(/\*/g, ".*");
    let matches = false;
    try { matches = new RegExp("^" + pattern).test(target); } catch {}
    if (matches && (!best || rule.path.length > best.path.length ||
        (rule.path.length === best.path.length && rule.allow))) best = rule;
  }
  return !best || best.allow;
}
function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function htmlAttribute(tagText, name) {
  const match = tagText.match(new RegExp("\\\\b" + name + "\\\\s*=\\\\s*(?:\\"([^\\"]*)\\"|'([^']*)'|([^\\\\s>]+))", "i"));
  return match ? decodeHtml(match[1] ?? match[2] ?? match[3] ?? "") : "";
}
function extractHtmlMetadata(html, pageUrl) {
  const meta = (key) => {
    const tags = String(html).match(/<meta\b[^>]*>/gi) || [];
    for (const tagText of tags) {
      const name = htmlAttribute(tagText, "name").toLowerCase();
      const property = htmlAttribute(tagText, "property").toLowerCase();
      if (name === key.toLowerCase() || property === key.toLowerCase()) return htmlAttribute(tagText, "content");
    }
    return "";
  };
  const titleMatch = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeHtml((titleMatch?.[1] || meta("og:title")).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 300);
  const description = (meta("description") || meta("og:description") || meta("twitter:description")).slice(0, 1000);
  const datePublished = meta("article:published_time") || meta("date") || meta("pubdate") || "";
  const imageCandidate = meta("og:image") || meta("twitter:image") || "";
  const imageUrl = imageCandidate ? safePublicUrl(imageCandidate, pageUrl) : null;
  const canonicalTag = (String(html).match(/<link\b[^>]*\brel\s*=\s*["']?canonical["']?[^>]*>/i) || [])[0] || "";
  const canonicalCandidate = htmlAttribute(canonicalTag, "href");
  const canonicalUrl = canonicalCandidate ? safePublicUrl(canonicalCandidate, pageUrl) : null;
  let content = String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|nav|footer|header|aside|form|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const mainMatch = content.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (mainMatch) content = mainMatch[1];
  content = content.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|amp|quot|lt|gt);|&#(?:39|x27);/gi, " ")
    .replace(/\s+/g, " ").trim();
  return {
    title: title || new URL(pageUrl).hostname,
    description: decodeHtml(description).replace(/\s+/g, " ").trim(),
    text: decodeHtml(content).slice(0, 16000),
    canonical: canonicalUrl && canonicalUrl.hostname === new URL(pageUrl).hostname ? canonicalUrl.href : pageUrl,
    image: imageUrl ? imageUrl.href : "",
    published: datePublished.slice(0, 80)
  };
}
async function readTextLimited(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new Error("Page exceeds the 1 MB extraction limit."); }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8").decode(merged);
}
async function robotsAllows(url) {
  const robotsUrl = new URL("/robots.txt", url.origin);
  try {
    const response = await fetch(robotsUrl.href, {
      headers: { "Accept": "text/plain", "User-Agent": "GOZIE-SearchBot/1.0" },
      redirect: "error", signal: AbortSignal.timeout(5000)
    });
    if (response.status === 404) return true;
    if (!response.ok) return false;
    const text = await readTextLimited(response, 65536);
    return robotsPathAllowed(text, url);
  } catch { return false; }
}
async function extractPublicPage(input) {
  let current = safePublicUrl(input);
  if (!current) return { status: 400, data: { error: "Enter a public HTTP or HTTPS webpage URL. Local, private-IP, credential-bearing and non-standard-port URLs are not supported." } };
  for (let hop = 0; hop <= 3; hop++) {
    if (!await robotsAllows(current)) return { status: 403, data: { error: "This website does not permit GOZIE SearchBot to retrieve this page, or its robots policy could not be checked." } };
    let response;
    try {
      response = await fetch(current.href, {
        headers: { "Accept": "text/html,application/xhtml+xml;q=0.9", "User-Agent": "GOZIE-SearchBot/1.0" },
        redirect: "manual", signal: AbortSignal.timeout(9000)
      });
    } catch { return { status: 502, data: { error: "The source website could not be reached." } }; }
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      const next = location ? safePublicUrl(location, current.href) : null;
      if (!next) return { status: 502, data: { error: "The source returned an unsupported redirect." } };
      current = next;
      continue;
    }
    if (!response.ok) return { status: response.status === 429 ? 429 : 502, data: { error: "The source website returned HTTP " + response.status + "." } };
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return { status: 415, data: { error: "This source is not an HTML webpage. GOZIE extracts webpage text, not files or media streams." } };
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 1048576) return { status: 413, data: { error: "This webpage is larger than the 1 MB extraction limit." } };
    try {
      const html = await readTextLimited(response, 1048576);
      const extracted = extractHtmlMetadata(html, current.href);
      if (!extracted.text && !extracted.description) return { status: 422, data: { error: "No readable page text was found." } };
      return { status: 200, data: { source: current.hostname, url: current.href, ...extracted, extractedAt: new Date().toISOString(), method: "public-page-fetch" } };
    } catch (error) { return { status: 413, data: { error: error.message || "Could not read this webpage." } }; }
  }
  return { status: 508, data: { error: "The source exceeded the redirect limit." } };
}

export default {
async fetch(request) {
 const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, OPTIONS","Access-Control-Allow-Headers":"Content-Type","X-Content-Type-Options":"nosniff"};
 const out=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=UTF-8","Cache-Control":status>=400?"no-store":"public, max-age=60, stale-while-revalidate=300"}});
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(request.method!=="GET")return out({error:"Method not allowed."},405);
 const u=new URL(request.url),route=u.pathname,q=(u.searchParams.get("q")||"").trim();
 if(route==="/")return out({name:"GOZIE SEARCH API",status:"online",endpoints:["/search?q=technology","/images?q=cats","/news?q=technology"]});
 if(!["/search","/images","/news","/extract"].includes(route))return out({error:"Not found."},404);
 if(route==="/extract"){const target=u.searchParams.get("url")||"";if(!target)return out({error:"Provide a webpage URL using the url parameter."},400);const result=await extractPublicPage(target);return out(result.data,result.status);}
 if(!q)return out({error:"Enter a search query."},400);
 if(q.length>300)return out({error:"Search query must be 300 characters or fewer."},400);
 const json=async(url,ms=8000)=>{const r=await fetch(url,{headers:{"Accept":"application/json","User-Agent":"GOZIESearch/1.3"},signal:AbortSignal.timeout(ms)});if(!r.ok)throw Error("HTTP "+r.status);return r.json()};
 const decode=s=>String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
 const tag=(s,t)=>{const m=s.match(new RegExp("<"+t+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+t+">","i"));return m?decode(m[1].trim()):""};
 const parseRss=xml=>{const results=[];for(const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)){const x=m[1],title=tag(x,"title"),url=tag(x,"link"),published=tag(x,"pubDate"),source=tag(x,"source"),description=tag(x,"description").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();if(title&&/^https?:\/\//i.test(url))results.push({title,url,snippet:[source,published,description].filter(Boolean).join(" · "),source,published});if(results.length>=20)break}return results};
 try{
  if(route==="/images"){
   const a=new URL("https://commons.wikimedia.org/w/api.php");Object.entries({action:"query",generator:"search",gsrsearch:q,gsrnamespace:"6",gsrlimit:"20",prop:"imageinfo",iiprop:"url|extmetadata",iiurlwidth:"480",format:"json",origin:"*"}).forEach(([k,v])=>a.searchParams.set(k,v));
   const d=await json(a.toString()),results=Object.values(d.query?.pages||{}).map(p=>{const i=p.imageinfo?.[0];if(!i?.thumburl||!i?.url)return null;const clean=x=>String(x||"").replace(/<[^>]*>/g,"");return{title:String(p.title||"").replace(/^File:/,"").replace(/_/g," "),thumbnail:i.thumburl,image:i.url,page:i.descriptionurl||i.url,license:clean(i.extmetadata?.LicenseShortName?.value),artist:clean(i.extmetadata?.Artist?.value)}}).filter(Boolean);
   return out({query:q,source:"Wikimedia Commons",results});
  }
  if(route==="/news"){
   const errors=[];
   try{const a=new URL("https://api.gdeltproject.org/api/v2/doc/doc");Object.entries({query:q,mode:"artlist",format:"json",maxrecords:"20",sort:"datedesc"}).forEach(([k,v])=>a.searchParams.set(k,v));const d=await json(a.toString(),10000);const results=(Array.isArray(d.articles)?d.articles:[]).map(x=>({title:x.title||x.domain||"News article",url:x.url||x.url_mobile||"",snippet:[x.domain,x.seendate].filter(Boolean).join(" · "),source:x.domain||"",published:x.seendate||""})).filter(x=>/^https?:\/\//i.test(x.url));if(results.length)return out({query:q,source:"GDELT news index",results});errors.push("GDELT returned no articles")}catch(e){errors.push("GDELT: "+e.message)}
   const feeds=[
    {name:"Google News RSS",url:()=>{const a=new URL("https://news.google.com/rss/search");Object.entries({q,hl:"en-NG",gl:"NG",ceid:"NG:en"}).forEach(([k,v])=>a.searchParams.set(k,v));return a.toString()}},
    {name:"Bing News RSS",url:()=>{const a=new URL("https://www.bing.com/news/search");Object.entries({q,format:"rss",setlang:"en-ng"}).forEach(([k,v])=>a.searchParams.set(k,v));return a.toString()}}
   ];
   for(const feed of feeds){try{const r=await fetch(feed.url(),{headers:{"Accept":"application/rss+xml, application/xml, text/xml","User-Agent":"Mozilla/5.0 (compatible; GOZIESearch/1.3)"},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error("HTTP "+r.status);const xml=await r.text();const results=parseRss(xml);if(results.length)return out({query:q,source:feed.name,results});errors.push(feed.name+": feed returned no readable articles")}catch(e){errors.push(feed.name+": "+e.message)}}
   return out({error:"News providers could not return articles. Please try again shortly.",diagnostic:errors},502);
  }
  const ddg=new URL("https://api.duckduckgo.com/");Object.entries({q,format:"json",no_html:"1",skip_disambig:"1"}).forEach(([k,v])=>ddg.searchParams.set(k,v));
  const wiki=new URL("https://en.wikipedia.org/w/api.php");Object.entries({action:"query",list:"search",srsearch:q,srlimit:"8",srprop:"snippet",format:"json",origin:"*"}).forEach(([k,v])=>wiki.searchParams.set(k,v));
  const settled=await Promise.allSettled([json(ddg.toString()),json(wiki.toString())]),results=[],seen=new Set();
  const add=x=>{if(!x?.url||!/^https?:\/\//i.test(x.url))return;try{const p=new URL(x.url),key=p.hostname.toLowerCase()+p.pathname.replace(/\/+$/,"");if(!seen.has(key)){seen.add(key);results.push(x)}}catch{}};
  if(settled[0].status==="fulfilled"){const d=settled[0].value;if(d.AbstractText&&d.AbstractURL)add({title:d.Heading||q,url:d.AbstractURL,snippet:d.AbstractText,source:"DuckDuckGo"});const walk=items=>{for(const x of items||[]){if(x?.FirstURL&&x?.Text)add({title:x.Text.split(" - ")[0],url:x.FirstURL,snippet:x.Text,source:"DuckDuckGo"});if(Array.isArray(x?.Topics))walk(x.Topics)}};walk(d.RelatedTopics)}
  if(settled[1].status==="fulfilled")for(const p of settled[1].value.query?.search||[])add({title:p.title||q,url:"https://en.wikipedia.org/?curid="+encodeURIComponent(p.pageid),snippet:String(p.snippet||"").replace(/<[^>]*>/g,"").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&"),source:"Wikipedia"});
  if(!results.length&&settled.every(x=>x.status==="rejected"))return out({error:"Search providers are temporarily unavailable. Please try again."},502);
  return out({query:q,source:settled.every(x=>x.status==="fulfilled")?"DuckDuckGo Instant Answer + Wikipedia":settled[0].status==="fulfilled"?"DuckDuckGo Instant Answer":"Wikipedia",results});
 }catch(e){return out({error:route==="/news"?"News providers are temporarily unavailable. Please try again shortly.":route==="/images"?"Image service is temporarily unavailable. Please try again.":"Search providers are temporarily unavailable. Please try again."},502)}
}
};