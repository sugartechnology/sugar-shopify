import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useMatches,
} from "@remix-run/react";

/** App Bridge is loaded only on embedded admin pages (their loader returns appBridgeApiKey). */
function useAppBridgeApiKey(): string {
  for (const match of useMatches()) {
    const data = match.data as { appBridgeApiKey?: string } | undefined;
    if (data?.appBridgeApiKey) return data.appBridgeApiKey;
  }
  return "";
}

export default function App() {
  const apiKey = useAppBridgeApiKey();
  return (
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {apiKey ? <meta name="shopify-api-key" content={apiKey} /> : null}
        {apiKey ? <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" /> : null}
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
