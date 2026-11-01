import assert from "node:assert/strict";
import test from "node:test";
import { createWikimediaVideoProvider } from "./wikimedia-video-search.js";

test("queries Wikimedia Commons for video files and normalizes metadata", async () => {
  let requested;
  const search = createWikimediaVideoProvider({
    requestJson: async url => {
      requested = new URL(url);
      return {query:{pages:{
        1:{pageid:1,title:"File:Earth.webm",imageinfo:[{mime:"video/webm",url:"https://upload.wikimedia.org/earth.webm",thumburl:"https://upload.wikimedia.org/earth.jpg",descriptionurl:"https://commons.wikimedia.org/wiki/File:Earth.webm",extmetadata:{Artist:{value:"NASA"},LicenseShortName:{value:"CC BY 4.0"},ImageDescription:{value:"Earth from orbit"}}}]},
        2:{pageid:2,title:"File:Poster.jpg",imageinfo:[{mime:"image/jpeg",url:"https://upload.wikimedia.org/poster.jpg",descriptionurl:"https://commons.wikimedia.org/wiki/File:Poster.jpg"}]},
        3:{pageid:3,title:"File:Unsafe.webm",imageinfo:[{mime:"video/webm",url:"javascript:alert(1)",descriptionurl:"https://commons.wikimedia.org/wiki/File:Unsafe.webm"}]}
      }}};
    }
  });
  const rows = await search("earth from space");
  assert.equal(requested.hostname,"commons.wikimedia.org");
  assert.match(requested.searchParams.get("gsrsearch"),/^filetype:video earth from space$/);
  assert.equal(rows.length,1);
  assert.equal(rows[0].source,"Wikimedia Commons");
  assert.equal(rows[0].title,"Earth.webm");
  assert.equal(rows[0].author,"NASA");
  assert.equal(rows[0].license,"CC BY 4.0");
  assert.equal(rows[0].thumbnail_url,"https://upload.wikimedia.org/earth.jpg");
  assert.equal(rows[0].nsfw,0);
});

test("returns no results for an empty query and rejects non-video MIME types", async () => {
  let calls=0;
  const search=createWikimediaVideoProvider({requestJson:async()=>{calls++;return {query:{pages:{1:{title:"File:image.png",imageinfo:[{mime:"image/png",url:"https://example.com/a",descriptionurl:"https://commons.wikimedia.org/wiki/File:a"}]}}}};}});
  assert.deepEqual(await search("  "),[]);
  assert.equal(calls,0);
  assert.deepEqual(await search("test"),[]);
  assert.equal(calls,1);
});
