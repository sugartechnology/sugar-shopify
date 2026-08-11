/**
 * Shared image helpers for Sugar uploads (HEIC/HEIF from Apple devices).
 */
(function (global) {
  "use strict";

  var IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|tif{1,2})$/i;
  var HEIC_EXT_RE = /\.hei[cf]$/i;
  var heicLoader = null;

  function fileName(file) {
    return String((file && file.name) || "");
  }

  function fileType(file) {
    return String((file && file.type) || "").toLowerCase();
  }

  function isHeicLike(file) {
    if (!file) return false;
    var type = fileType(file);
    if (
      type === "image/heic" ||
      type === "image/heif" ||
      type === "image/heic-sequence" ||
      type === "image/heif-sequence"
    ) {
      return true;
    }
    return HEIC_EXT_RE.test(fileName(file));
  }

  function isLikelyImageFile(file) {
    if (!file) return false;
    var type = fileType(file);
    if (type.indexOf("image/") === 0) return true;
    // iOS/macOS sometimes leaves MIME empty for HEIC / Photos exports
    return IMAGE_EXT_RE.test(fileName(file));
  }

  function jpegFileName(name) {
    var base = String(name || "room").replace(HEIC_EXT_RE, "");
    if (!base || base === String(name || "")) base = "room";
    return base + ".jpg";
  }

  function blobToJpegFile(blob, originalName) {
    return new File([blob], jpegFileName(originalName), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  }

  function convertViaBitmap(file) {
    if (typeof createImageBitmap !== "function") {
      return Promise.reject(new Error("createImageBitmap unavailable"));
    }
    return createImageBitmap(file).then(function (bitmap) {
      var canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      var ctx = canvas.getContext("2d");
      if (!ctx) {
        try {
          bitmap.close();
        } catch (e) {
          /* ignore */
        }
        return Promise.reject(new Error("canvas unavailable"));
      }
      ctx.drawImage(bitmap, 0, 0);
      try {
        bitmap.close();
      } catch (e2) {
        /* ignore */
      }
      return new Promise(function (resolve, reject) {
        canvas.toBlob(
          function (blob) {
            if (!blob) {
              reject(new Error("jpeg encode failed"));
              return;
            }
            resolve(blobToJpegFile(blob, fileName(file)));
          },
          "image/jpeg",
          0.92,
        );
      });
    });
  }

  function loadHeic2Any(scriptUrl) {
    if (typeof global.heic2any === "function") {
      return Promise.resolve(global.heic2any);
    }
    if (!scriptUrl) {
      return Promise.reject(new Error("heic2any url missing"));
    }
    if (heicLoader) return heicLoader;
    heicLoader = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-sugar-heic2any="1"]');
      if (existing && typeof global.heic2any === "function") {
        resolve(global.heic2any);
        return;
      }
      var script = existing || document.createElement("script");
      var settled = false;
      function onReady() {
        if (settled) return;
        if (typeof global.heic2any === "function") {
          settled = true;
          resolve(global.heic2any);
        } else {
          settled = true;
          heicLoader = null;
          reject(new Error("heic2any failed to load"));
        }
      }
      function onError() {
        if (settled) return;
        settled = true;
        heicLoader = null;
        reject(new Error("heic2any failed to load"));
      }
      script.addEventListener("load", onReady);
      script.addEventListener("error", onError);
      if (!existing) {
        script.src = scriptUrl;
        script.async = true;
        script.dataset.sugarHeic2any = "1";
        document.head.appendChild(script);
      } else if (typeof global.heic2any === "function") {
        onReady();
      }
    });
    return heicLoader;
  }

  function convertViaHeic2Any(file, scriptUrl) {
    return loadHeic2Any(scriptUrl).then(function (heic2any) {
      return heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.92,
      }).then(function (result) {
        var blob = Array.isArray(result) ? result[0] : result;
        if (!blob) throw new Error("heic conversion empty");
        return blobToJpegFile(blob, fileName(file));
      });
    });
  }

  /**
   * Accepts gallery/camera File; converts Apple HEIC/HEIF to JPEG when needed.
   * @param {File} file
   * @param {{ heic2anyUrl?: string }} [options]
   * @returns {Promise<File>}
   */
  function normalizeRoomImageFile(file, options) {
    options = options || {};
    if (!isLikelyImageFile(file)) {
      return Promise.reject(new Error("invalid-image"));
    }
    if (!isHeicLike(file)) {
      return Promise.resolve(file);
    }

    return convertViaBitmap(file).catch(function () {
      return convertViaHeic2Any(file, options.heic2anyUrl);
    });
  }

  global.SugarImageUtils = {
    isHeicLike: isHeicLike,
    isLikelyImageFile: isLikelyImageFile,
    normalizeRoomImageFile: normalizeRoomImageFile,
  };
})(typeof window !== "undefined" ? window : this);
