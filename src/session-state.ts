export interface TerminalSession {
  sessionFile: string;
  cwd?: string;
}

type LegacyTerminalSessionMap = Record<string, string>;

export function parseStoredSessions(value: unknown): Record<string, TerminalSession> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  if (record.version === 1 && record.sessions && typeof record.sessions === "object") {
    return Object.fromEntries(
      Object.entries(record.sessions as Record<string, unknown>).flatMap(([id, entry]) => {
        if (!entry || typeof entry !== "object") return [];
        const session = entry as Record<string, unknown>;
        if (typeof session.sessionFile !== "string") return [];
        return [
          [
            id,
            {
              sessionFile: session.sessionFile,
              cwd: typeof session.cwd === "string" ? session.cwd : undefined,
            },
          ],
        ];
      }),
    );
  }

  return Object.fromEntries(
    Object.entries(record as LegacyTerminalSessionMap).flatMap(([id, sessionFile]) =>
      typeof sessionFile === "string" ? [[id, { sessionFile }]] : [],
    ),
  );
}
