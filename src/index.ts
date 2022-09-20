import { ExecutionClientEngine, ExecutionSyncStatus } from "./types";
import ecJSON from "./executionClient.json";
import { refreshStatus } from "./eth";
import startServer from "./server";
import cron from "node-cron";

async function main() {
  const ecDefaults = {
    status: ExecutionSyncStatus.Unavailable,
    latestBlockNumber: 0,
  };
  const allExecutionClients: ExecutionClientEngine[] = ecJSON.map((x) => {
    return {
      ...ecDefaults,
      ...x,
      jwtsecret: Buffer.from(x.jwtsecret, "hex"),
    };
  });
  // env overrides
  const clientNames = allExecutionClients.map((ec) => ec.name);
  for (const clientName of clientNames) {
    try {
      const priorityOverride =
        process.env[`${clientName.toUpperCase()}_PRIORITY`];
      if (priorityOverride) {
        const ec = allExecutionClients.find(
          (ec) => ec.name === clientName
        ) as ExecutionClientEngine;
        ec.priority = parseInt(priorityOverride);
      }
    } catch {
      console.warn(
        `Could not parse ${clientName} priority environment override`
      );
    }
  }

  const executionClients = allExecutionClients.filter((ec) => ec.priority > 0);

  await refreshStatus(executionClients);
  console.log(executionClients);

  cron.schedule("* * * * *", async () => {
    try {
      await refreshStatus(executionClients);
    } catch (e) {
      console.log(e);
    }
  });

  startServer(executionClients);
}

main().catch(() => process.exit(1));
