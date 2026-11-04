import assert from "node:assert/strict";
import test from "node:test";
import { createRequestDiagnostic, recordRequestDiagnostic } from "./diagnostics.js";

test("diagnostic context excludes query strings", () => {
 const request = new Request("https://api.example/search?q=hidden", { headers: { "cf-ray": "abc123" } });
 const context = createRequestDiagnostic(request, "henry-search-api");
 assert.equal(context.requestId, "abc123");
 assert.equal(context.route, "/search");
 assert.equal(JSON.stringify(context).includes("hidden"), false);
});

test("fast successful requests are not logged", () => {
 const original = console.error;
 let logged = false;
 console.error = () => { logged = true; };
 try { recordRequestDiagnostic({ requestId:"r1", service:"test", method:"GET", route:"/search", startedAt:Date.now() }, 200); }
 finally { console.error = original; }
 assert.equal(logged, false);
});

test("server failures emit structured diagnostic events", () => {
 const original = console.error;
 let line = "";
 console.error = value => { line = String(value); };
 try { recordRequestDiagnostic({ requestId:"r2", service:"henry-search-api", method:"GET", route:"/news", startedAt:Date.now()-10 }, 502); }
 finally { console.error = original; }
 const event = JSON.parse(line);
 assert.equal(event.event, "http-request-diagnostic");
 assert.equal(event.status, 502);
 assert.equal(event.outcome, "error");
 assert.equal(event.route, "/news");
});

test("slow successful requests emit warning diagnostics", () => {
 const original = console.warn;
 let line = "";
 console.warn = value => { line = String(value); };
 try { recordRequestDiagnostic({ requestId:"r3", service:"test", method:"GET", route:"/search", startedAt:Date.now()-1600 }, 200); }
 finally { console.warn = original; }
 const event = JSON.parse(line);
 assert.equal(event.outcome, "slow");
 assert.equal(event.status, 200);
 assert.ok(event.durationMs >= 1500);
});
