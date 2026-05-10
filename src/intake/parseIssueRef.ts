export type ParsedGitHubIssueRef = {
  owner: string;
  name: string;
  number: number;
};

const GH_ISSUE_URL =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/i;

/**
 * Parse GitHub issue references:
 * - owner/repo#123
 * - https://github.com/owner/repo/issues/123
 * - 123 (requires repoHint owner/repo)
 */
export function parseGitHubIssueRef(
  input: string,
  repoHint?: string,
): ParsedGitHubIssueRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hash = /^([^/]+)\/([^#]+)#(\d+)$/.exec(trimmed);
  if (hash) {
    return {
      owner: hash[1],
      name: hash[2],
      number: Number(hash[3]),
    };
  }

  const url = GH_ISSUE_URL.exec(trimmed);
  if (url) {
    return {
      owner: url[1],
      name: url[2],
      number: Number(url[3]),
    };
  }

  const plain = /^(\d+)$/.exec(trimmed);
  if (plain && repoHint) {
    const rp = /^([^/]+)\/([^/]+)$/.exec(repoHint.trim());
    if (!rp) return null;
    return { owner: rp[1], name: rp[2], number: Number(plain[1]) };
  }

  return null;
}
