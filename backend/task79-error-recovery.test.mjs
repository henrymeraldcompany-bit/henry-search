import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
test("Task 79 gateway contains a retryable recovery response", async () => {
 const source = await readFile(new URL("./search-worker.js", import.meta.url), "utf8");
 assert.match(source, /Retry-After/);
 assert.match(source, /temporarily unavailable/);
});
