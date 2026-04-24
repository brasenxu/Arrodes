# lotm-wiki MCP

Dev-time stdio MCP server giving Claude Code and Cursor structured + live access to the Lord of the Mysteries fandom wiki. See `.claude/plans/2026-04-23_Wiki-MCP-Design.md` for the design rationale.

## Tools

| Tool | Purpose |
|---|---|
| `lore_pathway(name)` | 10-tier sequence ladder for one pathway. Resolves canonical name, any sequence title in the ladder (`Seer` → Fool), True God, or Great Old One. Backed by `data/lore/pathways.json`. |
| `lore_pathways_list(category?)` | All pathways, optional filter by `standard` / `outer-deity` / `non-standard`. |
| `wiki_search(query, limit?)` | Full-text search. Returns `[{title, snippet}]`. |
| `wiki_get_page(title, section?, full?)` | Fetch wikitext. `section` accepts integer or heading string. Body truncated to 8000 chars unless `full=true`. |
| `wiki_category_members(category, limit?)` | List pages in a category. |
| `wiki_volume_timeline(volume)` | Fetch the Timeline of Major Events section of a book volume (1-9). |

## Setup — Claude Code

`.mcp.json` in repo root already configured. No action required — restart Claude Code after pulling this change.

## Setup — Cursor

1. Copy `.mcp.json` contents to `.cursor/mcp.json` (create that file at repo root).
2. **Fully quit Cursor** — on macOS, check the Dock: closing the window alone is not enough.
3. Reopen Cursor, navigate to Settings → Features → MCP, toggle `lotm-wiki` and `arrodes-ro` on.
4. On first tool use, Cursor may prompt for approval. Optionally enable auto-run to skip future prompts.

**Known Cursor gotchas:**
- Disabled tools reportedly re-enable on restart (open bug as of early 2026).
- Tool count ceiling is 40 across all servers. We use ~9.
- `npx` is bundled with Node, so no pnpm-on-PATH concerns.

## Refreshing pathways.json

When the LOTM wiki updates pathway tables:

```bash
pnpm refresh:lore
```

Reads the `Template:Chart of All Standard Sequences` and `Template:Chart of All Non Standard Sequences` templates, reparses, rewrites `data/lore/pathways.json`. Commit the diff.

## Smoke test (no client needed)

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoketest","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | pnpm mcp:wiki 2>/dev/null | head -n 20
```

Expected: two JSON lines — `initialize` result, then `tools/list` with all 6 tool names.
