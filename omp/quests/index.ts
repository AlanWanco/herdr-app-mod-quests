/**
 * Quests — asks one small, fixed-schema question about a finished turn and writes the answer where
 * the Herdr "Quests" mod can show it as a board of things to confirm.
 *
 * The side turn is the same pipeline as /btw: current model, current conversation, no tools, and
 * nothing appended to the session. It is skipped when nothing new was asked since the last recap.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PROMPT = `You are a project recorder. Read this conversation and answer with one JSON object only — no prose, no code fence.

{
  "ask": "what the user asked for in this turn, one or two sentences",
  "done": [{ "what": "what got finished", "proof": "the command, test, file or read-back that proves it", "machine": true }],
  "open": [{ "what": "what did not get finished", "why": "why", "needsDecision": false }],
  "verify": [{ "what": "what only a person can confirm", "how": "how to confirm it" }]
}

Rules:
- At most 6 items each, only what actually happened in this turn; empty arrays are fine.
- machine: true only when a command output, a test result or file content proved it; anything that merely "should work" is false.
- verify is for what a machine cannot replace: UI a person must look at, choices a person must make, actions on external services.
- needsDecision: true for things that need the user's call before work continues.
- Write in English, short sentences.`;

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function questDir() {
  return join(homedir(), ".config", "herdr-app", "cache", "quests");
}

// The model is told not to fence its JSON; tolerate it anyway.
function parseJson(text) {
  const s = String(text ?? "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(s.slice(start, end + 1));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

export default function quests(pi) {
  if (String(process.env.OMP_QUESTS ?? "1") === "0") return;
  const gapMs = Number(process.env.OMP_QUESTS_MIN_MS ?? 300000); // at most one recap per 5 minutes
  let lastAt = 0;
  let lastCount = -1;

  pi.on("agent_end", async (_event, ctx) => {
    try {
      if (Date.now() - lastAt < gapMs) return;
      if (!ctx?.runEphemeralTurn) return;
      // Nothing new was asked since the last recap: nothing to record.
      let asked = 0;
      try {
        for (const entry of ctx.sessionManager?.getBranch?.() ?? []) {
          if (entry?.type === "message" && entry.message?.role === "user") asked++;
        }
      } catch { /* a branch that cannot be read still deserves a try */ }
      if (asked === lastCount) return;
      lastAt = Date.now();
      lastCount = asked;

      const { replyText } = await ctx.runEphemeralTurn({ promptText: PROMPT, tools: false, maxTokens: 1200 });
      const data = parseJson(replyText);
      if (!data) return;

      const session = String(ctx.sessionManager?.getSessionId?.() ?? "unknown");
      const out = {
        session,
        cwd: ctx.cwd ?? null,
        title: data.ask ?? null,
        at: new Date().toISOString(),
        ask: String(data.ask ?? ""),
        done: Array.isArray(data.done) ? data.done.slice(0, 6) : [],
        open: Array.isArray(data.open) ? data.open.slice(0, 6) : [],
        verify: Array.isArray(data.verify) ? data.verify.slice(0, 6) : [],
        checked: {},
      };
      await mkdir(questDir(), { recursive: true });
      await writeFile(join(questDir(), `${session}-${stamp()}.json`), JSON.stringify(out, null, 2), "utf8");
    } catch {
      // A recap must never disturb the turn that produced it.
    }
  });
}
