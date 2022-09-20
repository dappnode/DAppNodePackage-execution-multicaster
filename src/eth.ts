import { ExecutionClientEngine, ExecutionSyncStatus } from "./types";
import axios, { AxiosError } from "axios";
import jwt from "jsonwebtoken";

const SYNCING_DELAY_TRESHOLD = parseInt(
  process.env.SYNCING_DELAY_TRESHOLD || "60"
);

async function callAuthEngine(
  ec: ExecutionClientEngine,
  method: string,
  params: any[]
) {
  return await axios.post(
    ec.url,
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
          jwt.sign({ iat: Math.floor(Date.now() / 1000) }, ec.jwtsecret),
      },
    }
  );
}

async function refreshInvidualStatus(ec: ExecutionClientEngine): Promise<void> {
  try {
    const syncingResponse = await callAuthEngine(ec, "eth_syncing", []);

    if (syncingResponse.data.result === false) {
      ec.status = ExecutionSyncStatus.Synced;
      const numberResponse = await callAuthEngine(ec, "eth_blockNumber", []);
      ec.latestBlockNumber = parseInt(numberResponse.data.result, 16);
    } else {
      ec.status = ExecutionSyncStatus.Syncing;
      ec.latestBlockNumber = parseInt(
        syncingResponse.data.result.currentBlock,
        16
      );
    }
  } catch (e) {
    ec.status = ExecutionSyncStatus.Unavailable;
    ec.latestBlockNumber = 0;
    if (axios.isAxiosError(e))
      console.warn(
        `Error during status refresh of ${ec.name}: ${(<AxiosError>e).message}`
      );
    else console.warn(e);
  }
}

async function refreshStatus(ecs: ExecutionClientEngine[]) {
  await Promise.all(ecs.map((ec) => refreshInvidualStatus(ec)));
  const syncedECs = ecs.filter(
    (ec) => ec.status === ExecutionSyncStatus.Synced
  );
  /*
    Code below would degrade status from synced to syncing if a block EC is on is too low.
    I don't know is even possible post-merge for eth_syncing to return false when actually syncing.
    But for abundance of caution I left this here, it won't hurt.
    */
  const maxBlockNumber = Math.max(
    ...syncedECs.map((ec) => ec.latestBlockNumber)
  );
  for (const ec of syncedECs) {
    if (ec.latestBlockNumber + SYNCING_DELAY_TRESHOLD < maxBlockNumber)
      ec.status = ExecutionSyncStatus.Syncing;
  }
}

export { refreshStatus };
