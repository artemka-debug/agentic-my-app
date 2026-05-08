#!/usr/bin/env bash
# Phase 2: scaffold requirements.md / requirements.json from TaskBrief + templates.

phase2_requirements() {
  local run_dir="${1:?run directory}"
  require_cmd jq
  require_cmd python3

  [[ -f "${run_dir}/task-brief.json" ]] || die "missing ${run_dir}/task-brief.json (run Phase 1 first)"

  local brief_title brief_body brief_id repo issue_num url
  brief_title="$(jq -r '.title' "${run_dir}/task-brief.json")"
  brief_body="$(jq -r '.body' "${run_dir}/task-brief.json")"
  brief_id="$(jq -r '.id' "${run_dir}/task-brief.json")"
  repo="$(jq -r '.source.repo' "${run_dir}/task-brief.json")"
  issue_num="$(jq -r '.source.issueNumber' "${run_dir}/task-brief.json")"
  url="$(jq -r '.source.url' "${run_dir}/task-brief.json")"

  cp "${ORC_TEMPLATES}/prompts/product-owner.md" "${run_dir}/prompts/product-owner.md"

  jq -n \
    --arg TASK_BRIEF_ID "$brief_id" \
    --arg ISSUE_TITLE "$brief_title" \
    --arg ISSUE_URL "$url" \
    --arg REPO_SLUG "$repo" \
    --arg ISSUE_NUMBER "$issue_num" \
    '{TASK_BRIEF_ID:$TASK_BRIEF_ID, ISSUE_TITLE:$ISSUE_TITLE, ISSUE_URL:$ISSUE_URL, REPO_SLUG:$REPO_SLUG, ISSUE_NUMBER:$ISSUE_NUMBER}' \
    | python3 "${ORC_LIB}/render_template.py" "${ORC_TEMPLATES}/requirements.stub.md" "${run_dir}/requirements.md"

  {
    printf '\n---\n\n## Source issue body (verbatim)\n\n'
    printf '%s\n' "$brief_body"
  } >>"${run_dir}/requirements.md"

  jq -n \
    --arg runId "$(basename "$run_dir")" \
    --arg briefId "$brief_id" \
    --arg repo "$repo" \
    --argjson issue "$issue_num" \
    --arg title "$brief_title" \
    --arg body "$brief_body" \
    '
    {
      runId: $runId,
      taskBriefId: $briefId,
      github: { repo: $repo, issueNumber: ($issue | tonumber) },
      requirements: []
    }
    ' >"${run_dir}/requirements.json"

  append_event "$run_dir" "requirements" "requirements_stub_written" '{"paths":["requirements.md","requirements.json","prompts/product-owner.md"]}'
}
