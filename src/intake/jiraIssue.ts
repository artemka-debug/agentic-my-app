import path from "node:path";
import type { LoadedConfig } from "../config/loadConfig.js";
import { resolveCursorApiKey } from "../config/loadConfig.js";
import { runAgentTurn } from "../sdk/runAgentTurn.js";
import { extractJsonObject } from "../util/jsonExtract.js";
import type {
  TaskAttachment,
  TaskComment,
  TaskInput,
  TaskInputMetadata,
} from "./taskTypes.js";
import type { ParsedJiraIssueRef } from "./parseJiraIssueRef.js";

export type JiraIssueFetchResult =
  | {
      ok: true;
      via: "jira_api" | "atlassian_mcp";
      rawJson: Record<string, unknown>;
    }
  | {
      ok: false;
      via: "stub";
      reason: string;
    };

function envOrConfig(envName: string, configured: string): string {
  return process.env[envName]?.trim() || configured.trim();
}

function jiraApiSettings(loaded: LoadedConfig): {
  siteUrl: string;
  email: string;
  apiToken: string;
} | null {
  const siteUrl = envOrConfig(
    loaded.config.jira.siteUrlEnv,
    loaded.config.jira.siteUrl,
  ).replace(/\/+$/, "");
  const email = envOrConfig(loaded.config.jira.emailEnv, loaded.config.jira.email);
  const apiToken = process.env[loaded.config.jira.apiTokenEnv]?.trim() ?? "";
  if (!siteUrl || !email || !apiToken) return null;
  return { siteUrl, email, apiToken };
}

function basicAuth(email: string, apiToken: string): string {
  return Buffer.from(`${email}:${apiToken}`, "utf8").toString("base64");
}

function stringValue(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function recordValue(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function arrayValue(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function jiraUserName(v: unknown): string | undefined {
  const rec = recordValue(v);
  return stringValue(rec.displayName) ?? stringValue(rec.emailAddress);
}

function namedList(v: unknown): string[] {
  return arrayValue(v)
    .map((item) => stringValue(recordValue(item).name))
    .filter((name): name is string => Boolean(name));
}

function adfToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(adfToText).filter(Boolean).join("\n");
  }
  const rec = recordValue(value);
  const text = stringValue(rec.text);
  const children = arrayValue(rec.content)
    .map(adfToText)
    .filter(Boolean)
    .join("\n");
  return [text, children].filter(Boolean).join("\n");
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = adfToText(value).trim();
    if (text) return text;
  }
  return "";
}

function commentsFromJira(raw: Record<string, unknown>): TaskComment[] {
  const fields = recordValue(raw.fields);
  const comment = recordValue(fields.comment);
  return arrayValue(comment.comments).map((row) => {
    const rec = recordValue(row);
    return {
      author: jiraUserName(rec.author),
      body: firstNonEmpty(rec.body),
      createdAt: stringValue(rec.created),
    };
  });
}

function attachmentsFromJira(raw: Record<string, unknown>): TaskAttachment[] {
  const fields = recordValue(raw.fields);
  return arrayValue(fields.attachment)
    .map((row) => {
      const rec = recordValue(row);
      const name = stringValue(rec.filename);
      const url = stringValue(rec.content) ?? stringValue(rec.self);
      if (!name || !url) return null;
      return { name, url };
    })
    .filter((item): item is TaskAttachment => item !== null);
}

function maybeAcceptanceCriteria(raw: Record<string, unknown>): string {
  const fields = recordValue(raw.fields);
  const names = recordValue(raw.names);
  const out: string[] = [];
  for (const [fieldId, fieldNameRaw] of Object.entries(names)) {
    const fieldName = stringValue(fieldNameRaw);
    if (!fieldName) continue;
    if (!/(acceptance|criteria|ac\b|definition of done|dod)/i.test(fieldName)) {
      continue;
    }
    const text = adfToText(fields[fieldId]).trim();
    if (text) out.push(`### ${fieldName}\n${text}`);
  }
  return out.join("\n\n");
}

function descriptionFromJira(raw: Record<string, unknown>): string {
  const fields = recordValue(raw.fields);
  const priority = stringValue(recordValue(fields.priority).name) ?? "unknown";
  const status = stringValue(recordValue(fields.status).name) ?? "unknown";
  const issueType = stringValue(recordValue(fields.issuetype).name) ?? "unknown";
  const assignee = jiraUserName(fields.assignee) ?? "unassigned";
  const reporter = jiraUserName(fields.reporter) ?? "unknown";
  const labels = arrayValue(fields.labels).map(String).join(", ") || "none";
  const components = namedList(fields.components).join(", ") || "none";
  const fixVersions = namedList(fields.fixVersions).join(", ") || "none";
  const description = firstNonEmpty(fields.description, raw.description);
  const acceptanceCriteria = firstNonEmpty(
    raw.acceptanceCriteria,
    maybeAcceptanceCriteria(raw),
  );

  return [
    `Priority: ${priority}`,
    `Status: ${status}`,
    `Issue type: ${issueType}`,
    `Assignee: ${assignee}`,
    `Reporter: ${reporter}`,
    `Labels: ${labels}`,
    `Components: ${components}`,
    `Fix versions: ${fixVersions}`,
    "",
    "## Description",
    description || "(No Jira description found.)",
    "",
    "## Acceptance Criteria",
    acceptanceCriteria || "(No explicit Jira acceptance criteria field found.)",
  ].join("\n");
}

export async function tryFetchJiraIssue(args: {
  parsed: ParsedJiraIssueRef;
  loaded: LoadedConfig;
  transcriptPath?: string;
}): Promise<JiraIssueFetchResult> {
  const api = jiraApiSettings(args.loaded);
  if (api) {
    const url = `${api.siteUrl}/rest/api/3/issue/${encodeURIComponent(
      args.parsed.key,
    )}?fields=*all&expand=names,schema,renderedFields`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${basicAuth(api.email, api.apiToken)}`,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        via: "stub",
        reason: `Jira API request failed (${response.status} ${response.statusText}): ${body.slice(0, 1000)}`,
      };
    }
    const raw = await response.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, via: "stub", reason: "Invalid Jira API JSON payload" };
    }
    return { ok: true, via: "jira_api", rawJson: raw as Record<string, unknown> };
  }

  const apiKey = resolveCursorApiKey(args.loaded);
  if (!apiKey) {
    return {
      ok: false,
      via: "stub",
      reason: `No Jira API token found in ${args.loaded.config.jira.apiTokenEnv}, and Cursor API key is missing for Atlassian MCP fallback.`,
    };
  }

  const settingSources = Array.from(
    new Set(["plugins", ...args.loaded.config.runtime.cursor.settingSources]),
  ) as LoadedConfig["config"]["runtime"]["cursor"]["settingSources"];
  const prompt = [
    "Use the available Atlassian/Jira MCP tools to fetch this Jira ticket.",
    `Ticket key: ${args.parsed.key}`,
    "",
    "Return only JSON, no markdown fences, with this shape:",
    JSON.stringify(
      {
        key: args.parsed.key,
        url: "string | optional",
        summary: "string",
        description: "string",
        priority: "string | optional",
        status: "string | optional",
        issueType: "string | optional",
        assignee: "string | optional",
        reporter: "string | optional",
        labels: ["string"],
        components: ["string"],
        fixVersions: ["string"],
        acceptanceCriteria: "string | optional",
        comments: [{ author: "string | optional", body: "string", createdAt: "string | optional" }],
        attachments: [{ name: "string", url: "string" }],
      },
      null,
      2,
    ),
    "",
    "Include all important ticket information, especially description, priority, acceptance criteria, comments, and links. Do not include credentials or secrets.",
  ].join("\n");

  const turn = await runAgentTurn({
    apiKey,
    modelId: args.loaded.config.runtime.cursor.models.po,
    cwd: args.loaded.cwd,
    prompt,
    settingSources,
    transcriptPath: args.transcriptPath,
  });
  const body =
    typeof turn.result.result === "string" ? turn.result.result : turn.transcript;
  const parsed = extractJsonObject(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, via: "stub", reason: "Atlassian MCP returned invalid JSON" };
  }
  return {
    ok: true,
    via: "atlassian_mcp",
    rawJson: parsed as Record<string, unknown>,
  };
}

export function buildTaskInputFromJiraJson(args: {
  parsed: ParsedJiraIssueRef;
  jiraJson: Record<string, unknown>;
  loaded: LoadedConfig;
  runId: string;
  via: "jira_api" | "atlassian_mcp";
}): TaskInput {
  const fields = recordValue(args.jiraJson.fields);
  const title =
    stringValue(fields.summary) ??
    stringValue(args.jiraJson.summary) ??
    args.parsed.key;
  const sourceUrl = stringValue(args.jiraJson.url) ?? stringValue(args.jiraJson.self);
  const comments =
    args.via === "jira_api"
      ? commentsFromJira(args.jiraJson)
      : arrayValue(args.jiraJson.comments).map((row) => {
          const rec = recordValue(row);
          return {
            author: stringValue(rec.author),
            body: stringValue(rec.body) ?? "",
            createdAt: stringValue(rec.createdAt),
          };
        });
  const attachments =
    args.via === "jira_api"
      ? attachmentsFromJira(args.jiraJson)
      : arrayValue(args.jiraJson.attachments)
          .map((row) => {
            const rec = recordValue(row);
            const name = stringValue(rec.name);
            const url = stringValue(rec.url);
            if (!name || !url) return null;
            return { name, url };
          })
          .filter((item): item is TaskAttachment => item !== null);

  const metadata: TaskInputMetadata = {
    intake: "jira",
    jiraKey: args.parsed.key,
    jiraProject: args.parsed.project,
    jiraNumber: args.parsed.number,
    jiraVia: args.via,
    priority:
      stringValue(recordValue(fields.priority).name) ??
      stringValue(args.jiraJson.priority),
    status:
      stringValue(recordValue(fields.status).name) ??
      stringValue(args.jiraJson.status),
    issueType:
      stringValue(recordValue(fields.issuetype).name) ??
      stringValue(args.jiraJson.issueType),
    assignee: jiraUserName(fields.assignee) ?? stringValue(args.jiraJson.assignee),
    reporter: jiraUserName(fields.reporter) ?? stringValue(args.jiraJson.reporter),
    labels: fields.labels ?? args.jiraJson.labels,
    components: fields.components ?? args.jiraJson.components,
    fixVersions: fields.fixVersions ?? args.jiraJson.fixVersions,
    jiraIssueJson: args.jiraJson,
  };

  const repo =
    args.loaded.config.github.defaultRepo.trim() ||
    path.basename(args.loaded.cwd);
  const slash = repo.split("/");
  const owner = slash[0] ?? "local";
  const name = slash[1] ?? slash[0] ?? "repo";

  return {
    id: args.runId,
    source: "jira",
    title: `${args.parsed.key}: ${title}`,
    description: descriptionFromJira(args.jiraJson),
    ...(sourceUrl ? { sourceUrl } : {}),
    repo: {
      owner,
      name,
      defaultBranch: args.loaded.config.repo.defaultBaseBranch,
      localPath: args.loaded.cwd,
    },
    metadata,
    comments,
    attachments,
  };
}

export function buildJiraStubTaskInput(args: {
  parsed: ParsedJiraIssueRef;
  loaded: LoadedConfig;
  runId: string;
  reason: string;
}): TaskInput {
  const repo =
    args.loaded.config.github.defaultRepo.trim() ||
    path.basename(args.loaded.cwd);
  const slash = repo.split("/");
  const owner = slash[0] ?? "local";
  const name = slash[1] ?? slash[0] ?? "repo";
  return {
    id: args.runId,
    source: "jira",
    title: `Jira ticket ${args.parsed.key}`,
    description:
      `Jira intake stub: Jira fetch failed or is unavailable.\n\nReason:\n${args.reason}\n`,
    repo: {
      owner,
      name,
      defaultBranch: args.loaded.config.repo.defaultBaseBranch,
      localPath: args.loaded.cwd,
    },
    metadata: {
      intake: "jira_stub",
      jiraKey: args.parsed.key,
      jiraProject: args.parsed.project,
      jiraNumber: args.parsed.number,
      stubReason: args.reason,
    },
    comments: [],
    attachments: [],
  };
}
