/**
 * Shopify OAuth callback rotası (/auth/*).
 * Mağaza "Install" veya app açınca Shopify token üretir;
 * kütüphane token'ı SQLite Session tablosuna kaydeder.
 * Bu dosyada token üretme kodu YOK — authenticate.admin kütüphaneyi çalıştırır.
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};
