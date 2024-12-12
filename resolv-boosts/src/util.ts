import { EthContext } from "@sentio/sdk/eth";
import { BoostSnapshot } from "./schema/store.js";

export async function updateBoost(
  ctx: EthContext,
  account: string,
  field: "blueprint" | "dinero" | "hyperliquid",
  value: boolean
) {
  const snapshot =
    (await ctx.store.get(BoostSnapshot, account)) ??
    new BoostSnapshot({
      id: account,
      dinero: false,
      blueprint: false,
    });
  if (snapshot[field] != value) {
    snapshot[field] = value;
    ctx.eventLogger.emit("boosts", {
      account,
      dinero: snapshot.dinero,
      blueprint: snapshot.blueprint,
    });
    return snapshot;
  }
  return undefined;
}

export function filterSnapshots(snapshots: (BoostSnapshot | undefined)[]) {
  return snapshots.filter((s) => s !== undefined) as BoostSnapshot[];
}
