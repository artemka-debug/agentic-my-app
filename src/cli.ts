#!/usr/bin/env node
import "./util/elevateAbortListenerBudget.js";
import readlinePromises from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { DEFAULT_CONFIG_YAML } from "./config/defaults.js";
import {
  loadConfig,
  resolveArtifactsRoot,
  resolveConfigPath,
  resolveCursorApiKey,
  type LoadedConfig,
} from "./config/loadConfig.js";
import {
  buildStubTaskInput,
  buildTaskInputFromGhJson,
  persistTaskInput,
  tryFetchGitHubIssueViaGh,
} from "./intake/githubIssue.js";
import {
  buildJiraStubTaskInput,
  buildTaskInputFromJiraJson,
  tryFetchJiraIssue,
} from "./intake/jiraIssue.js";
import { parseGitHubIssueRef } from "./intake/parseIssueRef.js";
import { parseJiraIssueRef } from "./intake/parseJiraIssueRef.js";
import { buildTaskInputFromMarkdownFile } from "./intake/taskFromFile.js";
import { envStreamExplicitlyEnabled } from "./util/agenticEnv.js";
import { createLogger } from "./logging/logger.js";
import {
  monitorPullRequest,
  type MonitorMergeStrategy,
  type MonitorPullRequestExitReason,
} from "./monitor/prMonitor.js";
import { ensureRunDir, newRunId } from "./runs/paths.js";
import {
  ensureRunLayout,
  readState,
  readTaskInput,
  runPaths,
} from "./runs/runWorkspace.js";
import { runSdkSmoke } from "./smoke/runSdkSmoke.js";
import { runInteractiveFull, workflowStepLog } from "./workflow/interactiveFull.js";
import { advanceWorkflow, requestCancel } from "./workflow/pipeline.js";
import {
  removeTelegramSessionRowsForRunId,
  resolveTelegramSessionFilePath,
} from "./telegram/sessions.js";
import {
  approveDecomposition,
  approveSpec,
  runPoAndDecomposition,
} from "./workflow/planning.js";
import { runImplementCandidates } from "./workflow/implementCandidates.js";
import { runVerifyAndReviews } from "./workflow/verifyAndReview.js";
import { runFinalizeAndCreatePr } from "./workflow/finalizePr.js";
import { runArchitecturePrototype } from "./workflow/architecturePrototype.js";
import { cleanupRun } from "./workflow/cleanupRun.js";
import { resumeAgentTurn } from "./sdk/runAgentTurn.js";
import { runVerificationCommands } from "./verify/commandRunner.js";
import { runTelegramBot } from "./telegram/runBot.js";

function writeFileIfMissing(filePath: string, contents: string): boolean {
  if (fs.existsSync(filePath)) return false;
  fs.writeFileSync(filePath, contents, "utf8");
  return true;
}

function openRun(args: { cwd: string; runId: string }) {
  const loaded = loadConfig(args.cwd);
  const { relativeRoot } = resolveArtifactsRoot(loaded);
  const paths = runPaths({
    cwd: args.cwd,
    artifactsRootRelative: relativeRoot,
    runId: args.runId,
  });
  if (!fs.existsSync(paths.root)) {
    throw new Error(`Run directory not found: ${paths.root}`);
  }
  ensureRunLayout(paths.root);
  return { loaded, paths };
}

function parseMergeStrategy(s: unknown): MonitorMergeStrategy {
  const m = String(s ?? "merge").trim().toLowerCase();
  if (m === "merge" || m === "squash" || m === "rebase") return m;
  throw new Error(`--merge must be merge, squash, or rebase (got ${String(s)})`);
}

function monitorOutcomeExitCode(outcome: MonitorPullRequestExitReason): number | null {
  if (outcome === "stopped_missing_cursor_api_key") return 2;
  if (
    outcome === "completed_upstream_merged" ||
    outcome === "completed_upstream_closed" ||
    outcome === "completed_merged_by_monitor" ||
    outcome === "skipped_pr_monitor_config"
  ) {
    return 0;
  }
  return null;
}

/** Override `workflow.consultHuman.enabled` for this invocation (undefined = keep YAML / env). */
function withConsultHumanEnabled(
  loaded: LoadedConfig,
  enabled: boolean | undefined,
): LoadedConfig {
  if (enabled === undefined) return loaded;
  return {
    ...loaded,
    config: {
      ...loaded.config,
      workflow: {
        ...loaded.config.workflow,
        consultHuman: {
          ...loaded.config.workflow.consultHuman,
          enabled,
        },
      },
    },
  };
}

function assertConsultFlags(opts: { consult?: boolean; noConsult?: boolean }) {
  if (opts.consult && opts.noConsult) {
    throw new Error("Use only one of --consult and --no-consult");
  }
}

function createRunFromIssueSpec(args: {
  cwd: string;
  spec: string;
  repo?: string;
}): { runId: string; taskDir: string; title: string; via: "gh_cli" | "stub" } {
  const loaded = loadConfig(args.cwd);
  const repoHint =
    args.repo?.trim() || loaded.config.github.defaultRepo.trim() || undefined;
  const parsed = parseGitHubIssueRef(args.spec, repoHint);
  if (!parsed) {
    throw new Error(
      `Could not parse GitHub issue reference: "${args.spec}". Try owner/repo#123 or a full issues URL.`,
    );
  }

  const runId = newRunId();
  const { relativeRoot } = resolveArtifactsRoot(loaded);
  const taskDir = ensureRunDir({
    cwd: args.cwd,
    artifactsRootRelative: relativeRoot,
    runId,
  });
  ensureRunLayout(taskDir);

  const jsonlPath = path.join(taskDir, "logs", "events.jsonl");
  const log = createLogger({
    runId,
    component: "intake.prototype_issue",
    jsonlPath,
  });
  log.log("info", "prototype_intake_started", { parsed });

  const fetched = tryFetchGitHubIssueViaGh({
    owner: parsed.owner,
    name: parsed.name,
    number: parsed.number,
    cwd: args.cwd,
  });
  const ghRecord =
    fetched.ok &&
      fetched.rawJson &&
      typeof fetched.rawJson === "object" &&
      !Array.isArray(fetched.rawJson)
      ? (fetched.rawJson as Record<string, unknown>)
      : null;
  const task = ghRecord
    ? buildTaskInputFromGhJson({
      parsed,
      ghJson: ghRecord,
      loaded,
      runId,
      ...(fetched.ok && fetched.defaultBranch
        ? { defaultBranchOverride: fetched.defaultBranch }
        : {}),
    })
    : buildStubTaskInput({
      parsed,
      loaded,
      runId,
      reason: fetched.ok ? "invalid gh json payload" : fetched.reason,
    });

  persistTaskInput(taskDir, task);
  fs.writeFileSync(
    path.join(taskDir, "config.resolved.json"),
    `${JSON.stringify(loaded.config, null, 2)}\n`,
    "utf8",
  );
  const via = fetched.ok ? "gh_cli" : "stub";
  log.log("info", "prototype_intake_persisted", {
    taskDir,
    title: task.title,
    via,
  });
  return { runId, taskDir, title: task.title, via };
}

async function createRunFromJiraSpec(args: {
  cwd: string;
  spec: string;
  logComponent?: string;
}): Promise<{
  runId: string;
  taskDir: string;
  title: string;
  via: "jira_api" | "atlassian_mcp" | "stub";
}> {
  const loaded = loadConfig(args.cwd);
  const parsed = parseJiraIssueRef(args.spec);
  if (!parsed) {
    throw new Error(
      `Could not parse Jira ticket: "${args.spec}". Expected PROJECT-123.`,
    );
  }

  const runId = newRunId();
  const { relativeRoot } = resolveArtifactsRoot(loaded);
  const taskDir = ensureRunDir({
    cwd: args.cwd,
    artifactsRootRelative: relativeRoot,
    runId,
  });
  ensureRunLayout(taskDir);

  const jsonlPath = path.join(taskDir, "logs", "events.jsonl");
  const log = createLogger({
    runId,
    component: args.logComponent ?? "intake.jira",
    jsonlPath,
  });
  log.log("info", "jira_intake_started", { parsed });

  const fetched = await tryFetchJiraIssue({
    parsed,
    loaded,
    transcriptPath: path.join(taskDir, "transcripts", `jira-intake-${parsed.key}.txt`),
  });
  const task = fetched.ok
    ? buildTaskInputFromJiraJson({
        parsed,
        jiraJson: fetched.rawJson,
        loaded,
        runId,
        via: fetched.via,
      })
    : buildJiraStubTaskInput({
        parsed,
        loaded,
        runId,
        reason: fetched.reason,
      });

  persistTaskInput(taskDir, task);
  fs.writeFileSync(
    path.join(taskDir, "config.resolved.json"),
    `${JSON.stringify(loaded.config, null, 2)}\n`,
    "utf8",
  );
  const via = fetched.ok ? fetched.via : "stub";
  log.log("info", "jira_intake_persisted", {
    taskDir,
    title: task.title,
    via,
  });
  return { runId, taskDir, title: task.title, via };
}

function createRunFromTaskFile(args: {
  cwd: string;
  taskFile: string;
}): { runId: string; taskDir: string; title: string } {
  const loaded = loadConfig(args.cwd);
  const runId = newRunId();
  const { relativeRoot } = resolveArtifactsRoot(loaded);
  const taskDir = ensureRunDir({
    cwd: args.cwd,
    artifactsRootRelative: relativeRoot,
    runId,
  });
  ensureRunLayout(taskDir);
  const task = buildTaskInputFromMarkdownFile({
    filePath: path.resolve(args.cwd, args.taskFile),
    loaded,
    runId,
  });
  persistTaskInput(taskDir, task);
  fs.writeFileSync(
    path.join(taskDir, "config.resolved.json"),
    `${JSON.stringify(loaded.config, null, 2)}\n`,
    "utf8",
  );
  return { runId, taskDir, title: task.title };
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("agentic-my-app")
    .description(
      "Local-only Cursor SDK CLI for agentic-my-app (see docs/plan.md)",
    );

  program
    .command("telegram")
    .description(
      "Telegram bot (long polling): TELEGRAM_BOT_TOKEN + AGENTIC_MY_APP_TELEGRAM_ALLOWED_CHATS",
    )
    .option("--cwd <dir>", "working directory", process.cwd())
    .option(
      "--autonomous",
      "skip human approval prompts where YAML allows",
      false,
    )
    .option(
      "--debug",
      "forward model stream chunks to Telegram; may set AGENTIC_MY_APP_STREAM",
      false,
    )
    .action(
      async (opts: { cwd?: string; autonomous?: boolean; debug?: boolean }) => {
        const cwd = path.resolve(opts.cwd ?? process.cwd());
        await runTelegramBot({
          cwd,
          autonomous: Boolean(opts.autonomous),
          debug: Boolean(opts.debug),
        });
      },
    );

  program
    .command("init")
    .description(
      "Write agentic-my-app.config.yaml with every option, acceptable values, and comments (skip if exists; --force overwrites)",
    )
    .option("-f, --force", "overwrite existing config", false)
    .action((opts: { force?: boolean }) => {
      const cwd = process.cwd();
      const target = resolveConfigPath(cwd);
      if (opts.force) {
        fs.writeFileSync(target, DEFAULT_CONFIG_YAML, "utf8");
        process.stdout.write(`wrote ${target}\n`);
        return;
      }
      const wrote = writeFileIfMissing(target, DEFAULT_CONFIG_YAML);
      process.stdout.write(
        wrote ? `created ${target}\n` : `exists ${target}\n`,
      );
    });

  program
    .command("smoke")
    .description(
      "Smoke-test local Agent.create/send/wait (skipped if API key missing)",
    )
    .action(async () => {
      const loaded = loadConfig(process.cwd());
      const code = await runSdkSmoke({
        cwd: loaded.cwd,
        apiKey: resolveCursorApiKey(loaded),
        modelId: loaded.config.runtime.cursor.models.implementer,
      });
      process.exitCode = code;
    });

  program
    .command("full")
    .alias("auto")
    .description(
      "Single command: plan → implement → verify → open PR → monitor comments/CI → merge when review is APPROVED",
    )
    .argument("[runId]", "existing run (use exactly one of this, --issue, or --task)")
    .option("--cwd <dir>", "working directory", process.cwd())
    .option(
      "--issue <spec>",
      "GitHub issue ref (same as `agentic-my-app issue`); not with --task or runId",
    )
    .option(
      "--task <file>",
      "Markdown task file; not with --issue, --jira, or runId",
    )
    .option(
      "--jira <key>",
      "Jira ticket key (PROJECT-123); not with --issue, --task, or runId",
    )
    .option(
      "-r, --repo <repo>",
      "owner/repo when --issue is a bare issue number",
    )
    .option(
      "--autonomous",
      "skip terminal approval prompts (honor YAML autonomy flags instead)",
      false,
    )
    .option(
      "--no-stream",
      "do not stream agent text to the terminal during the run",
    )
    .option(
      "--merge <strategy>",
      "when PR is approved: merge | squash | rebase",
      "merge",
    )
    .option(
      "--consult",
      "force terminal consultation for planning questions and risky tools (enabled by default for full/auto)",
    )
    .option("--no-consult", "disable Human consultation for this run", false)
    .action(
      async (
        runIdArg: string | undefined,
        opts: {
          cwd?: string;
          issue?: string;
          jira?: string;
          task?: string;
          repo?: string;
          autonomous?: boolean;
          merge?: string;
          consult?: boolean;
          noConsult?: boolean;
          stream?: boolean;
        },
      ) => {
        assertConsultFlags(opts);
        const cwd = path.resolve(opts.cwd ?? process.cwd());
        const mergeStrategy = parseMergeStrategy(opts.merge);
        const invokedAs = process.argv[2] ?? "";
        const autonomous = Boolean(opts.autonomous) || invokedAs === "auto";
        if (opts.stream !== false && !envStreamExplicitlyEnabled()) {
          process.env.AGENTIC_MY_APP_STREAM = "1";
        }
        const consultEnabled =
          opts.consult === true
            ? true
            : opts.noConsult === true
              ? false
              : true;

        const idArg = runIdArg?.trim();
        const spec = opts.issue?.trim();
        const jiraSpec = opts.jira?.trim();
        const taskFile = opts.task?.trim();
        const sources = [
          Boolean(idArg),
          Boolean(spec),
          Boolean(jiraSpec),
          Boolean(taskFile),
        ].filter(Boolean).length;
        if (sources !== 1) {
          throw new Error(
            "Provide exactly one of: [runId], --issue <spec>, --jira <key>, or --task <file>",
          );
        }

        const rl = readlinePromises.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        try {
          let runId: string;
          let loaded = loadConfig(cwd);

          if (spec) {
            const repoHint =
              opts.repo?.trim() ||
              loaded.config.github.defaultRepo.trim() ||
              undefined;
            const parsed = parseGitHubIssueRef(spec, repoHint);
            if (!parsed) {
              throw new Error(
                `Could not parse GitHub issue reference: "${spec}". Try owner/repo#123 or a full issues URL.`,
              );
            }
            runId = newRunId();
            const { relativeRoot } = resolveArtifactsRoot(loaded);
            const taskDir = ensureRunDir({
              cwd,
              artifactsRootRelative: relativeRoot,
              runId,
            });
            ensureRunLayout(taskDir);
            const jsonlPath = path.join(taskDir, "logs", "events.jsonl");
            const log = createLogger({
              runId,
              component: "intake.full_issue",
              jsonlPath,
            });
            log.log("info", "full_intake_started", { parsed });
            const fetched = tryFetchGitHubIssueViaGh({
              owner: parsed.owner,
              name: parsed.name,
              number: parsed.number,
              cwd,
            });
            const ghRecord =
              fetched.ok &&
                fetched.rawJson &&
                typeof fetched.rawJson === "object" &&
                !Array.isArray(fetched.rawJson)
                ? (fetched.rawJson as Record<string, unknown>)
                : null;
            const task = ghRecord
              ? buildTaskInputFromGhJson({
                parsed,
                ghJson: ghRecord,
                loaded,
                runId,
                ...(fetched.ok && fetched.defaultBranch
                  ? { defaultBranchOverride: fetched.defaultBranch }
                  : {}),
              })
              : buildStubTaskInput({
                parsed,
                loaded,
                runId,
                reason: fetched.ok ? "invalid gh json payload" : fetched.reason,
              });
            persistTaskInput(taskDir, task);
            fs.writeFileSync(
              path.join(taskDir, "config.resolved.json"),
              `${JSON.stringify(loaded.config, null, 2)}\n`,
              "utf8",
            );
            log.log("info", "full_intake_persisted", {
              title: task.title,
              via: fetched.ok ? "gh_cli" : "stub",
            });
            workflowStepLog(
              `Created run from issue — runId=${runId} title=${JSON.stringify(task.title)}`,
            );
          } else if (jiraSpec) {
            const created = await createRunFromJiraSpec({
              cwd,
              spec: jiraSpec,
              logComponent: "intake.full_jira",
            });
            runId = created.runId;
            workflowStepLog(
              `Created run from Jira — runId=${runId} title=${JSON.stringify(created.title)} via=${created.via}`,
            );
          } else if (taskFile) {
            runId = newRunId();
            loaded = loadConfig(cwd);
            const { relativeRoot } = resolveArtifactsRoot(loaded);
            const taskDir = ensureRunDir({
              cwd,
              artifactsRootRelative: relativeRoot,
              runId,
            });
            ensureRunLayout(taskDir);
            const task = buildTaskInputFromMarkdownFile({
              filePath: path.resolve(cwd, taskFile),
              loaded,
              runId,
            });
            persistTaskInput(taskDir, task);
            fs.writeFileSync(
              path.join(taskDir, "config.resolved.json"),
              `${JSON.stringify(loaded.config, null, 2)}\n`,
              "utf8",
            );
            workflowStepLog(
              `Created run from task file — runId=${runId} title=${JSON.stringify(task.title)}`,
            );
          } else {
            runId = idArg!;
          }

          loaded = withConsultHumanEnabled(loadConfig(cwd), consultEnabled);
          const { paths } = openRun({ cwd, runId });
          workflowStepLog(`Starting full flow for runId=${runId}`);

          const outcome = await runInteractiveFull({
            loaded,
            paths,
            autonomous,
            rl,
            mergeStrategy,
          });

          process.stdout.write(
            `${JSON.stringify(readState(paths), null, 2)}\n`,
          );
          const exitCode = monitorOutcomeExitCode(outcome);
          if (exitCode !== null) {
            rl.close();
            process.exit(exitCode);
          }
        } finally {
          rl.close();
        }
      },
    );

  program
    .command("prototype")
    .description(
      "Prototype architecture flow: PO → test writer → implementer → verifier/repair loop → cleanup/evaluation → PR → monitor",
    )
    .argument("[runId]", "existing run (use exactly one of this, --issue, --jira, or --task)")
    .option("--cwd <dir>", "working directory", process.cwd())
    .option("--issue <spec>", "GitHub issue ref; not with --jira, --task, or runId")
    .option("--jira <key>", "Jira ticket key (PROJECT-123); not with --issue, --task, or runId")
    .option("--task <file>", "Markdown task file; not with --issue, --jira, or runId")
    .option("-r, --repo <repo>", "owner/repo when --issue is a bare issue number")
    .option("--no-stream", "do not stream agent text to the terminal during the run")
    .option("--no-monitor", "skip PR comment/CI monitoring after PR creation")
    .option(
      "--merge <strategy>",
      "when PR is approved during monitor: merge | squash | rebase",
      "merge",
    )
    .action(
      async (
        runIdArg: string | undefined,
        opts: {
          cwd?: string;
          issue?: string;
          jira?: string;
          task?: string;
          repo?: string;
          stream?: boolean;
          monitor?: boolean;
          merge?: string;
        },
      ) => {
        const cwd = path.resolve(opts.cwd ?? process.cwd());
        const idArg = runIdArg?.trim();
        const issueSpec = opts.issue?.trim();
        const jiraSpec = opts.jira?.trim();
        const taskFile = opts.task?.trim();
        const sources = [
          Boolean(idArg),
          Boolean(issueSpec),
          Boolean(jiraSpec),
          Boolean(taskFile),
        ].filter(Boolean).length;
        if (sources !== 1) {
          throw new Error(
            "Provide exactly one of: [runId], --issue <spec>, --jira <key>, or --task <file>",
          );
        }
        if (opts.stream !== false && !envStreamExplicitlyEnabled()) {
          process.env.AGENTIC_MY_APP_STREAM = "1";
        }

        let runId: string;
        if (issueSpec) {
          const created = createRunFromIssueSpec({
            cwd,
            spec: issueSpec,
            repo: opts.repo,
          });
          runId = created.runId;
          workflowStepLog(
            `Prototype run created from issue — runId=${runId} title=${JSON.stringify(created.title)} via=${created.via}`,
          );
        } else if (jiraSpec) {
          const created = await createRunFromJiraSpec({
            cwd,
            spec: jiraSpec,
            logComponent: "intake.prototype_jira",
          });
          runId = created.runId;
          workflowStepLog(
            `Prototype run created from Jira — runId=${runId} title=${JSON.stringify(created.title)} via=${created.via}`,
          );
        } else if (taskFile) {
          const created = createRunFromTaskFile({ cwd, taskFile });
          runId = created.runId;
          workflowStepLog(
            `Prototype run created from task file — runId=${runId} title=${JSON.stringify(created.title)}`,
          );
        } else {
          runId = idArg!;
        }

        const { loaded, paths } = openRun({ cwd, runId });
        const mergeStrategy = parseMergeStrategy(opts.merge);
        const followPr = opts.monitor !== false && loaded.config.monitoring.enabled;
        workflowStepLog(`Starting architecture prototype for runId=${runId}`);
        await runArchitecturePrototype({
          loaded,
          paths,
          options: {
            followPr,
            log: workflowStepLog,
            monitor: async (prUrl: string) => {
              const outcome = await monitorPullRequest({
                loaded,
                paths,
                prUrl,
                mergeWhenApproved: true,
                mergeStrategy,
                onLog: workflowStepLog,
              });
              const exitCode = monitorOutcomeExitCode(outcome);
              if (exitCode !== null) process.exitCode = exitCode;
            },
          },
        });
        process.stdout.write(`${JSON.stringify(readState(paths), null, 2)}\n`);
      },
    );

  program
    .command("issue")
    .description("GitHub issue intake via gh (linked PRs optional)")
    .argument("[spec]", "owner/repo#123, GitHub issue URL, or issue number")
    .option("-r, --repo <repo>", "owner/repo when spec is a bare issue number")
    .option("--cwd <dir>", "working directory", process.cwd())
    .option(
      "--workflow",
      "after intake, advance the full local pipeline (requires API key)",
      false,
    )
    .option(
      "--autonomous",
      "with --workflow: skip gates when autonomy flags allow",
      false,
    )
    .option(
      "--follow-pr",
      "with --workflow: poll CI/reviews after PR creation",
      false,
    )
    .action(
      async (
        spec: string | undefined,
        opts: {
          repo?: string;
          cwd?: string;
          workflow?: boolean;
          autonomous?: boolean;
          followPr?: boolean;
        },
      ) => {
        const cwd = path.resolve(opts.cwd ?? process.cwd());
        const loaded = loadConfig(cwd);
        const repoHint =
          opts.repo?.trim() ||
          loaded.config.github.defaultRepo.trim() ||
          undefined;
        const rawSpec =
          spec?.trim() ||
          (() => {
            throw new Error(
              "Missing issue spec. Example: agentic-my-app issue owner/repo#123",
            );
          })();

        const parsed = parseGitHubIssueRef(rawSpec, repoHint);
        if (!parsed) {
          throw new Error(
            `Could not parse GitHub issue reference: "${rawSpec}". Try owner/repo#123, a github.com issues URL, or 123 --repo owner/repo.`,
          );
        }

        const runId = newRunId();
        const { relativeRoot } = resolveArtifactsRoot(loaded);
        const taskDir = ensureRunDir({
          cwd,
          artifactsRootRelative: relativeRoot,
          runId,
        });
        ensureRunLayout(taskDir);

        const jsonlPath = path.join(taskDir, "logs", "events.jsonl");
        const log = createLogger({
          runId,
          component: "intake.github_issue",
          jsonlPath,
        });
        log.log("info", "intake_started", { parsed });

        const fetched = tryFetchGitHubIssueViaGh({
          owner: parsed.owner,
          name: parsed.name,
          number: parsed.number,
          cwd,
        });

        const ghRecord =
          fetched.ok &&
            fetched.rawJson &&
            typeof fetched.rawJson === "object" &&
            !Array.isArray(fetched.rawJson)
            ? (fetched.rawJson as Record<string, unknown>)
            : null;

        const task = ghRecord
          ? buildTaskInputFromGhJson({
            parsed,
            ghJson: ghRecord,
            loaded,
            runId,
            ...(fetched.ok && fetched.defaultBranch
              ? { defaultBranchOverride: fetched.defaultBranch }
              : {}),
          })
          : buildStubTaskInput({
            parsed,
            loaded,
            runId,
            reason: fetched.ok ? "invalid gh json payload" : fetched.reason,
          });

        persistTaskInput(taskDir, task);
        fs.writeFileSync(
          path.join(taskDir, "config.resolved.json"),
          `${JSON.stringify(loaded.config, null, 2)}\n`,
          "utf8",
        );
        log.log("info", "intake_persisted", {
          taskDir,
          title: task.title,
          via: fetched.ok ? "gh_cli" : "stub",
        });

        process.stdout.write(
          `${JSON.stringify({ runId, taskDir, title: task.title, via: fetched.ok ? "gh_cli" : "stub" })}\n`,
        );

        if (opts.workflow) {
          const { paths } = openRun({ cwd, runId });
          await advanceWorkflow({
            loaded,
            paths,
            autonomous: Boolean(opts.autonomous),
            followPr: Boolean(opts.followPr),
          });
          process.stdout.write(`${JSON.stringify(readState(paths))}\n`);
        }
      },
    );

  program
    .command("task")
    .description("Create a run from a local markdown task file")
    .argument("<file>", "path to markdown file")
    .option("--cwd <dir>", "working directory", process.cwd())
    .action((file: string, opts: { cwd?: string }) => {
      const cwd = path.resolve(opts.cwd ?? process.cwd());
      const loaded = loadConfig(cwd);
      const runId = newRunId();
      const { relativeRoot } = resolveArtifactsRoot(loaded);
      const taskDir = ensureRunDir({
        cwd,
        artifactsRootRelative: relativeRoot,
        runId,
      });
      ensureRunLayout(taskDir);
      const task = buildTaskInputFromMarkdownFile({
        filePath: path.resolve(cwd, file),
        loaded,
        runId,
      });
      persistTaskInput(taskDir, task);
      fs.writeFileSync(
        path.join(taskDir, "config.resolved.json"),
        `${JSON.stringify(loaded.config, null, 2)}\n`,
        "utf8",
      );
      process.stdout.write(
        `${JSON.stringify({ runId, taskDir, title: task.title })}\n`,
      );
    });

  program
    .command("jira")
    .description("Jira ticket intake via REST API token or Atlassian MCP fallback")
    .argument("<key>", "Jira ticket key, e.g. PROJECT-123")
    .option("--cwd <dir>", "working directory", process.cwd())
    .option(
      "--workflow",
      "after intake, advance the full local pipeline (requires API key)",
      false,
    )
    .option(
      "--autonomous",
      "with --workflow: skip gates when autonomy flags allow",
      false,
    )
    .option(
      "--follow-pr",
      "with --workflow: poll CI/reviews after PR creation",
      false,
    )
    .action(
      async (
        key: string,
        opts: {
          cwd?: string;
          workflow?: boolean;
          autonomous?: boolean;
          followPr?: boolean;
        },
      ) => {
        const cwd = path.resolve(opts.cwd ?? process.cwd());
        const created = await createRunFromJiraSpec({
          cwd,
          spec: key,
          logComponent: "intake.jira",
        });
        process.stdout.write(
          `${JSON.stringify({
            runId: created.runId,
            taskDir: created.taskDir,
            title: created.title,
            via: created.via,
          })}\n`,
        );

        if (opts.workflow) {
          const { loaded, paths } = openRun({ cwd, runId: created.runId });
          await advanceWorkflow({
            loaded,
            paths,
            autonomous: Boolean(opts.autonomous),
            followPr: Boolean(opts.followPr),
          });
          process.stdout.write(`${JSON.stringify(readState(paths))}\n`);
        }
      },
    );

  program
    .command("plan")
    .description("Run PO + decomposition agents (writes requirements.md + decomposition.json)")
    .argument("<runId>", "run id under artifacts root")
    .option("--cwd <dir>", "working directory", process.cwd())
    .option("--autonomous", "skip human gates (uses autonomy flags)", false)
    .option(
      "--consult",
      "prompt in the terminal during PO + decomposition (questions + best-effort before tools)",
      false,
    )
    .option("--no-consult", "disable Human consultation for this command", false)
    .action(
      async (
        runId: string,
        opts: {
          cwd?: string;
          autonomous?: boolean;
          consult?: boolean;
          noConsult?: boolean;
        },
      ) => {
        assertConsultFlags(opts);
        const cwd = path.resolve(opts.cwd ?? process.cwd());
        let { loaded, paths } = openRun({ cwd, runId });
        loaded = withConsultHumanEnabled(
          loaded,
          opts.consult === true
            ? true
            : opts.noConsult === true
              ? false
              : undefined,
        );
        const task = readTaskInput(paths);
        await runPoAndDecomposition({
          loaded,
          paths,
          task,
          autonomous: Boolean(opts.autonomous),
        });
        process.stdout.write(`${JSON.stringify(readState(paths))}\n`);
      });

  program
    .command("workflow")
    .alias("run")
    .description("Advance workflow from current phase through PR creation (and optional monitor)")
    .argument("<runId>", "run id")
    .option("--cwd <dir>", "working directory", process.cwd())
    .option("--autonomous", "honor autonomy flags for approvals", false)
    .option("--follow-pr", "after PR creation, poll until merge/close / max loops", false)
    .action(
      async (
        runId: string,
        opts: { cwd?: string; autonomous?: boolean; followPr?: boolean },
      ) => {
        const cwd = path.resolve(opts.cwd ?? process.cwd());
        const { loaded, paths } = openRun({ cwd, runId });
        await advanceWorkflow({
          loaded,
          paths,
          autonomous: Boolean(opts.autonomous),
          followPr: Boolean(opts.followPr),
        });
        process.stdout.write(`${JSON.stringify(readState(paths))}\n`);
      },
    );

  program
    .command("approve")
    .description("Record human approval for spec or decomposition gate")
    .argument("<runId>", "run id")
    .argument("<target>", "spec | decomposition")
    .option("--cwd <dir>", "working directory", process.cwd())
    .action((runId: string, target: string, opts: { cwd?: string }) => {
      const cwd = path.resolve(opts.cwd ?? process.cwd());
      const { paths } = openRun({ cwd, runId });
      const t = target.trim().toLowerCase();
      if (t === "spec") approveSpec(paths);
      else if (t === "decomposition") approveDecomposition(paths);
      else throw new Error('target must be "spec" or "decomposition"');
      process.stdout.write(`ok ${t}\n`);
    });

  program
    .command("implement")
    .description("Create worktrees and run implementation agents")
    .argument("<runId>", "run id")
    .option("--cwd <dir>", "working directory", process.cwd())
    .action(async (runId: string, opts: { cwd?: string }) => {
      const cwd = path.resolve(opts.cwd ?? process.cwd());
      const { loaded, paths } = openRun({ cwd, runId });
      await runImplementCandidates({ loaded, paths });
      process.stdout.write(`${JSON.stringify(readState(paths))}\n`);
    });

  program
    .command("verify")
    .description("Run mechanical verification + verifier agent on candidates")
    .argument("<runId>", "run id")
    .option("--cwd <dir>", "working directory", process.cwd())
    .action(async (runId: string, opts: { cwd?: string }) => {
      const cwd = path.resolve(opts.cwd ?? process.cwd());
      const { loaded, paths } = openRun({ cwd, runId });
      await runVerifyAndReviews({ loaded, paths });
      process.stdout.write(`${JSON.stringify(readState(paths))}\n`);
    });

  program
    .command("finalize")
    .description("Finalizer agent, git push, gh pr create")
    .argument("<runId>", "run id")
    .option("--cwd <dir>", "working directory", process.cwd())
    .action(async (runId: string, opts: { cwd?: string }) => {
      const cwd = path.resolve(opts.cwd ?? process.cwd());
      const { loaded, paths } = openRun({ cwd, runId });
      await runFinalizeAndCreatePr({ loaded, paths });
      process.stdout.write(`${JSON.stringify(readState(paths))}\n`);
    });

  program
    .command("monitor-pr")
    .description(
      "Poll a PR for CI/reviews/Comments; fix loops; merge when approved unless --no-merge",
    )
    .argument("<prUrl>", "PR URL or number")
    .requiredOption("--run <runId>", "run id for artifacts")
    .option("--cwd <dir>", "working directory", process.cwd())
    .option(
      "--no-merge",
      "do not run `gh pr merge` when review is APPROVED (still polls until closed/merged)",
      false,
    )
    .option(
      "--merge-strategy <strategy>",
      "when merging: merge | squash | rebase",
      "merge",
    )
    .action(
      async (
        prUrl: string,
        opts: {
          cwd?: string;
          run: string;
          noMerge?: boolean;
          mergeStrategy?: string;
        },
      ) => {
        const cwd = path.resolve(opts.cwd ?? process.cwd());
        const { loaded, paths } = openRun({ cwd, runId: opts.run });
        const outcome = await monitorPullRequest({
          loaded,
          paths,
          prUrl,
          mergeWhenApproved: !opts.noMerge,
          mergeStrategy: parseMergeStrategy(opts.mergeStrategy),
        });
        const payload: {
          outcome: MonitorPullRequestExitReason;
          phase: string;
        } = {
          outcome,
          phase: readState(paths).phase,
        };
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        process.exit(monitorOutcomeExitCode(outcome) ?? 0);
      },
    );

  program
    .command("resume")
    .description("Continue workflow from persisted state.json phase")
    .argument("<runId>", "run id")
    .option("--cwd <dir>", "working directory", process.cwd())
    .option("--autonomous", "honor autonomy flags", false)
    .option("--follow-pr", "follow PR after create", false)
    .action(
      async (
        runId: string,
        opts: { cwd?: string; autonomous?: boolean; followPr?: boolean },
      ) => {
        const cwd = path.resolve(opts.cwd ?? process.cwd());
        const { loaded, paths } = openRun({ cwd, runId });
        await advanceWorkflow({
          loaded,
          paths,
          autonomous: Boolean(opts.autonomous),
          followPr: Boolean(opts.followPr),
        });
        process.stdout.write(`${JSON.stringify(readState(paths))}\n`);
      },
    );

  program
    .command("cancel")
    .description(
      "Request cancellation (honored during agent streams + consult); drops telegram-sessions rows for this runId",
    )
    .argument("<runId>", "run id")
    .option("--cwd <dir>", "working directory", process.cwd())
    .action((runId: string, opts: { cwd?: string }) => {
      const cwd = path.resolve(opts.cwd ?? process.cwd());
      const loaded = loadConfig(cwd);
      const { paths } = openRun({ cwd, runId });
      requestCancel(paths);
      const n = removeTelegramSessionRowsForRunId(
        resolveTelegramSessionFilePath(loaded),
        runId.trim(),
      );
      process.stdout.write(
        n > 0
          ? `cancel requested (${n} telegram session row(s) removed for this run)\n`
          : "cancel requested\n",
      );
    });

  program
    .command("status")
    .description("Print run state.json")
    .argument("<runId>", "run id")
    .option("--cwd <dir>", "working directory", process.cwd())
    .action((runId: string, opts: { cwd?: string }) => {
      const cwd = path.resolve(opts.cwd ?? process.cwd());
      const { paths } = openRun({ cwd, runId });
      process.stdout.write(
        `${JSON.stringify(readState(paths), null, 2)}\n`,
      );
    });

  program
    .command("sdk-resume")
    .description("Resume a persisted local agent id with a new prompt (CLI audit)")
    .argument("<runId>", "run id (for cwd resolution)")
    .option("--cwd <dir>", "working directory", process.cwd())
    .requiredOption("--agent-id <id>", "Agent.agentId from agents/*.json")
    .requiredOption("--prompt <text>", "follow-up prompt")
    .option("--model <id>", "model id", undefined)
    .action(
      async (
        runId: string,
        opts: { cwd?: string; agentId: string; prompt: string; model?: string },
      ) => {
        const cwd = path.resolve(opts.cwd ?? process.cwd());
        const loaded = loadConfig(cwd);
        const apiKey = resolveCursorApiKey(loaded);
        if (!apiKey) throw new Error("Missing Cursor API key");
        const paths = openRun({ cwd, runId: runId }).paths;
        const task = readTaskInput(paths);
        const modelId =
          opts.model ?? loaded.config.runtime.cursor.models.implementer;
        await resumeAgentTurn({
          apiKey,
          modelId,
          cwd: task.repo.localPath,
          agentId: opts.agentId,
          prompt: opts.prompt,
          settingSources: loaded.config.runtime.cursor.settingSources,
          transcriptPath: path.join(
            paths.transcriptDir,
            `sdk-resume-${Date.now()}.txt`,
          ),
        });
        process.stdout.write("ok\n");
      },
    );

  program
    .command("verify-cmd")
    .description("Run configured verification commands in cwd (for debugging)")
    .argument("<runId>", "run id")
    .option("--cwd <dir>", "repo cwd", process.cwd())
    .action((runId: string, opts: { cwd?: string }) => {
      const cwd = path.resolve(opts.cwd ?? process.cwd());
      const loaded = loadConfig(cwd);
      const { paths } = openRun({ cwd, runId });
      const results = runVerificationCommands({
        cwd,
        config: loaded.config,
        runRoot: paths.root,
        candidateId: "manual",
      });
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    });

  program
    .command("cleanup")
    .description("Remove git worktrees recorded for a run; optionally delete the run directory")
    .argument("<runId>", "run id")
    .option("--cwd <dir>", "working directory", process.cwd())
    .option("--purge-run-dir", "also delete .agentic-my-app/runs/<runId>", false)
    .action((runId: string, opts: { cwd?: string; purgeRunDir?: boolean }) => {
      const cwd = path.resolve(opts.cwd ?? process.cwd());
      const loaded = loadConfig(cwd);
      const summary = cleanupRun({
        loaded,
        runId,
        removeRunDir: Boolean(opts.purgeRunDir),
      });
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
