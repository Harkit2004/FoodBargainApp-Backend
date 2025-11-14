type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

interface JiraConfig {
  url: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
  sprintId?: number | null;
}

export interface JiraDocumentNode {
  type: string;
  content?: JiraDocumentNode[];
  text?: string;
  marks?: Array<{ type: string }>;
  attrs?: Record<string, unknown>;
}

export interface JiraDocument {
  type: "doc";
  version: number;
  content: JiraDocumentNode[];
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: JiraDocument;
    created?: string;
    status?: {
      name?: string;
      statusCategory?: {
        name?: string;
      };
    };
    issuetype?: {
      name?: string;
    };
  };
}

let cachedAccountId: string | null = null;

function getJiraConfig(): JiraConfig {
  const url = process.env.JIRA_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY || "SCRUM";
  const issueType = process.env.JIRA_ISSUE_TYPE || "Task";
  const sprintId = process.env.JIRA_SPRINT_ID ? parseInt(process.env.JIRA_SPRINT_ID, 10) : null;

  if (!url || !email || !apiToken) {
    throw new Error(
      "Jira configuration is missing. Please set JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables."
    );
  }

  return {
    url,
    email,
    apiToken,
    projectKey,
    issueType,
    sprintId,
  };
}

function getAuthHeaders(config: JiraConfig): Record<string, string> {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function jiraFetch(path: string, init?: FetchInit) {
  const config = getJiraConfig();
  const headers = {
    ...getAuthHeaders(config),
    ...init?.headers,
  } as Record<string, string>;

  const response = await fetch(`${config.url}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    throw new Error(
      `Jira request failed: ${response.status} ${response.statusText} - ${errorPayload}`
    );
  }

  return response;
}

async function getAssigneeAccountId(): Promise<string> {
  if (cachedAccountId) {
    return cachedAccountId;
  }

  const response = await jiraFetch("/rest/api/3/myself", {
    method: "GET",
  });
  const data = (await response.json()) as { accountId: string };
  cachedAccountId = data.accountId;
  return cachedAccountId;
}

export function appendMetadata(
  description: JiraDocument,
  metadata?: Record<string, unknown>
): JiraDocument {
  if (!metadata) {
    return description;
  }

  const metadataNode: JiraDocumentNode = {
    type: "heading",
    attrs: { level: 3 },
    content: [{ type: "text", text: "Structured Metadata" }],
  };

  const codeBlock: JiraDocumentNode = {
    type: "codeBlock",
    attrs: { language: "json" },
    content: [
      {
        type: "text",
        text: JSON.stringify(metadata, null, 2),
      },
    ],
  };

  return {
    ...description,
    content: [...description.content, metadataNode, codeBlock],
  };
}

export interface CreateTicketOptions {
  summary: string;
  description: JiraDocument;
  labels?: string[];
  metadata?: Record<string, unknown>;
  issueType?: string;
}

export async function createJiraTicket(options: CreateTicketOptions): Promise<{
  key: string;
  id: string;
  createdAt: string;
}> {
  const config = getJiraConfig();
  const accountId = await getAssigneeAccountId();

  const description = appendMetadata(options.description, options.metadata);

  const response = await jiraFetch("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({
      fields: {
        project: { key: config.projectKey },
        summary: options.summary,
        description,
        issuetype: { name: options.issueType || config.issueType },
        labels: options.labels ?? [],
        assignee: { id: accountId },
      },
    }),
  });

  const issue = (await response.json()) as { key: string; id: string };
  const createdAt = new Date().toISOString();

  if (config.sprintId) {
    try {
      await jiraFetch(`/rest/agile/1.0/sprint/${config.sprintId}/issue`, {
        method: "POST",
        body: JSON.stringify({ issues: [issue.key] }),
      });
    } catch (sprintError) {
      console.error("Failed to assign Jira issue to sprint", sprintError);
    }
  }

  return {
    key: issue.key,
    id: issue.id,
    createdAt,
  };
}

interface SearchIssuesOptions {
  jql: string;
  fields?: string[];
  maxResults?: number;
}

export async function searchJiraIssues(options: SearchIssuesOptions): Promise<JiraIssue[]> {
  const response = await jiraFetch("/rest/api/3/search/jql", {
    method: "POST",
    body: JSON.stringify({
      jql: options.jql,
      maxResults: options.maxResults ?? 50,
      fields: options.fields ?? ["summary", "description", "status", "created"],
    }),
  });

  const data = (await response.json()) as { issues?: JiraIssue[] };
  return data.issues ?? [];
}

export async function fetchJiraIssue(issueKey: string, fields?: string[]): Promise<JiraIssue> {
  const query = fields && fields.length > 0 ? `?fields=${fields.join(",")}` : "";
  const response = await jiraFetch(`/rest/api/3/issue/${issueKey}${query}`, {
    method: "GET",
  });
  return (await response.json()) as JiraIssue;
}

export async function addJiraComment(issueKey: string, comment: string): Promise<void> {
  await jiraFetch(`/rest/api/3/issue/${issueKey}/comment`, {
    method: "POST",
    body: JSON.stringify({
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: comment }],
          },
        ],
      },
    }),
  });
}

export async function transitionIssueToCategory(
  issueKey: string,
  statusCategoryName: string
): Promise<boolean> {
  const response = await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`, {
    method: "GET",
  });

  const payload = (await response.json()) as {
    transitions: Array<{
      id: string;
      name: string;
      to: {
        statusCategory: {
          name: string;
        };
      };
    }>;
  };

  const transition = payload.transitions.find(
    (t) => t.to.statusCategory.name?.toLowerCase() === statusCategoryName.toLowerCase()
  );

  if (!transition) {
    return false;
  }

  await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`, {
    method: "POST",
    body: JSON.stringify({
      transition: {
        id: transition.id,
      },
    }),
  });

  return true;
}

function extractJsonFromNode(node?: JiraDocumentNode): string | null {
  if (!node) {
    return null;
  }

  if (node.type === "codeBlock" && node.attrs?.language === "json") {
    const text = node.content
      ?.map((child) => child.text)
      .filter(Boolean)
      .join("");
    return text ?? null;
  }

  if (node.content && node.content.length > 0) {
    for (const child of node.content) {
      const result = extractJsonFromNode(child);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

export function extractIssueMetadata(issue: JiraIssue): Record<string, unknown> | null {
  const description = issue.fields.description;
  if (!description?.content) {
    return null;
  }

  for (const node of description.content) {
    const jsonText = extractJsonFromNode(node);
    if (jsonText) {
      try {
        return JSON.parse(jsonText);
      } catch (error) {
        console.error("Unable to parse Jira metadata", error);
        return null;
      }
    }
  }

  return null;
}

export function buildParagraph(text: string, bold = false): JiraDocumentNode {
  return {
    type: "paragraph",
    content: [
      {
        type: "text",
        text,
        ...(bold ? { marks: [{ type: "strong" }] } : {}),
      },
    ],
  };
}

export function buildKeyValueParagraph(label: string, value: string): JiraDocumentNode {
  return {
    type: "paragraph",
    content: [
      { type: "text", text: `${label}: `, marks: [{ type: "strong" }] },
      { type: "text", text: value },
    ],
  };
}

export function buildHeading(text: string, level = 3): JiraDocumentNode {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}
