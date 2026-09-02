import { StringDecoder } from "node:string_decoder";

export type RpcEvent = Record<string, unknown>;

export interface RpcUiAdapter {
  select(title: string, options: string[]): PromiseLike<string | undefined>;
  confirm(title: string, message: string): PromiseLike<boolean | undefined>;
  input(title: string, placeholder?: string): PromiseLike<string | undefined>;
}

export class JsonlReader {
  readonly #decoder = new StringDecoder("utf8");
  #buffer = "";

  constructor(
    private readonly onEvent: (event: RpcEvent) => void,
    private readonly onMalformedLine: (line: string, error: unknown) => void = () => {},
  ) {}

  push(chunk: Buffer | string): void {
    this.#buffer += typeof chunk === "string" ? chunk : this.#decoder.write(chunk);
    this.#flushCompleteLines();
  }

  end(): void {
    this.#buffer += this.#decoder.end();
    if (this.#buffer.endsWith("\r")) this.#buffer = this.#buffer.slice(0, -1);
    if (this.#buffer) this.#parseLine(this.#buffer);
    this.#buffer = "";
  }

  #flushCompleteLines(): void {
    while (true) {
      const newlineIndex = this.#buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      let line = this.#buffer.slice(0, newlineIndex);
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line) this.#parseLine(line);
    }
  }

  #parseLine(line: string): void {
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === "object") this.onEvent(value as RpcEvent);
      else this.onMalformedLine(line, new Error("RPC event must be a JSON object."));
    } catch (error) {
      this.onMalformedLine(line, error);
    }
  }
}

export async function handleExtensionUiRequest(
  event: RpcEvent,
  ui: RpcUiAdapter,
): Promise<RpcEvent | undefined> {
  if (event.type !== "extension_ui_request") return undefined;
  const id = typeof event.id === "string" ? event.id : undefined;
  const method = typeof event.method === "string" ? event.method : undefined;
  if (!id || !method) return undefined;

  const cancelled = { type: "extension_ui_response", id, cancelled: true };
  switch (method) {
    case "select": {
      const options = Array.isArray(event.options)
        ? event.options.filter((value): value is string => typeof value === "string")
        : [];
      if (options.length === 0) return cancelled;
      const value = await ui.select(readString(event.title), options);
      return value === undefined ? cancelled : { type: "extension_ui_response", id, value };
    }
    case "confirm": {
      const confirmed = await ui.confirm(readString(event.title), readString(event.message));
      return confirmed === undefined ? cancelled : { type: "extension_ui_response", id, confirmed };
    }
    case "input": {
      const value = await ui.input(readString(event.title), readOptionalString(event.placeholder));
      return value === undefined ? cancelled : { type: "extension_ui_response", id, value };
    }
    case "editor":
      return cancelled;
    default:
      return undefined;
  }
}

export function getTextDelta(event: RpcEvent): string | undefined {
  if (event.type !== "message_update") return undefined;
  const update = event.assistantMessageEvent;
  if (!update || typeof update !== "object") return undefined;
  const record = update as RpcEvent;
  return record.type === "text_delta" && typeof record.delta === "string"
    ? record.delta
    : undefined;
}

export class RpcLifecycle {
  #legacyAgentEndTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly endInput: () => void,
    private readonly legacyGraceMs = 1000,
  ) {}

  handle(event: RpcEvent): void {
    if (event.type === "agent_start") {
      this.#clearLegacyTimer();
      return;
    }
    if (event.type === "agent_settled") {
      this.#clearLegacyTimer();
      this.endInput();
      return;
    }
    if (event.type !== "agent_end" || event.willRetry === true) return;
    this.#clearLegacyTimer();
    this.#legacyAgentEndTimer = setTimeout(() => {
      this.#legacyAgentEndTimer = undefined;
      this.endInput();
    }, this.legacyGraceMs);
  }

  dispose(): void {
    this.#clearLegacyTimer();
  }

  #clearLegacyTimer(): void {
    if (this.#legacyAgentEndTimer) clearTimeout(this.#legacyAgentEndTimer);
    this.#legacyAgentEndTimer = undefined;
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "Pi extension request";
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
