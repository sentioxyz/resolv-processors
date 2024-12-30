import { GLOBAL_CONFIG } from "@sentio/runtime";
import { EthContext, isNullAddress } from "@sentio/sdk/eth";
import { EVaultContext, EVaultProcessor } from "./types/eth/evault.js";
import { AccountSnapshot } from "./schema/store.js";
import {
  DAILY_POINTS,
  MILLISECOND_PER_DAY,
  NETWROK,
  TOKEN_DECIMALS,
  VAULT,
} from "./config.js";
import { BigDecimal } from "@sentio/sdk";
import { getBoostMultiplier, getBoosts, updateBoosts } from "./boosts.js";

GLOBAL_CONFIG.execution = {
  sequential: true,
};

EVaultProcessor.bind({
  address: VAULT,
  network: NETWROK,
  startBlock: 21087960,
})
  .onEventDeposit(async (event, ctx) => {
    const newSnapshot = await processAccount(
      ctx,
      event.args.owner,
      undefined,
      event.name
    );
    await ctx.store.upsert(newSnapshot);
  })
  .onEventBorrow(async (event, ctx) => {
    const newSnapshot = await processAccount(
      ctx,
      event.args.account,
      undefined,
      event.name
    );
    await ctx.store.upsert(newSnapshot);
  })
  .onEventLiquidate(async (event, ctx) => {
    const newSnapshot = await processAccount(
      ctx,
      event.args.violator,
      undefined,
      event.name
    );
    await ctx.store.upsert(newSnapshot);
  })
  .onEventRepay(async (event, ctx) => {
    const newSnapshot = await processAccount(
      ctx,
      event.args.account,
      undefined,
      event.name
    );
    await ctx.store.upsert(newSnapshot);
  })
  .onEventTransfer(async (event, ctx) => {
    const newSnapshots = await Promise.all(
      [event.args.from, event.args.to]
        .filter((account) => !isNullAddress(account))
        .map((account) => processAccount(ctx, account, undefined, event.name))
    );
    await ctx.store.upsert(newSnapshots);
  })
  .onTimeInterval(
    async (_, ctx) => {
      const snapshots = await ctx.store.list(AccountSnapshot);
      const newSnapshots = await Promise.all(
        snapshots.map((snapshot) =>
          processAccount(ctx, snapshot.id.toString(), snapshot, "TimeInterval")
        )
      );
      await ctx.store.upsert(newSnapshots);
    },
    4 * 60,
    4 * 60
  )
  .onTimeInterval((_, ctx) => updateBoosts(ctx), 60 * 24, 60 * 24);

async function processAccount(
  ctx: EVaultContext,
  account: string,
  snapshot: AccountSnapshot | undefined,
  triggerEvent: string
) {
  if (!snapshot) {
    snapshot = await ctx.store.get(AccountSnapshot, account);
  }
  const points = snapshot ? await calcPoints(ctx, snapshot) : new BigDecimal(0);
  const newSnapshot = await getLatestSnapshot(ctx, account);

  const boosts = await getBoosts(account);
  ctx.eventLogger.emit("point_update", {
    account,
    points,
    snapshotTimestampMilli: snapshot?.timestampMilli ?? 0n,
    snapshotSupplyBalance: snapshot?.supplyBalance.toString() ?? "0",
    newTimestampMilli: newSnapshot.timestampMilli,
    newSupplyBalance: newSnapshot.supplyBalance.toString(),
    boosts: JSON.stringify(boosts),
    triggerEvent,
  });

  return newSnapshot;
}

async function getLatestSnapshot(
  ctx: EVaultContext,
  account: string
): Promise<AccountSnapshot> {
  const userSupplyShares = await ctx.contract.balanceOf(account);
  const userSupplyAssets = await ctx.contract.convertToAssets(userSupplyShares);
  return new AccountSnapshot({
    id: account,
    timestampMilli: BigInt(ctx.timestamp.getTime()),
    supplyBalance: userSupplyAssets.scaleDown(TOKEN_DECIMALS),
  });
}

async function calcPoints(
  ctx: EthContext,
  snapshot: AccountSnapshot
): Promise<BigDecimal> {
  const nowMilli = ctx.timestamp.getTime();
  if (nowMilli < Number(snapshot.timestampMilli)) {
    console.error(
      "unexpected account snapshot from the future",
      nowMilli,
      snapshot
    );
    return new BigDecimal(0);
  } else if (nowMilli == Number(snapshot.timestampMilli)) {
    // account affected for multiple times in the block
    return new BigDecimal(0);
  }
  const deltaDay =
    (nowMilli - Number(snapshot.timestampMilli)) / MILLISECOND_PER_DAY;

  const multiplier = await getBoostMultiplier(ctx, snapshot.id.toString());
  const points = snapshot.supplyBalance
    .multipliedBy(DAILY_POINTS)
    .multipliedBy(deltaDay)
    .multipliedBy(multiplier);
  return points;
}
