export enum ExecutionSyncStatus {
  Unavailable,
  Syncing,
  Synced,
}

export type ExecutionClientEngine = {
  name: string;
  url: string;
  jwtsecret: Buffer;
  priority: number;
  status: ExecutionSyncStatus;
  latestBlockNumber: number;
};
