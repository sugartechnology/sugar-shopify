import { getSugarApiBaseUrl } from "./tagservice-pdp.server";

export interface DecorAiStreamEvent {
  event: string;
  data: unknown;
}

export async function streamTagserviceShoppingResponses(
  apiKey: string,
  body: Record<string, unknown>,
  onEvent: (event: DecorAiStreamEvent) => void,
): Promise<void> {
  const baseUrl = getSugarApiBaseUrl();
  if (!baseUrl) {
    throw new Error("Sugar API is not configured");
  }
  if (!apiKey.trim()) {
    throw new Error("Shop API key is not configured");
  }

  const response = await fetch(
    `${baseUrl}/api/shopify/shopping/responses/stream`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Shopping stream failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];

  const flush = () => {
    if (!dataLines.length) {
      eventName = "message";
      return;
    }
    const raw = dataLines.join("\n");
    dataLines = [];
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { text: raw };
    }
    onEvent({ event: eventName || "message", data });
    eventName = "message";
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) {
        flush();
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
  }
  if (buffer.trim()) {
    if (buffer.startsWith("data:")) {
      dataLines.push(buffer.slice(5).replace(/^ /, ""));
    }
  }
  flush();
}
