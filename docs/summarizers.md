# Which model writes the summaries

Measured on 2026-10-13, all on the same coding session (about 9 KB of
extracted dialog; not included here). Re-run before trusting these numbers for
a new model or CLI version.

A good summary of that session had to catch two things: one decision still
waiting on the user, and one step that was blocked.

| Option | Cost per summary | Time | Valid JSON | Caught both |
|---|---|---|---|---|
| Claude Code, `--model haiku` | $0.0032 (CLI's own figure) | 19 s | yes | yes |
| Claude Code, `--model sonnet` | $0.033 | 9 s | yes | yes |
| opencode, `opencode/claude-haiku-5-5` | $0.0023 (CLI's own figure) | 11 s | yes | yes |
| opencode, `opencode/deepseek-v4.1-flash` | $0.0047 (CLI's own figure) | 24 s | yes | yes, plus two minor extras |
| Qwen3.5 4B, 4-bit, local via `mlx_lm.server`, thinking off | free | 19 s | yes | no |
| Qwen3.5 4B, thinking on | — | over 5 min, stopped | — | — |
| Apple on-device model, guided generation | free | 17 s | yes | no; listed finished work as still to do |

Prices in `core/catalog.mjs` come from `opencode models --verbose`
(USD per million tokens): Haiku 5.5 $0.1 in / $0.5 out, DeepSeek V4.1 Flash
$0.3 / $1.2, Sonnet 5.5 $2 / $10.

## CLIs we checked and did not add

- **cursor-agent**: does not read stdin; `--mode ask` still lists Shell and
  Write tools, so nothing but the prompt stops it from using them; every run is
  saved as a chat; `--model` also changes the user's default model.
- **kimi**: does not read stdin, and with a document on stdin it returned a
  schema-valid but empty summary; runs Bash and Write without asking unless an
  agent file removes the tools; every run is saved as a session.

## How opencode is kept read-only

An agent defined only for the run through `OPENCODE_CONFIG_CONTENT`, with every
tool off and every permission denied; `OPENCODE_DB` pointed at a temporary file
that is deleted afterwards; `--title` so no extra model call names the session;
`--pure` so the user's plugins don't load. With this agent, a request to create
a file left the directory empty; the default agent did create it.

## Local models

Anything that serves the OpenAI chat API works with `SUMMARIZER=openai`. For a
reasoning model, turn reasoning off and raise the output limit, or it spends the
whole budget thinking and returns nothing. For Qwen on `mlx_lm.server`:

```sh
SUMMARIZER=openai
OPENAI_BASE_URL=http://127.0.0.1:8080/v1
OPENAI_MODEL=<the model path the server prints>
OPENAI_EXTRA_BODY={"chat_template_kwargs":{"enable_thinking":false}}
SUMMARY_MAX_TOKENS=3000
```

Small local models got the finished work right but missed what needed the user,
which is the part this page exists for.

## After the instructions moved to English (2026-10-13)

The instructions are now English with a line saying which language to write
in (`SUMMARY_LANG`). Same session, Haiku through Claude Code:

| Language | Time | Caught both | Goal within the length limit |
|---|---|---|---|
| Chinese | 17 s | yes | yes |
| English | 14 s | yes | yes |
