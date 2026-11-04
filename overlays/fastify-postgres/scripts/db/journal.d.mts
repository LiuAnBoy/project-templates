export const MIGRATIONS_FOLDER: string;

export type JournalEntry = { idx: number; tag: string; when: number };

export function readJournal(folder?: string): Promise<JournalEntry[]>;
export function newestStamp(applied: number[] | null): number | null;
export function findPending(
  journal: JournalEntry[],
  applied: number[] | null,
): JournalEntry[];
export function findSkipped(
  journal: JournalEntry[],
  applied: number[] | null,
): JournalEntry[];
export function isAheadOfDisk(
  journal: JournalEntry[],
  applied: number[] | null,
): boolean;
