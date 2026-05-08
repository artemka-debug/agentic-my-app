#!/usr/bin/env node
import { program } from 'commander';
import fs from 'node:fs';
import path from 'node:path';

import {
  approvalsPath,
  emptyApprovals,
  readApprovals,
  recordGateDecision,
  writeApprovals,
  yamlApprovalSnapshot,
  type GateName,
  type GateStatus,
} from './approvals.js';
import { loadConfig } from './config.js';
import {
  fetchIssueViaGhCli,
  parseGitHubIssueUrl,
  writeIntakeArtifacts,
  type IntakePayload,
} from './intake-github.js';
import { buildManualPayload, writeManualIntake } from './intake-manual.js';
import { configPath, resolveAgenticRoot, runDir } from './paths.js';
import {
  ensureRunDirectories,
  issueRunSlug,
  latestRunId,
  listRunIds,
  newGenericRunId,
} from './run.js';
import { applyPlaceholders, readTemplateFile } from './templates.js';

function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

function projectCwd(): string {
  const merged = program.optsWithGlobals?.() as { cwd?: string } | undefined;
  const raw = merged?.cwd ?? (program.opts() as { cwd?: string }).cwd ?? process.cwd();
  return path.resolve(raw);
}

function resolveRun(agenticRoot: string, optRun?: string): string {
  const runId =
    optRun ??
    latestRunId(agenticRoot) ??
    die('No runs found; run `agentic intake …` first or pass `--run <id>`.');
  return runDir(agenticRoot, runId);
}

function readIntakeSummary(runPath: string): string {
  const p = path.join(runPath, 'intake.json');
  if (!fs.existsSync(p)) return '_missing intake.json_';
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  if (raw.source === 'github') {
    const issue = (raw.issue ?? {}) as { title?: string };
    return String(issue.title ?? '');
  }
  if (raw.source === 'manual') {
    return `${String(raw.title ?? '')}`;
  }
  return '_unknown intake format_';
}

function sourceLabel(runPath: string): string {
  const p = path.join(runPath, 'intake.json');
  if (!fs.existsSync(p)) return 'unknown';
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { source?: string };
  return String(raw.source ?? 'unknown');
}

function ensureSpecPrereqs(runPath: string): void {
  if (!fs.existsSync(path.join(runPath, 'intake.json'))) {
    die(`${runPath} has no intake.json — run intake first.`);
  }
}

export function cliMain(argv = process.argv): void {
  program
    .name('agentic')
    .description('Local-first Cursor agentic workflow orchestrator (Phase 1 foundation)')
    .option('--cwd <dir>', 'Project root containing `.agentic/`', process.cwd());

  program
    .command('init')
    .description('Create `.agentic/` with default config.yaml and layout')
    .option('--force', 'Overwrite existing config.yaml', false)
    .action((opts) => {
      const cwd = projectCwd();
      const agentic = path.join(cwd, '.agentic');
      fs.mkdirSync(path.join(agentic, 'runs'), { recursive: true });
      fs.mkdirSync(path.join(agentic, 'prompts'), { recursive: true });
      fs.mkdirSync(path.join(agentic, 'roles'), { recursive: true });
      const cfgDest = configPath(agentic);
      if (fs.existsSync(cfgDest) && !opts.force) {
        console.error(`Already initialized: ${cfgDest} (use --force to overwrite).`);
        process.exitCode = 2;
        return;
      }
      const tpl = readTemplateFile('default-config.yaml');
      fs.writeFileSync(cfgDest, tpl, 'utf8');
      console.error(`Initialized ${cfgDest}`);
    });

  const intake = program.command('intake').description('Task intake (GitHub issue or manual text)');

  intake
    .command('github')
    .description('Fetch a GitHub issue via `gh` CLI and seed a new run')
    .argument('<issueUrl>', 'Full GitHub issue URL')
    .action((issueUrl: string) => {
      const cwd = projectCwd();
    const agenticRoot = resolveAgenticRoot(cwd);
    loadConfig(agenticRoot);
    const yamlText = fs.readFileSync(configPath(agenticRoot), 'utf8');

    let parsedUrl;
    try {
      parsedUrl = parseGitHubIssueUrl(issueUrl);
    } catch (e) {
      die(e instanceof Error ? e.message : String(e));
    }
    const ghJson = fetchIssueViaGhCli(parsedUrl);
    const runId = issueRunSlug(ghJson.number);
    const rpath = runDir(agenticRoot, runId);
    if (fs.existsSync(rpath)) die(`Run directory already exists: ${rpath}`);
    fs.mkdirSync(rpath, { recursive: true });
    ensureRunDirectories(rpath);

    const payload: IntakePayload = {
      source: 'github',
      fetchedAt: new Date().toISOString(),
      issueUrl: ghJson.url,
      repo: { owner: parsedUrl.owner, name: parsedUrl.repo, host: parsedUrl.host },
      issue: ghJson,
    };
    writeIntakeArtifacts(rpath, payload);

    const snap = yamlApprovalSnapshot(yamlText);
    writeApprovals(approvalsPath(rpath), emptyApprovals(runId, snap));

    console.error(`Run created: ${rpath}`);
      console.error(`Next: agentic --cwd "${cwd}" spec --run ${runId}`);
    });

  intake
    .command('manual')
    .description('Create a manual task run')
    .option('--title <t>', 'Short title')
    .option('--body <text>', 'Task body/description')
    .option('--body-file <path>', 'Read body from file')
    .action((opts: { title?: string; body?: string; bodyFile?: string }) => {
      const cwd = projectCwd();
      const agenticRoot = resolveAgenticRoot(cwd);
      loadConfig(agenticRoot);
      const yamlText = fs.readFileSync(configPath(agenticRoot), 'utf8');

      let body = '';
      if (opts.bodyFile) body = fs.readFileSync(opts.bodyFile, 'utf8');
      else if (opts.body !== undefined) body = opts.body;
      else body = fs.readFileSync(0, 'utf8');
      const title = opts.title ?? 'Manual task';
      const runId = newGenericRunId();
      const rpath = runDir(agenticRoot, runId);
      fs.mkdirSync(rpath, { recursive: true });
      ensureRunDirectories(rpath);
      const payload = buildManualPayload(title, body);
      writeManualIntake(rpath, payload);
      writeApprovals(approvalsPath(rpath), emptyApprovals(runId, yamlApprovalSnapshot(yamlText)));
      console.stderr.write(`Run created: ${rpath}\n`);
      console.stderr.write(`Next: agentic --cwd "${cwd}" spec --run ${runId}\n`);
    });

  program
    .command('spec')
    .description('Generate `spec.md` placeholder from templates (edit in Cursor)')
    .option('--run <id>', 'Run id (default: latest)')
    .action((opts: { run?: string }) => {
      const { agenticRoot } = resolveRoots(program.opts<{ cwd?: string }>().cwd);
      loadConfig(agenticRoot);
      const rpath = resolveRun(agenticRoot, opts.run);
      ensureSpecPrereqs(rpath);
      const runId = path.basename(rpath);
      const tmpl = readTemplateFile('spec.template.md');
      const created = new Date().toISOString();
      const text = applyPlaceholders(tmpl, {
        RUN_ID: runId,
        SOURCE_TYPE: sourceLabel(rpath),
        CREATED_AT: created,
        SUMMARY_PLACEHOLDER: readIntakeSummary(rpath),
      });
      fs.writeFileSync(path.join(rpath, 'spec.md'), text, 'utf8');
      console.error(`Wrote ${path.join(rpath, 'spec.md')}`);
      console.warn('Tip: iterate `spec.md` in Cursor before `agentic decompose`.');
    });

  program
    .command('decompose')
    .description('Generate `decomposition.md` placeholder from templates')
    .option('--run <id>', 'Run id (default: latest)')
    .action((opts: { run?: string }) => {
      const { agenticRoot } = resolveRoots(program.opts<{ cwd?: string }>().cwd);
      loadConfig(agenticRoot);
      const rpath = resolveRun(agenticRoot, opts.run);
      if (!fs.existsSync(path.join(rpath, 'spec.md')))
        die('Missing spec.md — run `agentic spec` first.');
      const runId = path.basename(rpath);
      const tmpl = readTemplateFile('decomposition.template.md');
      const text = applyPlaceholders(tmpl, {
        RUN_ID: runId,
        CREATED_AT: new Date().toISOString(),
      });
      fs.writeFileSync(path.join(rpath, 'decomposition.md'), text, 'utf8');
      console.error(`Wrote ${path.join(rpath, 'decomposition.md')}`);
      const cfg = loadConfig(agenticRoot);
      console.warn(
        `Approval checkpoint: workflow.approval.afterDecomposition="${cfg.workflow.approval.afterDecomposition}". ` +
          'Use `agentic approve …` before implementers.',
      );
    });

  program
    .command('approve')
    .description('Record a human gate decision into approvals.json')
    .requiredOption('--gate <gate>', 'afterSpec | afterDecomposition | beforePR')
    .requiredOption('--status <s>', 'approved | rejected | skipped | pending')
    .option('--run <id>', 'Run id (default: latest)')
    .option('--actor <name>', 'Who approved', process.env.USER ?? 'local')
    .option('--note <text>', 'Optional note')
    .action(
      (opts: { gate: string; status: string; run?: string; actor?: string; note?: string }) => {
        const { agenticRoot } = resolveRoots(program.opts<{ cwd?: string }>().cwd);
        loadConfig(agenticRoot);
        const rpath = resolveRun(agenticRoot, opts.run);
        const ap = approvalsPath(rpath);
        if (!fs.existsSync(ap)) die(`Missing ${ap}`);
        const gate = opts.gate as GateName;
        const allowedGates: GateName[] = ['afterSpec', 'afterDecomposition', 'beforePR'];
        if (!allowedGates.includes(gate)) {
          die(`Unknown gate "${opts.gate}". Use: ${allowedGates.join(', ')}`);
        }
        const statuses: GateStatus[] = ['approved', 'rejected', 'skipped', 'pending'];
        const status = opts.status as GateStatus;
        if (!statuses.includes(status)) die(`Unknown status "${opts.status}"`);
        let rec = readApprovals(ap);
        rec = recordGateDecision(rec, gate, status, {
          actor: opts.actor ?? 'local',
          note: opts.note,
        });
        writeApprovals(ap, rec);
        console.error(`Recorded ${gate}=${status}`);
        console.error(ap);
      },
    );

  program
    .command('status')
    .description('Show latest (or chosen) run and approval gate snapshot')
    .option('--run <id>', 'Run id')
    .action((opts: { run?: string }) => {
      const { agenticRoot } = resolveRoots(program.opts<{ cwd?: string }>().cwd);
      if (!fs.existsSync(agenticRoot)) die(`Missing ${agenticRoot} — run \`agentic init\`.`);
      loadConfig(agenticRoot);
      const ids = listRunIds(agenticRoot);
      if (!ids.length) {
        console.log('No runs yet.');
        return;
      }
      const runId = opts.run ?? ids[0];
      const rpath = runDir(agenticRoot, runId);
      if (!fs.existsSync(rpath)) die(`Unknown run "${runId}"`);
      console.log(JSON.stringify({ runId, path: rpath }, null, 2));
      const ap = approvalsPath(rpath);
      if (fs.existsSync(ap)) {
        console.log(JSON.stringify(readApprovals(ap).gates, null, 2));
      } else {
        console.warn('approvals.json missing');
      }
    });

  program
    .command('open-artifacts')
    .alias('artifacts')
    .description('Print artifact paths for a run (open in Cursor manually)')
    .option('--run <id>', 'Run id (default: latest)')
    .action((opts: { run?: string }) => {
      const { agenticRoot } = resolveRoots(program.opts<{ cwd?: string }>().cwd);
      loadConfig(agenticRoot);
      const rpath = resolveRun(agenticRoot, opts.run);
      const files = ['intake.json', 'issue.md', 'spec.md', 'decomposition.md', 'approvals.json'];
      for (const f of files) {
        const fp = path.join(rpath, f);
        console.log(fs.existsSync(fp) ? fp : `${fp} (missing)`);
      }
    });

  const stubPhase = (name: string, phase: number) => () => {
    console.error(`${name} is not implemented yet (see Phase ${phase} in docs/plan.md).`);
    process.exitCode = 3;
  };

  program.command('implement').description('Run parallel implementers (stub)').action(stubPhase('implement', 2));
  program.command('verify').description('Run verifier pipeline (stub)').action(stubPhase('verify', 3));
  program.command('finalize').description('Finalize winning candidate (stub)').action(stubPhase('finalize', 6));
  program
    .command('pr')
    .description('PR subcommands (stub)')
    .action(() => {
      console.error('Use `agentic pr create` / `agentic pr monitor` in later phases.');
      process.exitCode = 3;
    });
  program
    .command('cleanup')
    .description('Cleanup worktrees/artifacts (stub)')
    .action(stubPhase('cleanup', 2));

  program.parse(argv);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('main')) {
  cliMain();
}
