export interface SpaceAccount {
  id: string;
  provider: string;
  email: string;
  totalSpace: number;
  usedSpace: number;
  freeSpace: number;
  usedRatio: number;
  status: string;
}

export type AllocationStrategy =
  'round_robin' | 'weighted_round_robin' | 'least_used' | 'most_free' | 'manual';

const rrCursors = new Map<string, number>();
const swrrStates = new Map<string, Record<string, number>>();

export function withFreeSpace(account: {
  id: string;
  provider: string;
  email: string;
  totalSpace: number;
  usedSpace: number;
  status: string;
}): SpaceAccount {
  const total = Number(account.totalSpace) || 0;
  const used = Number(account.usedSpace) || 0;
  return {
    ...account,
    totalSpace: total,
    usedSpace: used,
    freeSpace: Math.max(0, total - used),
    usedRatio: total > 0 ? used / total : 1,
  };
}

export function selectRoundRobin(
  userId: string,
  accounts: SpaceAccount[],
  requiredBytes: number,
): SpaceAccount {
  const count = accounts.length;
  const start = (rrCursors.get(userId) || 0) % count;

  let chosenIndex = -1;
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count;
    if (accounts[index].freeSpace >= requiredBytes) {
      chosenIndex = index;
      break;
    }
  }

  if (chosenIndex === -1) {
    chosenIndex = start;
  }

  rrCursors.set(userId, (chosenIndex + 1) % count);
  return accounts[chosenIndex];
}

export function selectMostFree(accounts: SpaceAccount[]): SpaceAccount {
  return [...accounts].sort((a, b) => b.freeSpace - a.freeSpace)[0];
}

export function selectLeastUsed(accounts: SpaceAccount[], requiredBytes: number): SpaceAccount {
  const eligible = accounts.filter((a) => a.freeSpace >= requiredBytes);
  const pool = eligible.length ? eligible : accounts;
  return [...pool].sort((a, b) => a.usedRatio - b.usedRatio)[0];
}

export function selectWeightedRoundRobin(
  userId: string,
  accounts: SpaceAccount[],
  requiredBytes: number,
): SpaceAccount {
  const eligible = accounts.filter((account) => account.freeSpace >= requiredBytes);
  const pool = eligible.length ? eligible : accounts;
  const state = swrrStates.get(userId) || {};
  const totalWeight = pool.reduce(
    (sum, account) => sum + Math.max(1, Math.round(account.freeSpace / (1024 * 1024))),
    0,
  );
  let selected = pool[0];
  for (const account of pool) {
    const weight = Math.max(1, Math.round(account.freeSpace / (1024 * 1024)));
    state[account.id] = (state[account.id] || 0) + weight;
    if (state[account.id] > (state[selected.id] || 0)) selected = account;
  }
  state[selected.id] -= totalWeight;
  swrrStates.set(userId, state);
  return selected;
}

export function selectManual(
  accounts: SpaceAccount[],
  requiredBytes: number,
  manualOrder: string[],
): SpaceAccount {
  const rank = new Map(manualOrder.map((id, index) => [id, index]));
  const ordered = [...accounts].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  return ordered.find((account) => account.freeSpace >= requiredBytes) || ordered[0];
}

export function selectBestAccount(
  userId: string,
  accounts: SpaceAccount[],
  strategy: AllocationStrategy = 'round_robin',
  requiredBytes = 0,
  manualOrder: string[] = [],
): { selected: SpaceAccount; fallbackChain: SpaceAccount[] } {
  if (!accounts.length) {
    throw new Error('No active cloud account available');
  }

  let selected: SpaceAccount;
  switch (strategy) {
    case 'round_robin':
      selected = selectRoundRobin(userId, accounts, requiredBytes);
      break;
    case 'least_used':
      selected = selectLeastUsed(accounts, requiredBytes);
      break;
    case 'weighted_round_robin':
      selected = selectWeightedRoundRobin(userId, accounts, requiredBytes);
      break;
    case 'manual':
      selected = selectManual(accounts, requiredBytes, manualOrder);
      break;
    case 'most_free':
    default:
      selected = selectMostFree(accounts);
      break;
  }

  const fallbackChain = accounts
    .filter((acc) => acc.id !== selected.id)
    .sort((a, b) => b.freeSpace - a.freeSpace);

  return { selected, fallbackChain };
}
