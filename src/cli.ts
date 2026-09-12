#!/usr/bin/env node
/**
 * Delphi CLI — ask, resolve, leaderboard, list, show.
 *
 *   delphi ask "Will X happen?" --type binary --deadline 2027-01-01 [--demo|--live]
 *   delphi resolve <id> <yes|no>
 *   delphi leaderboard
 *   delphi list
 *   delphi show <id>
 */
import type { DatabaseSync } from "node:sqlite";
import { getDb, getQuestion, listQuestions, getForecasts, getOpinions, councilorTrackRecords, providerTrackRecords } from "./db.js";
import { runPipeline } from "./pipeline.js";
import { resolveForecast } from "./resolve.js";
import { seedIfEmpty } from "./seed.js";
import { COUNCILORS, councilorById } from "./council.js";
import { DELPHI, VERSION, defaultProviders, resolveProviders, listProviderModels, writeModelChoice } from "./config.js";
import type { PipelineEvent, QuestionType } from "./types.js";

function usage(): never {
  console.log(`Delphi v${VERSION} — council-based prediction engine

Usage:
  delphi ask "<question>" --type <binary|timing|numeric|categorical> --deadline <date>
       [--criteria "..."] [--context "..."] [--council 3|4|5] [--demo|--live]
       [--rerun <id>]   (re-run an existing open question; appends a forecast run)
  delphi resolve <id> <yes|no>            (non-binary: correct|incorrect)
  delphi leaderboard
  delphi list
  delphi show <id>
  delphi providers                    (provider status + live model catalogs)
  delphi models <provider>            (list models pulled from the provider's API)
  delphi set-model <provider> <model> (choose a provider's model)

Env: DELPHI_DEMO (default true), DELPHI_DB, DELPHI_PORT,
     LMSTUDIO_URL, MINIMAX_API_KEY, XAI_API_KEY, OPENAI_API_KEY,
     SEARXNG_URL, TAVILY_API_KEY, BRAVE_API_KEY`);
  process.exit(1);
}

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

const flag = (args: Args, name: string): string | undefined => {
  const v = args.flags[name];
  return typeof v === "string" ? v : undefined;
};

async function cmdAsk(db: DatabaseSync, args: Args): Promise<void> {
  const rerunPrefix = flag(args, "rerun");
  let rerunId: string | undefined;
  if (rerunPrefix) {
    const match = listQuestions(db).find((q) => q.id.startsWith(rerunPrefix));
    if (!match) {
      console.error(`No question found with id prefix "${rerunPrefix}".`);
      process.exit(1);
    }
    rerunId = match.id;
  }
  const question = args._[1] || "";
  if (!question && !rerunId) usage();
  const type = (flag(args, "type") || "binary") as QuestionType;
  const deadline = flag(args, "deadline") || "";
  const demoMode = args.flags["live"] ? false : args.flags["demo"] ? true : DELPHI.demoDefault;
  const councilSize = Number(flag(args, "council") || 4);

  console.log(`\n🔮 Convening the council (${demoMode ? "demo mode" : "live mode"})…\n`);
  const forecast = await runPipeline(
    {
      question,
      questionType: type,
      deadline,
      resolutionCriteria: flag(args, "criteria") || "",
      context: flag(args, "context") || "",
      demoMode,
      councilSize,
      existingQuestionId: rerunId,
    },
    {
      db,
      emit: (e: PipelineEvent) => {
        if (e.type === "phase") console.log(`  … ${e.phase}`);
        else if (e.type === "opinion") {
          const o = e.opinion;
          console.log(
            `  [${o.round === 1 ? "R1" : "R2"}] ${o.councilorName} (${o.providerName}): ${o.probability}% — ${o.confidence}`,
          );
        } else if (e.type === "research" && e.results.length) {
          console.log(`  🔎 "${e.query}" → ${e.results.length} results`);
        }
      },
    },
  );

  console.log(`\n━━━ Delphi forecast ━━━`);
  console.log(`Question: ${forecast.question}`);
  console.log(`Aggregate: ${forecast.probability}%  (confidence ${forecast.confidence}, range ${forecast.confidenceRange[0]}–${forecast.confidenceRange[1]})`);
  console.log(`Central answer: ${forecast.answer}`);
  console.log(`\nThesis: ${forecast.readout.thesis}`);
  console.log(`\nDrivers:\n  - ${forecast.readout.drivers.join("\n  - ")}`);
  console.log(`\nCounter-signals:\n  - ${forecast.readout.counterSignals.join("\n  - ")}`);
  console.log(`\nQuestion ID: ${forecast.questionId}`);
  console.log(`Resolve later with: delphi resolve ${forecast.questionId.slice(0, 8)} <yes|no>\n`);
}

function cmdResolve(db: DatabaseSync, args: Args): void {
  const idPrefix = args._[1];
  const outcome = args._[2];
  if (!idPrefix || !outcome) usage();
  const match = listQuestions(db).find((q) => q.id.startsWith(idPrefix));
  if (!match) {
    console.error(`No question found with id prefix "${idPrefix}".`);
    process.exit(1);
  }
  const result = resolveForecast(db, match.id, outcome);
  console.log(`\n✅ Resolved: ${match.question}`);
  console.log(`Outcome: ${result.outcome} (score ${result.score})\n`);
  console.log(`Councilor grades (round-2 probabilities):`);
  for (const g of result.grades) {
    let name = g.councilorId;
    try { name = councilorById(g.councilorId).name; } catch { /* keep id */ }
    console.log(
      `  ${name}: ${g.probability}% → Brier ${g.brier.toFixed(3)}, log score ${g.logScore.toFixed(3)}`,
    );
  }
  console.log();
}

function cmdLeaderboard(db: DatabaseSync): void {
  const records = councilorTrackRecords(db);
  console.log(`\n🏆 Delphi leaderboard (lower Brier = better)\n`);
  const rows = COUNCILORS.map((c) => {
    const r = records.get(c.id);
    return {
      name: c.name,
      n: r?.n || 0,
      brier: r ? r.sumSqErr / r.n : NaN,
      log: r ? r.sumLogScore / r.n : NaN,
    };
  }).sort((a, b) => (Number.isNaN(a.brier) ? 1 : Number.isNaN(b.brier) ? -1 : a.brier - b.brier));
  for (const r of rows) {
    const b = Number.isNaN(r.brier) ? "  —  " : r.brier.toFixed(3);
    const l = Number.isNaN(r.log) ? "  —  " : r.log.toFixed(3);
    console.log(`  ${r.name.padEnd(20)}  n=${String(r.n).padEnd(3)}  Brier ${b}  log ${l}`);
  }
  const precords = providerTrackRecords(db);
  if (precords.size) {
    console.log(`\nProviders:`);
    for (const [id, r] of [...precords.entries()].sort((a, b) => a[1].sumSqErr / a[1].n - b[1].sumSqErr / b[1].n)) {
      console.log(`  ${id.padEnd(12)}  n=${r.n}  Brier ${(r.sumSqErr / r.n).toFixed(3)}`);
    }
  }
  console.log();
}

function cmdList(db: DatabaseSync): void {
  const qs = listQuestions(db);
  if (!qs.length) {
    console.log("No questions yet. Ask one: delphi ask \"…\" --type binary --deadline 2027-01-01");
    return;
  }
  console.log();
  for (const q of qs) {
    const forecasts = getForecasts(db, q.id);
    const latest = forecasts[forecasts.length - 1];
    const status = q.status === "resolved" ? `✅ ${q.outcome}` : "⏳ open";
    console.log(
      `  ${q.id.slice(0, 8)}  [${q.question_type}] ${status}  ${latest ? `${Math.round(latest.probability)}%` : "—"}`,
    );
    console.log(`      ${q.question.slice(0, 100)}`);
  }
  console.log();
}

function cmdShow(db: DatabaseSync, args: Args): void {
  const idPrefix = args._[1];
  if (!idPrefix) usage();
  const q = listQuestions(db).find((x) => x.id.startsWith(idPrefix));
  if (!q) {
    console.error(`No question found with id prefix "${idPrefix}".`);
    process.exit(1);
  }
  const forecasts = getForecasts(db, q.id);
  console.log(`\n❓ ${q.question}`);
  console.log(`Type: ${q.question_type}  Deadline: ${q.deadline}  Status: ${q.status}`);
  if (q.resolution_criteria) console.log(`Resolution: ${q.resolution_criteria}`);
  console.log(`\nBelief over time:`);
  for (const f of forecasts) {
    console.log(`  run #${f.run_number} (${f.created_at.slice(0, 10)}): ${Math.round(f.probability)}% [${f.confidence}]`);
  }
  const latest = forecasts[forecasts.length - 1];
  if (latest) {
    const opinions = getOpinions(db, latest.id);
    const readout = JSON.parse(latest.readout_json || "{}");
    console.log(`\nThesis: ${readout.thesis || latest.summary}`);
    console.log(`\nCouncilor opinions (round 2):`);
    for (const o of opinions.filter((x) => x.round === 2)) {
      let name = o.councilor_id;
      try { name = councilorById(o.councilor_id).name; } catch { /* keep id */ }
      console.log(`\n  ${name} (${o.provider_id}): ${Math.round(o.probability)}% — ${o.confidence} [${o.status}]`);
      console.log(`    ${o.reasoning.slice(0, 300)}`);
    }
  }
  console.log();
}

async function cmdProviders(): Promise<void> {
  const providers = await resolveProviders(defaultProviders());
  for (const p of providers) {
    const state = !p.connected ? "offline" : p.model ? "live" : "no model selected";
    console.log(
      `${p.id} -- ${p.name} [${state}] model=${p.model || "(none)"} catalog=${p.availableModels.length} models`,
    );
  }
}

async function cmdModels(args: Args): Promise<void> {
  const id = (args._[1] || "").toLowerCase();
  if (!id) {
    console.error("Usage: delphi models <provider>");
    process.exit(1);
  }
  const providers = await resolveProviders(defaultProviders());
  const p = providers.find((x) => x.id === id);
  if (!p) {
    console.error(`Unknown provider: ${id}`);
    process.exit(1);
  }
  if (!p.availableModels.length) {
    console.error(`${p.name} is unreachable or exposes no models (connected=${p.connected}).`);
    process.exit(1);
  }
  for (const m of p.availableModels) console.log(m + (m === p.model ? "  (selected)" : ""));
}

async function cmdSetModel(args: Args): Promise<void> {
  const id = (args._[1] || "").toLowerCase();
  const model = String(args._[2] || "").trim();
  if (!id || !model) {
    console.error("Usage: delphi set-model <provider> <model>");
    process.exit(1);
  }
  const providers = await resolveProviders(defaultProviders());
  const p = providers.find((x) => x.id === id);
  if (!p) {
    console.error(`Unknown provider: ${id}`);
    process.exit(1);
  }
  if (p.availableModels.length > 0 && !p.availableModels.includes(model)) {
    console.error(`Unknown model "${model}" for ${p.name}. Run: delphi models ${id}`);
    process.exit(1);
  }
  writeModelChoice(id, model);
  console.log(`Set ${p.name} model -> ${model}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd) usage();
  const db = getDb();
  seedIfEmpty(db);
  switch (cmd) {
    case "ask": await cmdAsk(db, args); break;
    case "resolve": cmdResolve(db, args); break;
    case "leaderboard": cmdLeaderboard(db); break;
    case "list": cmdList(db); break;
    case "show": cmdShow(db, args); break;
    case "providers": await cmdProviders(); break;
    case "models": await cmdModels(args); break;
    case "set-model": await cmdSetModel(args); break;
    default: usage();
  }
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
