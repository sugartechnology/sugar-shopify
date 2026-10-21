/**
 * Sugar S3 for Koshoy Studio files: room photos, render inputs and results.
 * Objects are private (no ACL); the storefront gets them through our own
 * routes, decor-ai through short-lived signed GET links. Nothing is deleted.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface KoshoyFile {
  bytes: Uint8Array;
  contentType: string;
}

export interface KoshoyFileStore {
  /** Stores `name` under the configured prefix; returns the full key to keep. */
  put(name: string, file: KoshoyFile): Promise<string>;
  /** null when the object does not exist. */
  get(key: string): Promise<KoshoyFile | null>;
  /** Signed GET link, valid for `seconds`. */
  signedUrl(key: string, seconds: number): Promise<string>;
}

interface S3Settings {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

function readSettings(): S3Settings | null {
  const env = (name: string) => (process.env[name] ?? "").trim();
  const settings = {
    bucket: env("KOSHOY_S3_BUCKET"),
    region: env("KOSHOY_S3_REGION"),
    endpoint: env("KOSHOY_S3_ENDPOINT"),
    accessKeyId: env("KOSHOY_S3_ACCESS_KEY_ID"),
    secretAccessKey: env("KOSHOY_S3_SECRET_ACCESS_KEY"),
    prefix: env("KOSHOY_S3_PREFIX") || "koshoy-studio/",
  };
  const ready =
    settings.bucket && settings.region && settings.accessKeyId && settings.secretAccessKey;
  return ready ? settings : null;
}

function isMissing(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "NoSuchKey" || name === "NotFound";
}

/** null when the KOSHOY_S3_* settings are not filled in. */
export function createKoshoyS3(): KoshoyFileStore | null {
  const settings = readSettings();
  if (!settings) return null;
  const { bucket } = settings;
  const client = new S3Client({
    region: settings.region,
    endpoint: settings.endpoint || undefined,
    // A custom endpoint or a dotted bucket name ("cdn.x") needs path-style URLs.
    forcePathStyle: Boolean(settings.endpoint) || bucket.includes("."),
    // S3-compatible stores reject the SDK's optional extra checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });

  return {
    async put(name, file) {
      const key = settings.prefix + name;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: file.bytes,
          ContentType: file.contentType,
        }),
      );
      return key;
    },

    async get(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!result.Body) return null;
        return {
          bytes: await result.Body.transformToByteArray(),
          contentType: result.ContentType ?? "",
        };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    signedUrl(key, seconds) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: seconds,
      });
    },
  };
}
