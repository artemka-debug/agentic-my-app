#!/usr/bin/env bash
# Phase 3: decomposition stubs, work packages, approval gate doc.

phase3_decompose() {
  local run_dir="${1:?run directory}"
  require_cmd jq
  require_cmd python3

  [[ -f "${run_dir}/task-brief.json" ]] || die "missing ${run_dir}/task-brief.json"

  local brief_title brief_id
  brief_title="$(jq -r '.title' "${run_dir}/task-brief.json")"
  brief_id="$(jq -r '.id' "${run_dir}/task-brief.json")"
  local run_id
  run_id="$(basename "$run_dir")"

  cp "${ORC_TEMPLATES}/prompts/task-decomposition.md" "${run_dir}/prompts/task-decomposition.md"

  local gen_at
  gen_at="$(utc_ts)"

  jq -n \
    --arg RUN_ID "$run_id" \
    --arg TASK_BRIEF_ID "$brief_id" \
    --arg TASK_TITLE "$brief_title" \
    --arg GENERATED_AT "$gen_at" \
    '{RUN_ID:$RUN_ID, TASK_BRIEF_ID:$TASK_BRIEF_ID, TASK_TITLE:$TASK_TITLE, GENERATED_AT:$GENERATED_AT}' \
    | python3 "${ORC_LIB}/render_template.py" "${ORC_TEMPLATES}/decomposition.stub.md" "${run_dir}/decomposition.md"

  cp "${ORC_TEMPLATES}/work-packages.stub.json" "${run_dir}/work-packages.json"

  jq -n \
    --arg stub "Implement work packages derived from decomposition; constrain scope to listed REQ IDs." \
    '{
      candidates: [
        {candidateId:"candidate-a", strategy:"primary", promptStub:$stub},
        {candidateId:"candidate-b", strategy:"alternate", promptStub:$stub}
      ]
    }' >"${run_dir}/candidate-strategies.json"

  jq -n \
    --arg RUN_ID "$run_id" \
    --arg TASK_BRIEF_ID "$brief_id" \
    --arg GENERATED_AT "$gen_at" \
    '{RUN_ID:$RUN_ID, TASK_BRIEF_ID:$TASK_BRIEF_ID, GENERATED_AT:$GENERATED_AT}' \
    | python3 "${ORC_LIB}/render_template.py" "${ORC_TEMPLATES}/approval.md" "${run_dir}/approval.md"

  cp "${ORC_TEMPLATES}/verification-matrix.stub.md" "${run_dir}/verification-matrix.md"

  mkdir -p "${run_dir}/candidates/candidate-a" "${run_dir}/candidates/candidate-b"

  for c in candidate-a candidate-b; do
    jq -n \
      --arg RUN_ID "$run_id" \
      --arg CANDIDATE_ID "$c" \
      --arg TASK_TITLE "$brief_title" \
      '{RUN_ID:$RUN_ID, CANDIDATE_ID:$CANDIDATE_ID, TASK_TITLE:$TASK_TITLE}' \
      | python3 "${ORC_LIB}/render_template.py" \
        "${ORC_TEMPLATES}/prompts/worker-implement.stub.md" \
        "${run_dir}/candidates/${c}/worker-prompt.md"
  done

  append_event "$run_dir" "decomposition" "decomposition_stub_written" \
    '{"paths":["decomposition.md","work-packages.json","approval.md","verification-matrix.md","candidate-strategies.json"]}'
}
