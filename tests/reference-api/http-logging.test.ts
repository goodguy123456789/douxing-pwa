import assert from "node:assert/strict";
import { request } from "node:http";
import { once } from "node:events";
import { Writable } from "node:stream";
import test from "node:test";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { httpLoggingOptions, privateErrorHandler, safeRequestUrl } from "../src/lib/http-logging";

const credential = "private-participant-credential";
const preference = "private-cuisine-and-nickname";

test("URL allowlist redacts secrets including encoded, malformed and unknown paths", () => {
  const prefix = "/api/rooms/AB23";
  for (const path of [
    `/participants/${credential}`,
    `/participants/${encodeURIComponent(credential)}/extra`,
    `/%70articipants/${credential}`,
    `/participants%2F${credential}`,
    `/participants/${credential}%ZZ`,
    `/unknown/${preference}`,
  ]) {
    const url = safeRequestUrl(prefix + path + `?participantId=${credential}#${preference}`);
    assert.ok(!url.includes(credential));
    assert.ok(!url.includes(preference));
    assert.ok(!url.includes("?"));
  }
  assert.equal(safeRequestUrl(`${prefix}/participants/${credential}`), `${prefix}/participants/[REDACTED]`);
  for (const suffix of ["join", "preferences", "reset", "recommendations/reroll"]) {
    assert.equal(safeRequestUrl(`${prefix}/${suffix}?secret=${credential}`), `${prefix}/${suffix}`);
  }
  assert.equal(safeRequestUrl("/api/healthz"), "/api/healthz");
  assert.equal(safeRequestUrl(undefined), "[REDACTED]");
});

test("real HTTP request, response and error logs exclude all private input", async (t) => {
  let output = "";
  let stderr = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) { output += chunk.toString(); callback(); },
  });
  const logger = pino({}, stream);
  const app = express();
  app.use(pinoHttp({
    logger,
    ...httpLoggingOptions,
    customReceivedMessage: () => "request received",
  }));
  app.use(express.json());
  app.use((req, res) => {
    req.log.info({ req, res }, "handling request");
    if (req.path.endsWith("/error")) {
      const error = Object.assign(new Error(`${credential} ${preference}`), {
        cause: new Error(preference),
        query: `insert ${credential}`,
        params: [credential, preference],
        body: req.body,
      });
      req.log.error({ err: error, req, res }, "request failed");
      throw error;
    }
    if (req.path.endsWith("/unavailable")) {
      res.status(503).json({ participantId: credential, ownDraft: preference });
      return;
    }
    res.json({ participantId: credential, ownDraft: preference });
  });
  app.use(privateErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  // Capture Express's default error-output channel as well as Pino output.
  const originalWrite = process.stderr.write;
  process.stderr.write = ((chunk: unknown) => { stderr += String(chunk); return true; }) as typeof process.stderr.write;
  t.after(() => { process.stderr.write = originalWrite; });
  async function send(path: string, body?: string) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({
        host: "127.0.0.1", port: address.port, path, method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${credential}`,
          cookie: `participant=${credential}`,
          referer: `https://example.test/${credential}`,
        },
      }, res => {
        let data = "";
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode!, body: data }));
      });
      req.on("error", reject);
      req.end(body);
    });
  }
  const prefix = "/api/rooms/AB23";
  const privateBody = JSON.stringify({
    participantId: credential, nickname: preference,
    cuisinePreferences: [{ cuisine: preference, attitude: "avoid" }],
  });
  assert.equal((await send(`${prefix}/participants/${credential}?draft=${preference}`, privateBody)).status, 200);
  assert.equal((await send(`${prefix}/preferences`, privateBody)).status, 200);
  assert.equal((await send(`${prefix}/reset`, privateBody)).status, 200);
  assert.equal((await send(`${prefix}/recommendations/reroll`, privateBody)).status, 200);
  const failed = await send(`${prefix}/participants/${credential}/error`, privateBody);
  assert.equal(failed.status, 500);
  assert.ok(!failed.body.includes(credential));
  assert.ok(!failed.body.includes(preference));
  assert.equal((await send(`${prefix}/preferences`, `{"nickname":"${preference}",bad`)).status, 400);
  assert.equal((await send(`${prefix}/unavailable`, privateBody)).status, 503);
  await new Promise(resolve => setImmediate(resolve));

  for (const secret of [credential, preference, "cuisinePreferences", "authorization", "ownDraft"]) {
    assert.ok(!(output + stderr).includes(secret), `logged private field: ${secret}`);
  }
  assert.equal(stderr, "");
  const records = output.trim().split("\n").map(line => JSON.parse(line));
  const completed = records.filter(record => ["request completed", "request errored"].includes(record.msg));
  assert.deepEqual(completed.map(record => record.res.statusCode), [200, 200, 200, 200, 500, 400, 503]);
  assert.equal(records.filter(record => record.msg === "request received").length, 7);
  for (const record of records) {
    assert.equal(record.req.method, "POST");
    assert.ok(record.req.url.includes("/rooms/AB23/"));
    assert.deepEqual(Object.keys(record.req).sort(), ["id", "method", "url"]);
    if (record.err) assert.deepEqual(Object.keys(record.err).filter(key => key !== "statusCode"), ["type"]);
  }
  assert.ok(records.some(record => record.req.url === `${prefix}/participants/[REDACTED]`));
  assert.ok(records.some(record => record.err?.statusCode === 400));
});
