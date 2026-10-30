
import { safePublicUrl, robotsPathAllowed, extractHtmlMetadata, readTextLimited, robotsAllows, extractPublicPage } from "./search-extract.js";
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