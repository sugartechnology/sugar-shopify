import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTagService, downloadResultFile } from "../services/tag-service.server";

const BASE = "https://gateway.test";

/** Records every call and answers from a queue. */
function fakeFetch(answers: Array<() => Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = answers.shift();
    if (!next) throw new Error("unexpected call");
    return next();
  }) as typeof fetch;
  return { fetchFn, calls };
}

const jsonAnswer = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("koshoy tag-service client", () => {
  it("sends the room photo as a file with the shop key and reads the job", async () => {
    const { fetchFn, calls } = fakeFetch([
      jsonAnswer(202, { jobId: "job-1", status: "processing" }),
      jsonAnswer(200, { jobId: "job-1", status: "completed", result: { width: 4 } }),
      jsonAnswer(404, { jobId: "job-1", status: "expired" }),
      jsonAnswer(200, { jobId: "job-1", status: "failed", error: "OOM in decor-ai" }),
      jsonAnswer(429, { error: "rate_limited" }),
      jsonAnswer(500, {}),
    ]);
    const tag = createTagService("shop-key", fetchFn, BASE);
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 1]);

    assert.deepEqual(await tag.startRoomAnalysis(photo, 72), { ok: true, jobId: "job-1" });
    const [start] = calls;
    assert.equal(start.url, `${BASE}/api/shopify/room-analysis/jobs`);
    assert.equal(start.init.method, "POST");
    assert.equal((start.init.headers as Record<string, string>).Authorization, "Bearer shop-key");
    const form = start.init.body as FormData;
    const image = form.get("image") as File;
    assert.equal(image.type, "image/jpeg");
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), photo);
    assert.equal(form.get("fovDegrees"), "72");
    assert.equal(form.get("imageUrl"), null);

    assert.deepEqual(await tag.getRoomAnalysis("job-1"), { status: "completed", result: { width: 4 } });
    assert.equal(calls[1].url, `${BASE}/api/shopify/room-analysis/jobs/job-1`);
    assert.deepEqual(await tag.getRoomAnalysis("job-1"), { status: "expired" });
    assert.deepEqual(await tag.getRoomAnalysis("job-1"), { status: "failed" });
    assert.deepEqual(await tag.startRoomAnalysis(photo), { ok: false, status: 429 });
    await assert.rejects(tag.getRoomAnalysis("job-1"));
  });

  it("runs koshoy-render through the pipeline endpoint and reads the image job", async () => {
    const { fetchFn, calls } = fakeFetch([
      jsonAnswer(202, { jobId: "r-1", status: "processing" }),
      jsonAnswer(200, { jobId: "r-1", status: "processing" }),
      jsonAnswer(200, { jobId: "r-1", status: "completed", imageUrl: "https://x/out.png", mimeType: "image/png" }),
      jsonAnswer(400, { jobId: "r-2", status: "failed", error: "pipeline not allowed" }),
    ]);
    const tag = createTagService("shop-key", fetchFn, BASE);
    const input = {
      roomImageUrl: "https://s/room.jpg",
      compositeImageUrl: "https://s/composite.jpg",
      cabinetImageUrl: "https://s/cabinet.jpg",
      cabinetDescription: "2 kapaklı gardırop",
    };

    assert.deepEqual(await tag.startRender(input), { ok: true, jobId: "r-1" });
    assert.equal(calls[0].url, `${BASE}/api/shopify/pdp/pipelines/run-async?pipeline=koshoy-render`);
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), input);
    assert.deepEqual(await tag.getRender("r-1"), { status: "processing" });
    assert.equal(calls[1].url, `${BASE}/api/shopify/pdp/jobs/r-1`);
    assert.deepEqual(await tag.getRender("r-1"), {
      status: "completed",
      imageUrl: "https://x/out.png",
      imageBase64: "",
      mimeType: "image/png",
    });
    assert.deepEqual(await tag.startRender(input), { ok: false, status: 400 });
  });

  it("downloads result files over https only", async () => {
    const { fetchFn, calls } = fakeFetch([
      () => new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "image/png" } }),
      () => new Response(null, { status: 404 }),
    ]);
    assert.equal(await downloadResultFile("http://10.0.0.5/depth.png", fetchFn), null);
    assert.equal(calls.length, 0);
    const file = await downloadResultFile("https://x/depth.png", fetchFn);
    assert.deepEqual(file, { bytes: new Uint8Array([1, 2]), contentType: "image/png" });
    assert.equal(await downloadResultFile("https://x/gone.png", fetchFn), null);
  });

  it("refuses an oversized file before or while reading it", async () => {
    let pulled = 0;
    const endless = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1;
            controller.enqueue(new Uint8Array(4));
          },
        }),
      );
    const { fetchFn } = fakeFetch([
      () => new Response(new Uint8Array(8), { headers: { "Content-Length": "8" } }),
      endless,
      () => new Response(new Uint8Array(8)),
    ]);
    await assert.rejects(downloadResultFile("https://x/declared.png", fetchFn, 6), /too large/);
    await assert.rejects(downloadResultFile("https://x/endless.png", fetchFn, 10), /too large/);
    assert.ok(pulled <= 4, "stops reading once past the limit");
    const fits = await downloadResultFile("https://x/fits.png", fetchFn, 8);
    assert.equal(fits?.bytes.length, 8);
  });
});
