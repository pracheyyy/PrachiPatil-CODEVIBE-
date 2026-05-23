const fs = require("fs");
const path = require("path");

const SCORE = {
  commit: 2,
  mergedPullRequest: 10,
  closedIssue: 5,
};

const IGNORED_LOGINS = new Set([
  "github-actions[bot]",
  "dependabot[bot]",
  "dependabot-preview[bot]",
]);

function isIgnoredLogin(login) {
  return !login || IGNORED_LOGINS.has(login) || login.endsWith("[bot]");
}

function getContributor(contributors, login, htmlUrl) {
  if (!contributors.has(login)) {
    contributors.set(login, {
      login,
      htmlUrl: htmlUrl || `https://github.com/${login}`,
      commits: 0,
      mergedPullRequests: 0,
      closedIssues: 0,
      score: 0,
    });
  }

  return contributors.get(login);
}

async function searchAllIssues(github, q) {
  const items = [];
  let page = 1;

  while (page <= 10) {
    const response = await github.rest.search.issuesAndPullRequests({
      q,
      per_page: 100,
      page,
    });

    items.push(...response.data.items);

    if (response.data.items.length < 100 || items.length >= 1000) {
      break;
    }

    page += 1;
  }

  return items;
}

function rankContributors(contributors) {
  return [...contributors.values()]
    .map((contributor) => ({
      ...contributor,
      score:
        contributor.commits * SCORE.commit +
        contributor.mergedPullRequests * SCORE.mergedPullRequest +
        contributor.closedIssues * SCORE.closedIssue,
    }))
    .filter((contributor) => contributor.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.login.localeCompare(b.login);
    });
}

function renderLeaderboard(contributors, repoFullName) {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const rows = contributors.map((contributor, index) => {
    const rank = index + 1;
    const profile = `[@${contributor.login}](${contributor.htmlUrl})`;

    return `| ${rank} | ${profile} | ${contributor.score} | ${contributor.commits} | ${contributor.mergedPullRequests} | ${contributor.closedIssues} |`;
  });

  return [
    "# Contributor Leaderboard",
    "",
    `This leaderboard is generated automatically for \`${repoFullName}\` by GitHub Actions.`,
    "",
    `Last updated: ${generatedAt}`,
    "",
    "## Scoring",
    "",
    `- Commit: ${SCORE.commit} points`,
    `- Merged pull request: ${SCORE.mergedPullRequest} points`,
    `- Closed issue: ${SCORE.closedIssue} points`,
    "",
    "## Rankings",
    "",
    "| Rank | Contributor | Score | Commits | Merged PRs | Closed Issues |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...(rows.length ? rows : ["| - | No contributors yet | 0 | 0 | 0 | 0 |"]),
    "",
  ].join("\n");
}

async function syncLeaderboardWithBackend({ contributors, core }) {
  const apiUrl = process.env.LEADERBOARD_API_URL;

  if (!apiUrl) {
    core.info("LEADERBOARD_API_URL is not set. Skipping backend sync.");
    return;
  }

  const headers = {
    "Content-Type": "application/json",
  };

  if (process.env.LEADERBOARD_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.LEADERBOARD_API_TOKEN}`;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ contributors }),
  });

  if (!response.ok) {
    const body = await response.text();
    core.warning(`Backend leaderboard sync failed: ${response.status} ${body}`);
    return;
  }

  core.info(`Synced ${contributors.length} contributors with backend.`);
}

async function updateContributorLeaderboard({ github, context, core, outputPath }) {
  const { owner, repo } = context.repo;
  const contributors = new Map();

  const commitContributors = await github.paginate(github.rest.repos.listContributors, {
    owner,
    repo,
    anon: "false",
    per_page: 100,
  });

  for (const contributor of commitContributors) {
    if (isIgnoredLogin(contributor.login)) {
      continue;
    }

    const entry = getContributor(contributors, contributor.login, contributor.html_url);
    entry.commits += contributor.contributions || 0;
  }

  const mergedPullRequests = await searchAllIssues(
    github,
    `repo:${owner}/${repo} is:pr is:merged`
  );

  for (const pullRequest of mergedPullRequests) {
    const login = pullRequest.user && pullRequest.user.login;

    if (isIgnoredLogin(login)) {
      continue;
    }

    const entry = getContributor(contributors, login, pullRequest.user.html_url);
    entry.mergedPullRequests += 1;
  }

  const closedIssues = await searchAllIssues(
    github,
    `repo:${owner}/${repo} is:issue is:closed`
  );

  for (const issue of closedIssues) {
    const login = issue.user && issue.user.login;

    if (isIgnoredLogin(login)) {
      continue;
    }

    const entry = getContributor(contributors, login, issue.user.html_url);
    entry.closedIssues += 1;
  }

  const rankedContributors = rankContributors(contributors);
  const leaderboard = renderLeaderboard(rankedContributors, `${owner}/${repo}`);
  const absoluteOutputPath = path.join(process.env.GITHUB_WORKSPACE, outputPath);

  fs.writeFileSync(absoluteOutputPath, leaderboard);
  core.info(`Wrote contributor leaderboard to ${outputPath}`);

  await syncLeaderboardWithBackend({
    contributors: rankedContributors,
    core,
  });
}

module.exports = {
  updateContributorLeaderboard,
};
