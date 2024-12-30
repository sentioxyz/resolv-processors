import { GLOBAL_CONFIG } from "@sentio/runtime";
import { EthContext, isNullAddress } from "@sentio/sdk/eth";
import { BigDecimal } from "@sentio/sdk";
import {
  DAILY_POINTS,
  MILLISECOND_PER_DAY,
  NETWORK,
  POOL_ADDRESS,
  USDC_DECIMALS,
  USR_DECIMALS,
} from "./config.js";
import { AccountSnapshot } from "./schema/store.js";
import { PoolContext, PoolProcessor } from "./types/eth/pool.js";
import { getBoostMultiplier, getBoosts } from "./boosts.js";

GLOBAL_CONFIG.execution = {
  sequential: true,
};

PoolProcessor.bind({
  network: NETWORK,
  address: POOL_ADDRESS,
})
  .onEventTransfer(async (event, ctx) => {
    const accounts = [event.args.from, event.args.to].filter(
      (account) => !isNullAddress(account)
    );
    const snapshots = await ctx.store.list(AccountSnapshot);
    const newSnapshots = await Promise.all([
      ...snapshots
        .filter((snapshot) => !accounts.includes(snapshot.id.toString()))
        .map((snapshot) =>
          process(ctx, snapshot.id.toString(), snapshot, event.name)
        ),
      ...accounts.map((account) =>
        process(ctx, account, undefined, event.name)
      ),
    ]);
    await ctx.store.upsert(newSnapshots);
  })
  .onEventSwap(async (event, ctx) => {
    const snapshots = await ctx.store.list(AccountSnapshot);
    const newSnapshots = await Promise.all(
      snapshots.map((snapshot) =>
        process(ctx, snapshot.id.toString(), snapshot, event.name)
      )
    );
    await ctx.store.upsert(newSnapshots);
  })
  .onTimeInterval(
    async (_, ctx) => {
      const positionSnapshots = await ctx.store.list(AccountSnapshot);
      const newSnapshots = await Promise.all(
        positionSnapshots.map((snapshot) =>
          process(ctx, snapshot.id.toString(), snapshot, "TimeInterval")
        )
      );
      await ctx.store.upsert(newSnapshots.filter((s) => s != undefined));
    },
    4 * 60,
    24 * 60
  );

async function process(
  ctx: PoolContext,
  account: string,
  snapshot: AccountSnapshot | undefined,
  triggerEvent: string
) {
  const snapshotTimestampMilli = snapshot?.timestampMilli ?? 0n;
  const snapshotUsrBalance = snapshot?.usrBalance ?? new BigDecimal(0);
  const snapshotUsdcBalance = snapshot?.usdcBalance ?? new BigDecimal(0);
  const snapshotUsdValue = snapshot?.usdValue ?? new BigDecimal(0);

  const points = snapshot
    ? await calcPoints(ctx, snapshot)
    : [new BigDecimal(0), new BigDecimal(0), new BigDecimal(0)];
  const [lpBalance, totalSupply, reserves] = await Promise.all([
    ctx.contract.balanceOf(account),
    ctx.contract.totalSupply(),
    ctx.contract.getReserves(),
  ]);
  const { _reserve0: reserveUsr, _reserve1: reserveUsdc } = reserves;
  const newUsrBalance = (reserveUsr * lpBalance)
    .scaleDown(USR_DECIMALS)
    .div(totalSupply.asBigDecimal());
  const newUsdcBalance = (reserveUsdc * lpBalance)
    .scaleDown(USDC_DECIMALS)
    .div(totalSupply.asBigDecimal());
  const newUsdValue = newUsrBalance.plus(newUsdcBalance);

  const newSnapshot = new AccountSnapshot({
    id: account,
    timestampMilli: BigInt(ctx.timestamp.getTime()),
    usrBalance: newUsrBalance,
    usdcBalance: newUsdcBalance,
    usdValue: newUsdValue,
  });
  const boosts = await getBoosts(account);
  ctx.eventLogger.emit("point_update", {
    account,
    points,
    snapshotTimestampMilli,
    snapshotUsrBalance,
    snapshotUsdcBalance,
    snapshotUsdValue,
    newTimestampMilli: newSnapshot.timestampMilli,
    newUsrBalance,
    newUsdcBalance,
    newUsdValue,
    boosts: JSON.stringify(boosts),
    triggerEvent,
  });
  return newSnapshot;
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
  const points = snapshot.usdValue
    .multipliedBy(DAILY_POINTS)
    .multipliedBy(deltaDay)
    .multipliedBy(multiplier);
  return points;
}
