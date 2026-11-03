#!/usr/bin/env node
/**
 * Validator machine helper. `serve` runs the service, which the owner starts
 * and keeps running; the other commands are what the validator's roles and the
 * owner run against one project.
 */
import path from "node:path";

import { createCli, runCli } from "@studio/lib/cli.js";
import { A1Error, failA1 } from "@studio/tools/validate.js";
import { readValidationConfig } from "./validation/config.js";
import { readLayers } from "./validation/layers.js";
import { requestLeakReview } from "./validation/leak-review.js";
import {
  abandonReview,
  evaluate,
  extendBenchmark,
  finalizeSubmission,
  retireBenchmarkLayer,
  runSmoke,
} from "./validation/review.js";
import { startValidationService } from "./validation/server.js";
import {
  listSubmissions,
  readPublished,
  readSubmission,
  serviceSummary,
} from "./validation/store.js";

const program = createCli("validation", "Serve and review Contrejour validation submissions");

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
function fail(error: unknown): void {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        reason: error instanceof A1Error ? error.code : "validation_command_failed",
        message: (error as Error).message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

program
  .command("serve")
  .description("Run the validation service; keep it running while the task lasts")
  .requiredOption("--project <dir>", "validator project directory")
  .option("--port <port>", "port to listen on; defaults to validation.service.port")
  .action(async (options: { project: string; port?: string }) => {
    try {
      const port = Number(options.port ?? readValidationConfig(options.project).service.port);
      if (!Number.isInteger(port) || port < 0)
        failA1(
          "PORT_REQUIRED",
          "pass --port or set validation.service.port in the machine configuration",
        );
      const service = await startValidationService(options.project, { port });
      console.log(`contrejour listening on ${service.url}`);
      const stop = () => void service.close().then(() => process.exit(0));
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("status")
  .description("Service state, benchmark layers and submissions, or one submission in full")
  .requiredOption("--project <dir>")
  .option("--submission <id>")
  .action((options: { project: string; submission?: string }) => {
    try {
      const root = path.resolve(options.project);
      const config = readValidationConfig(root);
      if (options.submission)
        print({
          record: readSubmission(root, options.submission),
          published: readPublished(root, options.submission),
        });
      else
        print({
          service: serviceSummary(root, config),
          layers: readLayers(root),
          submissions: listSubmissions(root).map((record) => ({
            ...record,
            published: readPublished(root, record.submission_id),
          })),
        });
    } catch (error) {
      fail(error);
    }
  });

program
  .command("smoke")
  .description("Run the base layer's smoke subset against the adapter; nothing is counted")
  .requiredOption("--project <dir>")
  .requiredOption("--submission <id>")
  .action(async (options: { project: string; submission: string }) => {
    try {
      print(await runSmoke(options.project, options.submission));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("evaluate")
  .description("Run every active benchmark layer, or one; finalize counts the latest run of each")
  .requiredOption("--project <dir>")
  .requiredOption("--submission <id>")
  .option("--layer <id>", "base or inc-NNN; all active layers when omitted")
  .action(async (options: { project: string; submission: string; layer?: string }) => {
    try {
      print(await evaluate(options.project, options.submission, options.layer));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("extend")
  .description("Register a draft layer of tests derived from tests this review has run")
  .requiredOption("--project <dir>")
  .requiredOption("--submission <id>")
  .requiredOption("--draft <dir>", "draft directory inside the submission directory")
  .action((options: { project: string; submission: string; draft: string }) => {
    try {
      print(extendBenchmark(options.project, options.submission, options.draft));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("retire")
  .description("Stop counting a registered layer whose tests are wrong; it is never edited")
  .requiredOption("--project <dir>")
  .requiredOption("--submission <id>")
  .requiredOption("--layer <id>")
  .requiredOption("--reason <text>")
  .action((options: { project: string; submission: string; layer: string; reason: string }) => {
    try {
      print(
        retireBenchmarkLayer(options.project, options.submission, options.layer, options.reason),
      );
    } catch (error) {
      fail(error);
    }
  });

program
  .command("leak-review")
  .description("Snapshot feedback.md for the leak reviewer and record the request")
  .requiredOption("--project <dir>")
  .requiredOption("--submission <id>")
  .action((options: { project: string; submission: string }) => {
    try {
      print(requestLeakReview(options.project, options.submission));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("abandon")
  .description(
    "End a review our side cannot complete as failed, which does not count; the cause stays on this machine",
  )
  .requiredOption("--project <dir>")
  .requiredOption("--submission <id>")
  .requiredOption("--reason <text>", "what on our side stops the review")
  .action((options: { project: string; submission: string; reason: string }) => {
    try {
      const record = abandonReview(options.project, options.submission, options.reason);
      print({ submission_id: record.submission_id, status: record.status, reason: record.reason });
    } catch (error) {
      fail(error);
    }
  });

program
  .command("finalize")
  .description("Publish review.json, the counted tests and the leak-reviewed feedback.md")
  .requiredOption("--project <dir>")
  .requiredOption("--submission <id>")
  .action((options: { project: string; submission: string }) => {
    try {
      print(finalizeSubmission(options.project, options.submission));
    } catch (error) {
      fail(error);
    }
  });

runCli(program);
