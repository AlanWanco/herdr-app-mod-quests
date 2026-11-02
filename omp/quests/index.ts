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

const PROMPT = `你是一个项目记录员。看完这段对话后，只输出一个 JSON 对象，不要任何解释、不要代码围栏。

{
  "ask": "这一轮用户要求什么，一两句",
  "done": [{ "what": "做完的事", "proof": "能证明它完成的证据：命令输出、测试结果、读回的文件", "machine": true }],
  "open": [{ "what": "没做完的事", "why": "为什么没做完", "needsDecision": false }],
  "verify": [{ "what": "需要人亲自确认的点", "how": "怎么确认" }]
}

规则：
- 每项最多 6 条，只写这一轮真正发生的；没有就给空数组。
- machine 只在命令输出、测试结果或文件内容确实证明过时才为 true；只是"应该没问题"的一律 false。
- verify 只写机器确认不了的：需要人眼看的界面、需要人做的选择、外部服务上的操作。
  任何能用命令输出、测试结果或读文件确认的事，都必须放进 done（machine: true + proof），不许放进 verify。
  反例："重启后新卡片是否为中文" —— 看一眼文件就能确认，属于 done，不属于 verify。
- needsDecision 为 true 表示需要用户拍板才能继续。
- 所有文字用简体中文，短句。`;

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
  const gapMs = Number(process.env.OMP_QUESTS_MIN_MS ?? 120000); // at most one recap per 2 minutes
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
