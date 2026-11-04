export type Store = {
  table: string;
  listApplied: () => Promise<number[] | null>;
  migrate: (folder: string) => Promise<void>;
  verify?: () => Promise<void>;
  close: () => Promise<void>;
};

export type OpenStore = (options: { forMigrate: boolean }) => Promise<Store>;

export type RunOptions = {
  folder?: string;
  out?: { write: (text: string) => unknown };
};

export function runMigrate(
  openStore: OpenStore,
  options?: RunOptions,
): Promise<void>;
export function runStatus(
  openStore: OpenStore,
  options?: RunOptions,
): Promise<void>;
export function exitOnError(task: Promise<void>): Promise<void>;
export function describeMigrateFailure(error: unknown): string;
