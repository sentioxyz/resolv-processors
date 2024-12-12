import { GLOBAL_CONFIG } from "@sentio/runtime";
import { BigDecimal } from "@sentio/sdk";
import { isNullAddress } from "@sentio/sdk/eth";
import { AccountSnapshot } from "./schema/store.js";
import {
  CurveStableSwapNGContext,
  CurveStableSwapNGProcessor,
} from "./types/eth/curvestableswapng.js";
import {
  configs,
  DAILY_POINTS,
  getConfig,
  getPoolInfo,
  getTokenPrice,
  MILLISECOND_PER_DAY,
  NETWORK,
} from "./config.js";
import { getCurveGaugeContractOnContext } from "./types/eth/curvegauge.js";
import { getBoostMultiplier, getBoosts } from "./boosts.js";

GLOBAL_CONFIG.execution = {
  sequential: true,
};

configs.forEach((config) =>
  CurveStableSwapNGProcessor.bind({
    address: config.address,
    network: NETWORK,
  })
    .onEventAddLiquidity(async (event, ctx) => {
      const accountAddress = event.args.provider;
      const accounts = [accountAddress].filter(
        (address) => !isNullAddress(address)
      );
      const newSnapshots = await Promise.all(
        accounts.map((account) =>
          processAccount(ctx, account, undefined, event.name)
        )
      );
      await ctx.store.upsert(newSnapshots);
    })
    .onEventRemoveLiquidity(async (event, ctx) => {
      const accountAddress = event.args.provider;
      const accounts = [accountAddress].filter(
        (address) => !isNullAddress(address)
      );
      const newSnapshots = await Promise.all(
        accounts.map((account) =>
          processAccount(ctx, account, undefined, event.name)
        )
      );
      await ctx.store.upsert(newSnapshots);
    })
    .onEventTransfer(async (event, ctx) => {
      const accounts = [event.args.sender, event.args.receiver].filter(
        (address) => !isNullAddress(address)
      );

      const newSnapshots = await Promise.all(
        accounts.map((account) =>
          processAccount(ctx, account, undefined, event.name)
        )
      );
      await ctx.store.upsert(newSnapshots);
    })
    // .onEventTokenExchange(async (event, ctx) => {
    //   const accountSnapshots = await ctx.store.list(AccountSnapshot, [
    //     {
    //       field: "poolAddress",
    //       op: "=",
    //       value: ctx.address,
    //     },
    //   ]);
    //   const newSnapshots = await Promise.all(
    //     accountSnapshots.map((snapshot) =>
    //       processAccount(
    //         ctx,
    //         snapshot.id.toString().split(".")[1],
    //         snapshot,
    //         "TimeInterval"
    //       )
    //     )
    //   );
    //   await ctx.store.upsert(newSnapshots);
    // })
    .onTimeInterval(
      async (_, ctx) => {
        const accountSnapshots = await ctx.store.list(AccountSnapshot, [
          {
            field: "poolAddress",
            op: "=",
            value: ctx.address,
          },
        ]);
        const newSnapshots = await Promise.all(
          accountSnapshots.map((snapshot) =>
            processAccount(
              ctx,
              snapshot.id.toString().split(".")[1],
              snapshot,
              "TimeInterval"
            )
          )
        );
        await ctx.store.upsert(newSnapshots);
      },
      60,
      60
    )
);

async function processAccount(
  ctx: CurveStableSwapNGContext,
  account: string,
  snapshot: AccountSnapshot | undefined,
  triggerEvent: string
) {
  const id = ctx.address + "." + account;
  if (!snapshot) {
    snapshot = await ctx.store.get(AccountSnapshot, id);
  }
  const points = snapshot ? await calcPoints(ctx, snapshot) : new BigDecimal(0);

  const newSnapshot = await getAccountSnapshot(ctx, account);
  const boosts = await getBoosts(ctx, account);

  ctx.eventLogger.emit("point_update", {
    poolAddress: ctx.address,
    account,
    triggerEvent,
    points,
    snapshotTimestampMilli: snapshot?.timestampMilli.toString() ?? "0",
    snapshotAmount0: snapshot?.amount0.toString() ?? "0",
    snapshotAmount1: snapshot?.amount1.toString() ?? "0",
    snapshotUsdValue: snapshot?.usdValue.toString() ?? "0",
    newTimestampMilli: newSnapshot.timestampMilli.toString(),
    newAmount0: newSnapshot.amount0.toString(),
    newAmount1: newSnapshot.amount1.toString(),
    newUsdValue: newSnapshot.usdValue.toString(),
    boosts: JSON.stringify(boosts),
  });
  return newSnapshot;
}

async function calcPoints(
  ctx: CurveStableSwapNGContext,
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

  const multiplier = await getBoostMultiplier(ctx, snapshot.id.split(".")[1]);
  const points = snapshot.usdValue
    .multipliedBy(DAILY_POINTS)
    .multipliedBy(deltaDay)
    .multipliedBy(multiplier);
  return points;
}

async function getAccountSnapshot(
  ctx: CurveStableSwapNGContext,
  account: string
) {
  const config = getConfig(ctx.address);
  if (!config) {
    throw new Error("config not found");
  }
  let lpBalance = await ctx.contract.balanceOf(account);
  if (config.gauge && ctx.blockNumber > config.gaugeStartBlock!) {
    const gaugeContract = getCurveGaugeContractOnContext(ctx, config.gauge);
    lpBalance += await gaugeContract.balanceOf(account);
  }
  const lpSupply = await ctx.contract.totalSupply();
  const share =
    lpSupply > 0
      ? BigInt(lpBalance).asBigDecimal().div(BigInt(lpSupply).asBigDecimal())
      : new BigDecimal(0);

  const poolInfo = getPoolInfo(ctx.address)!;

  const [token0Total, token1Total] = await config.getBalances(ctx);
  const [amount0, amount1] = [
    BigInt(token0Total.asBigDecimal().multipliedBy(share).toFixed(0)).scaleDown(
      poolInfo.token0Decimals
    ),
    BigInt(token1Total.asBigDecimal().multipliedBy(share).toFixed(0)).scaleDown(
      poolInfo.token1Decimals
    ),
  ];
  const token0Price = await getTokenPrice(ctx, poolInfo.token0);
  const token1Price = await getTokenPrice(ctx, poolInfo.token1);
  const usdValue = amount0
    .multipliedBy(token0Price!)
    .plus(amount1.multipliedBy(token1Price!));

  return new AccountSnapshot({
    id: ctx.address + "." + account,
    poolAddress: ctx.address,
    timestampMilli: BigInt(ctx.timestamp.getTime()),
    amount0,
    amount1,
    usdValue,
  });
}
