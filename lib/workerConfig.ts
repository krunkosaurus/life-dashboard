import type { WorkerCheckConfig, WorkerConfig, WorkerIdentity, WorkersConfig } from "./workerTypes";

// An SSH destination, as on the GPU tab. A leading dash would be read as an ssh option.
const DESTINATION = /^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*$/;
// Container and process names are written into the remote command line.
const REMOTE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

type Fields = Record<string, unknown>;

const fields = (value: unknown): Fields | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Fields : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const httpUrl = (value: unknown): string | null => typeof value === "string" && /^https?:\/\/\S+$/.test(value) ? value : null;

function parseIdentity(worker: Fields): WorkerIdentity | null {
  const hasToken = worker.nftTokenId !== undefined;
  if (hasToken === (worker.address !== undefined)) return null;
  if (hasToken) return typeof worker.nftTokenId === "string" && /^\d+$/.test(worker.nftTokenId) ? { nftTokenId: worker.nftTokenId } : null;
  if (typeof worker.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(worker.address)) return null;
  if (worker.network !== "fast" && worker.network !== "relaxed") return null;
  return { address: worker.address, network: worker.network };
}

function parseChecks(input: unknown): WorkerCheckConfig[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  const checks: WorkerCheckConfig[] = [];
  for (const value of input) {
    const check = fields(value);
    if (!check || typeof check.sshHost !== "string" || !DESTINATION.test(check.sshHost)) return null;
    const isContainer = check.container !== undefined;
    if (isContainer === (check.process !== undefined)) return null;
    const name = isContainer ? check.container : check.process;
    if (typeof name !== "string" || !REMOTE_NAME.test(name)) return null;
    const label = text(check.label) ?? name;
    checks.push(isContainer ? { sshHost: check.sshHost, container: name, label } : { sshHost: check.sshHost, process: name, label });
  }
  return checks;
}

// One unusable entry drops that worker, never the rest of the fleet.
export function parseWorkersConfig(input: unknown): WorkersConfig | null {
  const block = fields(input);
  const historyUrl = httpUrl(block?.historyUrl);
  const poolUrl = httpUrl(block?.poolUrl);
  if (!block || !historyUrl || !poolUrl || !Array.isArray(block.workers)) return null;
  const ids = new Set<string>();
  const workers = block.workers.flatMap((value): WorkerConfig[] => {
    const worker = fields(value);
    if (!worker || typeof worker.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(worker.id) || ids.has(worker.id)) return [];
    const identity = parseIdentity(worker);
    const checks = parseChecks(worker.checks);
    if (!identity || !checks) return [];
    ids.add(worker.id);
    const label = text(worker.label) ?? worker.id;
    return [{ id: worker.id, label, group: text(worker.group) ?? "Workers", account: text(worker.account) ?? label, identity, checks }];
  });
  return { historyUrl, poolUrl, workers };
}
