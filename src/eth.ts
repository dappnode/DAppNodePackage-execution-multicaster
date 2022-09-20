import { ExecutionClientEngine, ExecutionSyncStatus } from "./types";
import axios, { AxiosError } from "axios";
import jwt from "jsonwebtoken";

const SYNCING_DELAY_TRESHOLD = parseInt(
  process.env.SYNCING_DELAY_TRESHOLD || "10"
);

async function callAuthEngine(
  executionClient: ExecutionClientEngine,
  method: string,
  params: any[]
) {
  return await axios.post(
    executionClient.url,
    {
      jsonrpc: "2.0",
      method: method,
      params: params,
      id: 1,
    },
    {
      timeout: 1000,
      headers: {
        Authorization:
          "Bearer " +
          jwt.sign(
            { iat: Math.floor(Date.now() / 1000) },
            executionClient.jwtsecret
          ),
      },
    }
  );
}

async function refreshInvidualStatus(
  executionClient: ExecutionClientEngine
): Promise<void> {
  try {
    const syncingResponse = await callAuthEngine(
      executionClient,
      "eth_syncing",
      []
    );

    if (syncingResponse.data.result === false) {
      executionClient.status = ExecutionSyncStatus.Synced;
      const numberResponse = await callAuthEngine(
        executionClient,
        "eth_blockNumber",
        []
      );
      executionClient.latestBlockNumber = parseInt(
        numberResponse.data.result,
        16
      );
    } else {
      executionClient.status = ExecutionSyncStatus.Syncing;
      executionClient.latestBlockNumber = parseInt(
        syncingResponse.data.result.currentBlock,
        16
      );
    }
  } catch (e) {
    executionClient.status = ExecutionSyncStatus.Unavailable;
    executionClient.latestBlockNumber = 0;
    if (axios.isAxiosError(e))
      console.warn(
        `Error during status refresh of ${executionClient.name}: ${
          (<AxiosError>e).message
        }`
      );
    else console.warn(e);
  }
}

async function refreshStatus(executionClients: ExecutionClientEngine[]) {
  await Promise.all(executionClients.map((ec) => refreshInvidualStatus(ec)));
  const syncedExecutionClients = executionClients.filter(
    (ec) => ec.status === ExecutionSyncStatus.Synced
  );
  /*
    Code below would degrade status from synced to syncing if a block EC is on is too low.
    I don't know is even possible post-merge for eth_syncing to return false when actually syncing.
    But for abundance of caution I left this here, it won't hurt.
    */
  const maxBlockNumber = Math.max(
    ...syncedExecutionClients.map((ec) => ec.latestBlockNumber)
  );
  for (const ec of syncedExecutionClients) {
    if (ec.latestBlockNumber + SYNCING_DELAY_TRESHOLD < maxBlockNumber)
      ec.status = ExecutionSyncStatus.Syncing;
  }
  console.log("Refreshed execution client status.");
}

export { refreshStatus };
