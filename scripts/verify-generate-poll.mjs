import assert from "node:assert/strict";

function jobsUrlFromGenerateUrl(generateUrl) {
  const url = String(generateUrl || "/apps/sugar/generate").replace(/\/+$/, "");
  if (/\/generate$/i.test(url)) {
    return url.replace(/\/generate$/i, "/jobs");
  }
  return "/apps/sugar/jobs";
}

function jobStatusUrl(jobsUrl, jobId) {
  return String(jobsUrl).replace(/\/+$/, "") + "/" + encodeURIComponent(jobId);
}

assert.equal(jobsUrlFromGenerateUrl("/apps/sugar/generate"), "/apps/sugar/jobs");
assert.equal(jobsUrlFromGenerateUrl("/apps/sugar/generate/"), "/apps/sugar/jobs");
assert.equal(jobsUrlFromGenerateUrl(""), "/apps/sugar/jobs");
assert.equal(
  jobStatusUrl("/apps/sugar/jobs", "abc-123"),
  "/apps/sugar/jobs/abc-123",
);

console.log("verify-generate-poll: all checks passed");
