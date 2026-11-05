
import { runSearchProviders, filterSearchResults, rankArticles, canonicalizeResultUrl, filterNewsByDate, diversifyNewsSources, summarizeNewsSourceDiversity } from "./search-providers.js";
import { buildSearchCacheKey, isCacheableSearchRoute } from "./search-cache.js";
import { safePublicUrl, robotsPathAllowed, extractHtmlMetadata, readTextLimited, robotsAllows, extractPublicPage } from "./search-extract.js";
import { buildApiSecurityHeaders, isAllowedApiOrigin } from "./api-security.js";
import { validateApiRequest } from "./api-validation.js";
import { checkApiRateLimit } from "./api-rate-limit.js";
import { createRequestDiagnostic, recordRequestDiagnostic } from "./diagnostics.js";
import { normalizeNewsArticleUrl } from "./news-url.js";
export async function runSearch(request, env = {}) {
  const u=new URL(request.url),route=u.pathname,q=(u.searchParams.get("q")||"").trim();
  const cacheable=isCacheableSearchRoute(route)&&!request.headers.has("Authorization");
  const out=(data,status=200,extraHeaders={})=>new Response(JSON.stringify(data),{
   status,
   headers:{
    "Content-Type":"application/json; charset=UTF-8",
    "Cache-Control":status===200&&cacheable?"public, max-age=60, s-maxage=60, stale-while-revalidate=300":"no-store",
    ...extraHeaders
   }
  });
  if(request.method!=="GET")return out({error:"Method not allowed."},405);
  if(route!=="/"&&!["/search","/images","/news","/extract"].includes(route))return out({error:"Not found."},404);
  if(route==="/")return out({name:"GOZIE SEARCH API",status:"online",endpoints:["/search?q=technology","/images?q=cats","/news?q=technology"]});
  const validation=validateApiRequest(u);
  if(!validation.valid)return out({error:validation.error},400);
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
   const newsDateFilters={date:u.searchParams.get("date")||"any",from:u.searchParams.get("from")||"",to:u.searchParams.get("to")||""};
   const validatedNewsDates=filterNewsByDate([],newsDateFilters);
   if(!validatedNewsDates.valid)return out({error:validatedNewsDates.error},400);
   const normalizeDate=value=>{
    const raw=String(value||"").trim();
    if(!raw)return "";
    const compact=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
    const candidate=compact?compact[1]+"-"+compact[2]+"-"+compact[3]+"T"+compact[4]+":"+compact[5]+":"+compact[6]+"Z":raw;
    const timestamp=Date.parse(candidate);
    return Number.isFinite(timestamp)?new Date(timestamp).toISOString():"";
   };
   const rssText=value=>String(value||"")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
    .replace(/<[^>]*>/g," ")
    .replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">")
    .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n))
    .replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))
    .replace(/\s+/g," ").trim();
   const rssTag=(item,name)=>{
    const match=String(item||"").match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+name+">","i"));
    return match?rssText(match[1]):"";
   };
   const parseNewsRss=(xml,provider)=>{
    const results=[];
    for(const match of String(xml||"").matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)){
     const item=match[1],title=rssTag(item,"title"),url=normalizeNewsArticleUrl(rssTag(item,"link"));
     const source=rssTag(item,"source")||provider;
     const published=normalizeDate(rssTag(item,"pubDate"));
     const description=rssTag(item,"description");
     if(title&&canonicalizeResultUrl(url))results.push({title:title.slice(0,250),url,snippet:[source,published,description].filter(Boolean).join(" · ").slice(0,1200),source, sources:[source],provider,providers:[provider],published});
     if(results.length>=20)break;
    }
    return results;
   };
   const providers=[
    {
     name:"GDELT",
     search:async()=>{
      const endpoint=new URL("https://api.gdeltproject.org/api/v2/doc/doc");
      Object.entries({query:q,mode:"artlist",format:"json",maxrecords:"20",sort:"datedesc"}).forEach(([k,v])=>endpoint.searchParams.set(k,v));
      const data=await json(endpoint.toString(),10000);
      return (Array.isArray(data.articles)?data.articles:[]).map(item=>{
       const url=normalizeNewsArticleUrl(item.url||item.url_mobile||"");
       const source=String(item.domain||"GDELT").trim();
       const published=normalizeDate(item.seendate||item.published||"");
       return {title:String(item.title||item.domain||"News article").trim().slice(0,250),url,snippet:[source,published].filter(Boolean).join(" · ").slice(0,1200),source,sources:[source],provider:"GDELT",providers:["GDELT"],published};
      }).filter(item=>item.title.length>=8&&canonicalizeResultUrl(item.url));
     }
    },
    {
     name:"Google News RSS",
     search:async()=>{
      const endpoint=new URL("https://news.google.com/rss/search");
      Object.entries({q,hl:"en-NG",gl:"NG",ceid:"NG:en"}).forEach(([k,v])=>endpoint.searchParams.set(k,v));
      const response=await fetch(endpoint.toString(),{headers:{"Accept":"application/rss+xml, application/xml, text/xml","User-Agent":"GOZIE-SEARCH/1.0 news-search"},signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error("HTTP "+response.status);
      return parseNewsRss(await response.text(),"Google News RSS");
     }
    },
    {
     name:"Bing News RSS",
     search:async()=>{
      const endpoint=new URL("https://www.bing.com/news/search");
      Object.entries({q,format:"rss",setlang:"en-ng"}).forEach(([k,v])=>endpoint.searchParams.set(k,v));
      const response=await fetch(endpoint.toString(),{headers:{"Accept":"application/rss+xml, application/xml, text/xml","User-Agent":"GOZIE-SEARCH/1.0 news-search"},signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error("HTTP "+response.status);
      return parseNewsRss(await response.text(),"Bing News RSS");
     }
    },
    ...[
     {name:"BBC News World",url:"https://feeds.bbci.co.uk/news/world/rss.xml"},
     {name:"Al Jazeera English",url:"https://www.aljazeera.com/xml/rss/all.xml"},
     {name:"The Guardian World",url:"https://www.theguardian.com/world/rss"},
     {name:"NPR News",url:"https://feeds.npr.org/1001/rss.xml"}
    ].map(feed=>({
     name:feed.name,
     search:async()=>{
      const response=await fetch(feed.url,{headers:{"Accept":"application/rss+xml, application/xml, text/xml","User-Agent":"GOZIE-SEARCH/1.0 news-search"},signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw Error("HTTP "+response.status);
      // These publisher feeds are broad, so the query ranker filters unrelated headlines.
      return parseNewsRss(await response.text(),feed.name);
     }
    }))
   ];
   // Query all live news providers in parallel. A healthy source contributes
   // even when another provider times out, returns an error, or has an empty feed.
   const settled=await Promise.allSettled(providers.map(provider=>provider.search()));
   const merged=new Map(),successfulProviders=[],failedProviders=[];
   for(let index=0;index<settled.length;index++){
    const outcome=settled[index],provider=providers[index].name;
    if(outcome.status==="rejected"){
     failedProviders.push({provider,message:String(outcome.reason?.message||"Provider request failed").slice(0,240)});
     continue;
    }
    successfulProviders.push(provider);
    for(const item of (Array.isArray(outcome.value)?outcome.value:[])){
     const canonical=canonicalizeResultUrl(item.url);
     if(!canonical)continue;
     const existing=merged.get(canonical);
     if(!existing){merged.set(canonical,{...item,canonicalUrl:canonical});continue;}
     existing.sources=[...new Set([...(existing.sources||[]),...(item.sources||[item.source]).filter(Boolean)])];
     existing.providers=[...new Set([...(existing.providers||[]),...(item.providers||[provider]).filter(Boolean)])];
     if(String(item.snippet||"").length>String(existing.snippet||"").length)existing.snippet=item.snippet;
     if(!existing.published||(item.published&&Date.parse(item.published)>Date.parse(existing.published)))existing.published=item.published;
     if(String(item.title||"").length>String(existing.title||"").length)existing.title=item.title;
    }
   }
   const liveResults=rankArticles([...merged.values()],q).filter(item=>item.relevanceScore>0);
   const filteredLiveNews=filterNewsByDate(liveResults,newsDateFilters);
   if(liveResults.length){
    const diverseLiveNews=diversifyNewsSources(filteredLiveNews.results);
    return out({
     query:q,
     source:successfulProviders.join(" + ")||"News providers",
     providers:successfulProviders,
     attemptedProviders:providers.length,
     failedProviders,
     availableDateFilters:["any","day","week","month","year"],
     appliedFilters:filteredLiveNews.appliedFilters,
     totalResults:diverseLiveNews.length,
     sourceDiversity:summarizeNewsSourceDiversity(diverseLiveNews),
     results:diverseLiveNews.map(item=>({
      ...item,
      originalUrl:item.originalUrl||item.url,
      preview:{
       publisher:(Array.isArray(item.sources)?item.sources[0]:"")||item.source||item.domain||"",
       summary:String(item.snippet||"").slice(0,1200),
       published:item.published||"",
       url:item.originalUrl||item.url
      }
     }))
    });
   }
   const errors=failedProviders.map(item=>item.provider+": "+item.message);
   errors.push(...successfulProviders.filter(name=>!providers.some(provider=>provider.name===name&&settled[providers.indexOf(provider)].status==="fulfilled"&&Array.isArray(settled[providers.indexOf(provider)].value)&&settled[providers.indexOf(provider)].value.length)).map(name=>name+": no readable articles"));
   // When live sources are unavailable or empty, use GOZIE's bounded daily index.
   try{
    const indexedUrl=new URL("https://gozie-search-media.henrymeraldcompany.workers.dev/index/search");
    indexedUrl.searchParams.set("kind","news");
    indexedUrl.searchParams.set("q",q);
    indexedUrl.searchParams.set("limit","20");
    const indexed=await json(indexedUrl.toString(),6000);
    const results=(Array.isArray(indexed.results)?indexed.results:[]).map(item=>{
     const url=typeof item?.url==="string"?item.url:"";
     const source=typeof item?.source==="string"&&item.source?item.source:(item?.domain||"");
     return {title:typeof item?.title==="string"?item.title:"",url,snippet:typeof item?.snippet==="string"?item.snippet:"",source,sources:[source].filter(Boolean),provider:"GOZIE daily news index",providers:["GOZIE daily news index"],published:normalizeDate(item?.published_at||"")};
    }).filter(item=>item.title.trim().length>=8&&canonicalizeResultUrl(item.url));
    if(results.length){
     const rankedIndexedNews=rankArticles(results,q);
     const filteredIndexedNews=filterNewsByDate(rankedIndexedNews,newsDateFilters);
     const diverseIndexedNews=diversifyNewsSources(filteredIndexedNews.results);
     return out({query:q,source:"GOZIE daily news index",fallback:"daily-index",providers:successfulProviders,attemptedProviders:providers.length,failedProviders,availableDateFilters:["any","day","week","month","year"],appliedFilters:filteredIndexedNews.appliedFilters,totalResults:diverseIndexedNews.length,sourceDiversity:summarizeNewsSourceDiversity(diverseIndexedNews),results:diverseIndexedNews.map(item=>({
      ...item,
      originalUrl:item.originalUrl||item.url,
      preview:{
       publisher:(Array.isArray(item.sources)?item.sources[0]:"")||item.source||item.domain||"",
       summary:String(item.snippet||"").slice(0,1200),
       published:item.published||"",
       url:item.originalUrl||item.url
      }
     }))});
    }
    errors.push("GOZIE daily news index: no indexed articles");
   }catch(error){errors.push("GOZIE daily news index: "+error.message)}
   return out({error:"News providers could not return articles. Please try again shortly.",diagnostic:errors,providers:successfulProviders,attemptedProviders:providers.length,failedProviders},502);
  }
  const providers = [
   {
    name: "DuckDuckGo",
    search: async query => {
     const endpoint = new URL("https://api.duckduckgo.com/");
     Object.entries({q:query,format:"json",no_html:"1",skip_disambig:"1"}).forEach(([k,v])=>endpoint.searchParams.set(k,v));
     const data = await json(endpoint.toString());
     const items = [];
     if (data.AbstractText && data.AbstractURL) items.push({title:data.Heading||query,url:data.AbstractURL,snippet:data.AbstractText,source:"DuckDuckGo"});
     const walk = topics => {
      for (const item of topics || []) {
       if (item?.FirstURL && item?.Text) items.push({title:item.Text.split(" - ")[0],url:item.FirstURL,snippet:item.Text,source:"DuckDuckGo"});
       if (Array.isArray(item?.Topics)) walk(item.Topics);
      }
     };
     walk(data.RelatedTopics);
     return items;
    }
   },
   {
    name: "Wikipedia",
    search: async query => {
     const endpoint = new URL("https://en.wikipedia.org/w/api.php");
     Object.entries({action:"query",list:"search",srsearch:query,srlimit:"8",srprop:"snippet",format:"json",origin:"*"}).forEach(([k,v])=>endpoint.searchParams.set(k,v));
     const data = await json(endpoint.toString());
     return (data.query?.search || []).map(page => ({
      title:page.title||query,
      url:"https://en.wikipedia.org/?curid="+encodeURIComponent(page.pageid),
      snippet:String(page.snippet||"").replace(/<[^>]*>/g,"").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&"),
      source:"Wikipedia"
     }));
    }
   },
   ...(typeof env.SEARXNG_URL === "string" && env.SEARXNG_URL.trim() ? [{
    name: "SearXNG",
    search: async query => {
     let endpoint;
     try {
      const base = new URL(env.SEARXNG_URL.trim());
      if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
       throw new Error("SEARXNG_URL must be an HTTPS instance URL without credentials, query, or fragment");
      }
      base.pathname = base.pathname.replace(/\/+$/, "") + "/search";
      endpoint = base;
     } catch (error) {
      throw new Error(error.message || "SEARXNG_URL is invalid");
     }
     endpoint.searchParams.set("q", query);
     endpoint.searchParams.set("format", "json");
     endpoint.searchParams.set("safesearch", "1");
     endpoint.searchParams.set("language", "en");
     const data = await json(endpoint.toString(), 8000);
     return (Array.isArray(data.results) ? data.results : []).map(item => ({
      title: item.title || "",
      url: item.url || "",
      snippet: item.content || item.description || "",
      source: item.engine || "SearXNG",
      published: item.publishedDate || ""
     }));
    }
   }] : [])
  ];
  const {results:allResults,providers:successfulProviders,failures,attempted} = await runSearchProviders(providers,q);
  const filters = { domain: u.searchParams.get("domain") || "", source: u.searchParams.get("source") || "", date: u.searchParams.get("date") || "any" };
  const results = filterSearchResults(allResults, filters);
  if (!allResults.length && successfulProviders.length === 0) {
   return out({error:"Search providers are temporarily unavailable. Please try again.",diagnostic:failures},502);
  }
  return out({
   query:q,
   source:successfulProviders.join(" + ") || "No providers available",
   providers:successfulProviders,
   attemptedProviders:attempted,
   failedProviders:failures,
   availableFilters: { domains: [...new Set(allResults.map(item => item.domain).filter(Boolean))].sort(), sources: [...new Set(allResults.flatMap(item => item.sources || [item.source]).filter(Boolean))].sort() },
   appliedFilters: { domain: filters.domain || null, source: filters.source || null, date: filters.date },
   totalResults: allResults.length,
   results
  });
 }catch(e){return out({error:route==="/news"?"News providers are temporarily unavailable. Please try again shortly.":route==="/images"?"Image service is temporarily unavailable. Please try again.":"Search providers are temporarily unavailable. Please try again.",diagnostic:route==="/news"?String(e&&e.message||e).slice(0,240):undefined},502)}
}

export default {
 async fetch(request, env = {}, ctx = {}) {
  const diagnostic = createRequestDiagnostic(request, "henry-search-api");
  const origin=request.headers.get("Origin")||"";
  const cors=buildApiSecurityHeaders(origin,env);
  const gatewayOut=(data,status=200,extraHeaders={})=>new Response(JSON.stringify(data),{
   status,
   headers:{
    ...cors,
    "Content-Type":"application/json; charset=UTF-8",
    "Cache-Control":"no-store",
    "X-GOZIE-Cache":"BYPASS",
    "X-GOZIE-RateLimit":"not-checked",
    ...extraHeaders
   }
  });
  if(request.method==="OPTIONS")return new Response(null,{status:origin&&!isAllowedApiOrigin(origin,env)?403:204,headers:cors});
  if(request.method!=="GET")return gatewayOut({error:"Method not allowed."},405);
  const url=new URL(request.url),route=url.pathname;
  if(route!=="/"&&!["/search","/images","/news","/extract"].includes(route))return gatewayOut({error:"Not found."},404);
  try {
  const rateLimit=await checkApiRateLimit(request,env,route);
  const rateLimitState=rateLimit.configured?"active":"degraded";
  if(!rateLimit.allowed){
   const policy=String(rateLimit.limit)+";w="+String(rateLimit.period);
   return gatewayOut({error:"Too many requests. Please wait before trying again."},429,{
    "X-GOZIE-RateLimit":rateLimitState,
    "Retry-After":String(rateLimit.period),
    "RateLimit-Limit":String(rateLimit.limit),
    "RateLimit-Policy":policy
   });
  }
  let response;
  const canUseCache=isCacheableSearchRoute(route)&&!request.headers.has("Authorization")&&Boolean(ctx?.exports?.CachedSearch?.fetch);
  if(canUseCache){
   const normalizedUrl=new URL(buildSearchCacheKey(url));
   response=await ctx.exports.CachedSearch.fetch(request,{
    cf:{cacheKey:normalizedUrl.pathname+normalizedUrl.search}
   });
  }else{
   response=await runSearch(request,env);
  }
  const headers=new Headers(response.headers);
  for(const [name,value] of Object.entries(cors))headers.set(name,value);
  if(!Object.prototype.hasOwnProperty.call(cors,"Access-Control-Allow-Origin"))headers.delete("Access-Control-Allow-Origin");
  headers.set("X-GOZIE-RateLimit",rateLimitState);
  const cacheStatus=response.headers.get("Cf-Cache-Status");
  headers.set("X-GOZIE-Cache",cacheStatus||(canUseCache?"MISS":"BYPASS"));
  recordRequestDiagnostic(diagnostic, response.status);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  } catch(error) {
   recordRequestDiagnostic(diagnostic, 503, error);
   return gatewayOut({error:"The search service is temporarily unavailable. Please try again shortly."},503,{
    "Retry-After":"5",
    "X-GOZIE-RateLimit":"degraded",
    "X-GOZIE-Cache":"BYPASS"
   });
  }
 }
};
