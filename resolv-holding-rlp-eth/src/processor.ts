import { GLOBAL_CONFIG } from "@sentio/runtime";
import { BigDecimal } from "@sentio/sdk";
import { EthContext, isNullAddress } from "@sentio/sdk/eth";
import { ERC20Processor } from "@sentio/sdk/eth/builtin";
import { ERC20Context } from "@sentio/sdk/eth/builtin/erc20";
import { updateBoosts, getBoostMultiplier, getBoosts } from "./boosts.js";
import {
  DAILY_POINTS,
  getTokenPrice,
  MILLISECOND_PER_DAY,
  NETWORK,
  TOKEN_DECIMALS,
  RLP,
} from "./config.js";
import { AccountSnapshot } from "./schema/store.js";

GLOBAL_CONFIG.execution = {
  sequential: true,
};

ERC20Processor.bind({
  address: RLP,
  network: NETWORK,
})
  .onEventTransfer(async (event, ctx) => {
    const accounts = [event.args.from, event.args.to].filter(
      (address) => !isNullAddress(address)
    );

    const newSnapshots = await Promise.all(
      accounts.map((account) =>
        processAccount(ctx, account, undefined, event.name)
      )
    );
    await ctx.store.upsert(newSnapshots);
  })
  .onTimeInterval(
    async (_, ctx) => {
      const accountSnapshots = await ctx.store.list(AccountSnapshot);
      const newSnapshots = await Promise.all(
        accountSnapshots.map((snapshot) =>
          processAccount(ctx, snapshot.id.toString(), snapshot, "TimeInterval")
        )
      );
      await ctx.store.upsert(newSnapshots);
    },
    60,
    60
  )
  .onTimeInterval((_, ctx) => updateBoosts(ctx), 60 * 24, 60 * 24);

async function processAccount(
  ctx: ERC20Context,
  account: string,
  snapshot: AccountSnapshot | undefined,
  triggerEvent: string
) {
  if (!snapshot) {
    snapshot = await ctx.store.get(AccountSnapshot, account);
  }
  const points = snapshot ? await calcPoints(ctx, snapshot) : new BigDecimal(0);

  const newSnapshot = await getAccountSnapshot(ctx, account);
  const boosts = await getBoosts(account);

  ctx.eventLogger.emit("point_update", {
    poolAddress: ctx.address,
    account,
    triggerEvent,
    points,
    snapshotTimestampMilli: snapshot?.timestampMilli.toString() ?? "0",
    snapshotBalance: snapshot?.balance.toString() ?? "0",
    snapshotUsdValue: snapshot?.usdValue.toString() ?? "0",
    newTimestampMilli: newSnapshot.timestampMilli.toString(),
    newBalance: newSnapshot.balance.toString(),
    newUsdValue: newSnapshot.usdValue.toString(),
    boosts: JSON.stringify(boosts),
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

  const multiplier = await getBoostMultiplier(ctx, snapshot.id);
  const points = snapshot.usdValue
    .multipliedBy(DAILY_POINTS)
    .multipliedBy(deltaDay)
    .multipliedBy(multiplier);
  return points;
}

async function getAccountSnapshot(ctx: ERC20Context, account: string) {
  const balance = (await ctx.contract.balanceOf(account)).scaleDown(
    TOKEN_DECIMALS
  );
  const price = await getTokenPrice(ctx, ctx.address);
  const usdValue = balance.multipliedBy(price!);

  return new AccountSnapshot({
    id: account,
    timestampMilli: BigInt(ctx.timestamp.getTime()),
    balance,
    usdValue,
  });
}
