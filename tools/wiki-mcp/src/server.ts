#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { MediaWikiClient } from "./lib/mediawiki";
import {
  LorePathwayInput,
  LorePathwaysListInput,
  WikiCategoryMembersInput,
  WikiGetPageInput,
  WikiSearchInput,
  WikiVolumeTimelineInput,
} from "./schemas";
import { lorePathway, lorePathwaysList } from "./tools/lore";
import {
  wikiCategoryMembers,
  wikiGetPage,
  wikiSearch,
  wikiVolumeTimeline,
} from "./tools/wiki";

const client = new MediaWikiClient();

const TOOLS = [
  {
    name: "lore_pathway",
    description:
      "Return the 10-tier sequence ladder for one LOTM pathway. Accepts canonical pathway name ('Fool'), any sequence title ('Seer' → Fool), True God, or Great Old One. Case-insensitive.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", minLength: 1 } },
      required: ["name"],
    },
  },
  {
    name: "lore_pathways_list",
    description: "List all LOTM pathways. Optional filter by category.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["standard", "outer-deity", "non-standard"] },
      },
    },
  },
  {
    name: "wiki_search",
    description: "Full-text search the LOTM fandom wiki. Returns [{title, snippet}].",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["query"],
    },
  },
  {
    name: "wiki_get_page",
    description:
      "Fetch wikitext of a wiki page. `section` may be integer (1-based MediaWiki index) or heading string (case-insensitive line match). Body truncated to 8000 chars unless full=true.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1 },
        section: { type: ["string", "integer"] },
        full: { type: "boolean", default: false },
      },
      required: ["title"],
    },
  },
  {
    name: "wiki_category_members",
    description: "List pages in a wiki category. Accepts 'Events' or 'Category:Events'.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
      },
      required: ["category"],
    },
  },
  {
    name: "wiki_volume_timeline",
    description:
      "Fetch 'Timeline of Major Events' section of an LOTM volume (1-9). Falls back to full page if section missing.",
    inputSchema: {
      type: "object",
      properties: { volume: { type: "integer", minimum: 1, maximum: 9 } },
      required: ["volume"],
    },
  },
] as const;

const server = new Server(
  { name: "lotm-wiki", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let out: unknown;
    switch (name) {
      case "lore_pathway":
        out = lorePathway(LorePathwayInput.parse(args));
        break;
      case "lore_pathways_list":
        out = lorePathwaysList(LorePathwaysListInput.parse(args));
        break;
      case "wiki_search":
        out = await wikiSearch(client, WikiSearchInput.parse(args));
        break;
      case "wiki_get_page":
        out = await wikiGetPage(client, WikiGetPageInput.parse(args));
        break;
      case "wiki_category_members":
        out = await wikiCategoryMembers(client, WikiCategoryMembersInput.parse(args));
        break;
      case "wiki_volume_timeline":
        out = await wikiVolumeTimeline(client, WikiVolumeTimelineInput.parse(args));
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe; stdout is reserved for MCP protocol frames.
  console.error("lotm-wiki MCP server ready on stdio");
}

main().catch((err) => {
  console.error("lotm-wiki MCP server failed:", err);
  process.exit(1);
});
