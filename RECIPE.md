# Quests — a brief

Build two halves: an omp extension that writes one small JSON per finished turn, and a Herdr app mod
that shows those files as a board a person can tick off.

## The extension (`omp/quests/index.ts`)

- Loaded from `extensions:` in `~/.omp/agent/config.yml` (a folder with `index.ts`).
- `export default function quests(pi)`, then `pi.on("agent_end", async (_event, ctx) => …)`.
- One question via `ctx.runEphemeralTurn({ promptText: PROMPT, tools: false, maxTokens: 1200 })` —
  current model and conversation, nothing appended to history.
- Ask for a JSON object only: `ask`, `done[{what,proof,machine}]`, `open[{what,why,needsDecision}]`,
  `verify[{what,how}]`, at most six each. Parse from the first `{` to the last `}`, drop what does not
  parse.
- Write `~/.config/herdr-app/cache/quests/<sessionId>-<yyyyMMdd-HHmmss>.json` with `session`, `cwd`,
  `at`, `checked: {}`.
- Throttle: at most one recap per `OMP_QUESTS_MIN_MS` (default 5 min) and only when the count of user
  messages in `ctx.sessionManager.getBranch()` changed. `OMP_QUESTS=0` disables it. Every failure is
  swallowed: a recap must never disturb the turn.

## The mod (`mods/quests/`)

- Reads `cache/quests/*.json` on a 4 s timer, newest first.
- Groups cards by folder, naming a group after the agent whose pane has that cwd (`space · tab` when
  the tab has its own name).
- Each card: time, folder, session prefix, `ask`, then `check by hand` (a checkbox per `verify`, with
  `how` underneath), `done` (`✓` for `machine`, `·` otherwise, `proof` dim), `not finished` (`✓`? no —
  `?` when `needsDecision`, plus "needs your call").
- A tick writes `checked["verify:<n>"] = now` into the same file; a second tick removes it.
- Header: `N to check`, an `all folders / this folder` filter (focused agent's cwd), refresh, and
  `Open` (dialog copy) when it sits in a panel.

## Built from

`gpui-kit` (`div`, `svg`), `gpui-base` (`v_flex`, `h_flex`), `herdr` (`agents`, `panes`, `focused`,
`appHome`, `openOverlay`, `props`, `theme`), `fs/promises`. Extension: `node:fs/promises`, `node:os`,
`node:path`.

## Watch out

- `div()` lays children out in a row: a column needs `v_flex()`, or `flex_1` means width and the body
  collapses to its content height.
- Render rows with `h_flex()/v_flex()` and explicit heights; a scroll container without a height fills
  its parent.
- Do not print the recap inside the turn: `agent_end` + a side turn is the only place that does not
  add a message.
- A JSON file can be half-written when the board reads it: skip what does not parse, the next pass
  picks it up.

## Done when

A turn in an interactive omp session with the extension produces one file under `cache/quests/`; the
board shows it under its agent's group; ticking a row changes the file and survives a reload.
