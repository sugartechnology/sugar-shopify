(function (global) {
  "use strict";

  var DEFAULT_POLL_MS = 2000;
  var DEFAULT_MAX_MS = 180000;

  function jobsUrlFromGenerateUrl(generateUrl) {
    var url = String(generateUrl || "/apps/sugar/generate").replace(/\/+$/, "");
    if (/\/generate$/i.test(url)) {
      return url.replace(/\/generate$/i, "/jobs");
    }
    return "/apps/sugar/jobs";
  }

  function jobStatusUrl(jobsUrl, jobId) {
    return String(jobsUrl).replace(/\/+$/, "") + "/" + encodeURIComponent(jobId);
  }

  function cloneFormData(formData) {
    var copy = new FormData();
    formData.forEach(function (value, key) {
      copy.append(key, value);
    });
    return copy;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function requestGenerateWithPoll(options) {
    var generateUrl = options.generateUrl || "/apps/sugar/generate";
    var jobsUrl = jobsUrlFromGenerateUrl(generateUrl);
    var parse = options.parseResponse;
    var t = options.t;
    var formData = options.formData;
    var pollMs = options.pollMs || DEFAULT_POLL_MS;
    var maxMs = options.maxMs || DEFAULT_MAX_MS;
    var failMessage = t("errorGenerate", "Could not create design.");

    var startRes = await fetch(jobsUrl, {
      method: "POST",
      body: cloneFormData(formData),
    });
    if (startRes.status === 404 || startRes.status === 405) {
      var syncRes = await fetch(generateUrl, { method: "POST", body: formData });
      var syncData = await parse(syncRes);
      if (!syncRes.ok || syncData.status === "failed") {
        throw new Error(syncData.message || failMessage);
      }
      return syncData;
    }

    var startData = await parse(startRes);
    if (!startRes.ok || startData.status === "failed") {
      throw new Error(startData.message || failMessage);
    }
    if (startData.status === "completed" && startData.imageUrl) {
      return startData;
    }

    var jobId = startData.jobId;
    if (!jobId) {
      throw new Error(failMessage);
    }

    var started = Date.now();
    while (Date.now() - started < maxMs) {
      await sleep(pollMs);
      var pollRes = await fetch(jobStatusUrl(jobsUrl, jobId));
      var pollData = await parse(pollRes);
      if (pollData.status === "completed") return pollData;
      if (pollData.status === "failed" || pollRes.status === 404) {
        throw new Error(pollData.message || failMessage);
      }
    }

    throw new Error(
      t(
        "errorGenerateTimeout",
        "Design is taking longer than expected. Please try again.",
      ),
    );
  }

  global.SugarPdpKit = global.SugarPdpKit || {};
  global.SugarPdpKit.generate = {
    jobsUrlFromGenerateUrl: jobsUrlFromGenerateUrl,
    jobStatusUrl: jobStatusUrl,
    requestGenerateWithPoll: requestGenerateWithPoll,
  };
})(window);
