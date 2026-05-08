#!/usr/bin/env bash
# Phase 1: GitHub issue intake via gh → TaskBrief, state, events.

phase1_issue() {
  local repo="${1:?repo}"
  local issue_num="${2:?issue number}"
  local autonomy="${3:-balanced}"
  local no_gates="${4:-false}"

  require_cmd gh
  require_cmd jq
  require_cmd python3

  local repo_slug="${repo#https://github.com/}"
  repo_slug="${repo_slug%.git}"

  local run_id
  run_id="run-$(date -u +%Y-%m-%d)-issue-${issue_num}"
  ensure_run_dir_writable "."
  local run_dir="./${orc_runs_dir}/${run_id}"
  mkdir_p_run "$run_dir"

  append_event "$run_dir" "intake" "run_created" "{}"

  local gh_json
  if ! gh_json="$(gh issue view "${issue_num}" --repo "${repo_slug}" \
    --json title,body,comments,labels,assignees,milestone,number,url,state 2>&1)"; then
    local err_json
    err_json="$(printf '%s' "$gh_json" | jq -Rs -c '{stderr: .}')"
    append_event "$run_dir" "intake" "gh_fetch_failed" "$err_json"
    die "gh issue view failed: ${gh_json}"
  fi

  local title body url number_json
  title="$(jq -r '.title' <<<"$gh_json")"
  body="$(jq -r '.body // ""' <<<"$gh_json")"
  url="$(jq -r '.url' <<<"$gh_json")"
  number_json="$(jq -r '.number' <<<"$gh_json")"

  local brief_id="github:${repo_slug}#${number_json}"

  local metadata_json
  metadata_json="$(
    jq -c \
      --arg autonomy "$autonomy" \
      --arg no_gates "$no_gates" \
      '
      {
        labels: (.labels | map(.name)),
        assignees: (.assignees | map(.login)),
        milestone: (if .milestone == null then null else .milestone.title end),
        state: .state,
        autonomy: $autonomy,
        noApprovalGates: ($no_gates == "true")
      }
      ' <<<"$gh_json"
  )"

  jq -n \
    --arg id "$brief_id" \
    --arg repoSlug "$repo_slug" \
    --argjson issueNumber "$number_json" \
    --arg url "$url" \
    --arg title "$title" \
    --arg body "$body" \
    --argjson metadata "$metadata_json" \
    --argjson rawArtifacts '[{"kind":"gh_issue_json","notes":"see issue.snapshot.json"}]' \
    '
    {
      id: $id,
      source: {
        kind: "github_issue",
        repo: $repoSlug,
        issueNumber: ($issueNumber | tonumber),
        url: $url
      },
      title: $title,
      body: $body,
      metadata: $metadata,
      rawArtifacts: $rawArtifacts
    }
    ' >"${run_dir}/task-brief.json"

  jq -n \
    --arg runId "$run_id" \
    --arg repo "$repo_slug" \
    --argjson issue "$number_json" \
    --arg autonomy "$autonomy" \
    --argjson noGates "$( [ "$no_gates" = "true" ] && echo true || echo false )" \
    --arg stage "intake_complete" \
    '
    {
      version: 1,
      runId: $runId,
      repo: $repo,
      issueNumber: ($issue | tonumber),
      autonomyMode: $autonomy,
      noApprovalGates: $noGates,
      stage: $stage,
      orchestratorDotDir: ".orchestrator",
      paths: {
        runsDir: ".orchestrator/runs",
        worktreesRoot: ".orchestrator/worktrees",
        taskBrief: (".orchestrator/runs/" + $runId + "/task-brief.json"),
        events: (".orchestrator/runs/" + $runId + "/events.jsonl")
      }
    }
    ' >"${run_dir}/state.json"

  printf '%s' "$gh_json" | jq '.' >"${run_dir}/issue.snapshot.json"
  jq '.comments' <<<"$gh_json" >"${run_dir}/issue-comments.json"

  append_event "$run_dir" "intake" "task_brief_written" '{"path":"task-brief.json"}'

  cp "${ORC_TEMPLATES}/orchestrator.config.yml" "${run_dir}/orchestrator.config.example.yml"
  cp "${ORC_TEMPLATES}/aider.conf.yml" "${run_dir}/aider.conf.example.yml"

  mkdir -p "./.orchestrator/templates"
  local pr_tpl_dest="./.orchestrator/templates/pr_body.md"
  if [[ ! -f "$pr_tpl_dest" ]]; then
    jq -n --arg ISSUE_NUMBER "${issue_num}" '{ISSUE_NUMBER:$ISSUE_NUMBER}' \
      | python3 "${ORC_LIB}/render_template.py" "${ORC_TEMPLATES}/pr_body.md" "${pr_tpl_dest}"
  fi

  printf '%s\n' "$run_dir"
}
