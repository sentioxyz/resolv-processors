import { GLOBAL_CONFIG } from "@sentio/runtime";
import { BigDecimal } from "@sentio/sdk";
import { EthContext, isNullAddress } from "@sentio/sdk/eth";
import { Token } from "@uniswap/sdk-core";
import { Pool, Position } from "@uniswap/v3-sdk";
import { getBoostMultiplier, getBoosts } from "./boosts.js";
import {
  DAILY_POINTS,
  getTokenPrice,
  MILLISECOND_PER_HOUR,
  NETWORK,
  NONFUNGIBLE_POSITION_MANAGER_CONTRACT,
  POOL_ADDRESS,
  POOL_START_BLOCK,
  RLP,
  USR,
} from "./config.js";
import { getPoolArgs, updatePoolArgs } from "./pool_args.js";
import { PositionSnapshot } from "./schema/store.js";
import {
  getNonfungiblePositionManagerContractOnContext,
  NonfungiblePositionManagerProcessor,
} from "./types/eth/nonfungiblepositionmanager.js";
import { getCLPoolContractOnContext } from "./types/eth/clpool.js";

// represents response of NonfungiblePositionManager.positions(tokenId)
interface PositionInfo {
  token0: string;
  token1: string;
  // fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
}

GLOBAL_CONFIG.execution = {
  sequential: true,
};

NonfungiblePositionManagerProcessor.bind({
  network: NETWORK,
  address: NONFUNGIBLE_POSITION_MANAGER_CONTRACT,
  startBlock: POOL_START_BLOCK,
})
  .onEventIncreaseLiquidity(async (event, ctx) => {
    const tokenId = event.args.tokenId.toString();
    const positionSnapshot = await ctx.store.get(PositionSnapshot, tokenId);
    if (!positionSnapshot && !(await checkNFT(ctx, tokenId))) return;
    const newSnapshot = await processPosition(
      ctx,
      tokenId,
      positionSnapshot,
      event.name
    );
    if (newSnapshot) {
      await ctx.store.upsert(newSnapshot);
    }

    const poolArgs = await getPoolArgsFromChain(ctx, POOL_ADDRESS);
    await updatePoolArgs(ctx, POOL_ADDRESS, poolArgs);
  })
  .onEventDecreaseLiquidity(async (event, ctx) => {
    const tokenId = event.args.tokenId.toString();
    const positionSnapshot = await ctx.store.get(PositionSnapshot, tokenId);
    // specific NFT can be burned in the txn
    // then positions(tokenId) reverts and we will skip the event
    if (!positionSnapshot) return;

    const newSnapshot = await processPosition(
      ctx,
      tokenId,
      positionSnapshot,
      event.name
    );
    if (newSnapshot) {
      await ctx.store.upsert(newSnapshot);
    }

    const poolArgs = await getPoolArgsFromChain(ctx, POOL_ADDRESS);
    await updatePoolArgs(ctx, POOL_ADDRESS, poolArgs);
  })
  .onEventTransfer(async (event, ctx) => {
    const accounts = [event.args.from, event.args.to];
    if (accounts.some(isNullAddress)) return;

    const tokenId = event.args.tokenId.toString();
    const positionSnapshot = await ctx.store.get(PositionSnapshot, tokenId);
    if (!positionSnapshot) return;

    const newSnapshot = await processPosition(
      ctx,
      tokenId,
      positionSnapshot,
      event.name
    );
    if (newSnapshot) {
      await ctx.store.upsert(newSnapshot);
    }
  })
  .onTimeInterval(
    async (_, ctx) => {
      await updateAll(ctx, "TimeInterval");
    },
    4 * 60,
    24 * 60
  );

async function updateAll(ctx: EthContext, triggerEvent: string) {
  const positionSnapshots = await ctx.store.list(PositionSnapshot, []);
  const newSnapshots = await Promise.all(
    positionSnapshots.map((snapshot) =>
      processPosition(ctx, snapshot.id.toString(), snapshot, triggerEvent)
    )
  );
  await ctx.store.upsert(newSnapshots.filter((s) => s != undefined));
}

// Handles the position snapshot and point calculation
// If positionSnapshot is null, it means the position is created in the current txn
// If getLatestPositionSnapshot throws exception, it means the position is burned in the current txn
async function processPosition(
  ctx: EthContext,
  tokenId: string,
  positionSnapshot: PositionSnapshot | undefined,
  triggerEvent: string
) {
  const points = positionSnapshot
    ? await calcPoints(ctx, positionSnapshot)
    : new BigDecimal(0);

  const boosts = await getBoosts(positionSnapshot?.owner ?? "noone");

  try {
    // the position is not burned
    const latestPositionSnapshot = await getLatestPositionSnapshot(
      ctx,
      tokenId
    );

    const snapshotOwner = positionSnapshot?.owner ?? "noone";
    const snapshotTimestampMilli = positionSnapshot?.timestampMilli ?? 0;
    const snapshotUsrBalance = positionSnapshot?.usrBalance ?? "0";
    const snapshotRlpBalance = positionSnapshot?.rlpBalance ?? "0";
    const snapshotUsdValue = positionSnapshot?.usdValue ?? "0";
    const {
      owner: newOwner,
      timestampMilli: newTimestampMilli,
      usrBalance: newUsrBalance,
      rlpBalance: newRlpBalance,
      usdValue: newUsdValue,
    } = latestPositionSnapshot;

    ctx.eventLogger.emit("point_update", {
      account: positionSnapshot?.owner ?? latestPositionSnapshot.owner,
      tokenId,
      points,
      triggerEvent,
      snapshotOwner,
      snapshotTimestampMilli,
      snapshotUsrBalance: snapshotUsrBalance.toString(),
      snapshotRlpBalance: snapshotRlpBalance.toString(),
      snapshotUsdValue: snapshotUsdValue.toString(),
      newOwner,
      newTimestampMilli,
      newUsrBalance: newUsrBalance.toString(),
      newRlpBalance: newRlpBalance.toString(),
      newUsdValue: newUsdValue.toString(),
      boosts: JSON.stringify(boosts),
    });
    return latestPositionSnapshot;
  } catch (e) {
    if (e.message.includes("ID")) {
      // the position is burned
      await ctx.store.delete(PositionSnapshot, tokenId);

      // console.log(positionSnapshot)
      // since the txn burns the position, it is safe to assume positionSnapshot is not null
      const {
        owner: snapshotOwner,
        timestampMilli: snapshotTimestampMilli,
        usrBalance: snapshotUsrBalance,
        rlpBalance: snapshotRlpBalance,
        usdValue: snapshotUsdValue,
      } = positionSnapshot!;

      ctx.eventLogger.emit("point_update", {
        account: snapshotOwner,
        tokenId,
        points,
        triggerEvent,
        snapshotOwner,
        snapshotTimestampMilli,
        snapshotUsrBalance: snapshotUsrBalance.toString(),
        snapshotRlpBalance: snapshotRlpBalance.toString(),
        snapshotUsdValue: snapshotUsdValue.toString(),
        newOwner: "noone",
        newTimestampMilli: ctx.timestamp.getTime(),
        newUsrBalance: "0",
        newRlpBalance: "0",
        newUsdValue: "0",
        boosts: JSON.stringify(boosts),
      });
    } else {
      throw e;
    }
  }
  return;
}

async function calcPoints(
  ctx: EthContext,
  snapshot: PositionSnapshot
): Promise<BigDecimal> {
  const nowMilli = ctx.timestamp.getTime();
  const snapshotMilli = Number(snapshot.timestampMilli);
  if (nowMilli < snapshotMilli) {
    console.error(
      "unexpected account snapshot from the future",
      nowMilli,
      snapshot
    );
    return new BigDecimal(0);
  } else if (nowMilli == snapshotMilli) {
    // account affected for multiple times in the block
    return new BigDecimal(0);
  }
  const deltaDay = (nowMilli - snapshotMilli) / MILLISECOND_PER_HOUR;

  const multiplier = await getBoostMultiplier(
    ctx,
    snapshot.owner.toLowerCase()
  );
  const points = snapshot.usdValue
    .multipliedBy(DAILY_POINTS)
    .multipliedBy(deltaDay)
    .multipliedBy(multiplier);
  return points;
}

// This method could throw exception if the position (tokenId) is burned
async function getLatestPositionSnapshot(
  ctx: EthContext,
  tokenId: string
): Promise<PositionSnapshot> {
  const pool = await getPool(ctx);
  const { tickLower, tickUpper, liquidity } = await getPositionInfo(
    ctx,
    tokenId
  );
  const position = new Position({ pool, tickLower, tickUpper, liquidity });
  const owner = await getPositionOwner(ctx, tokenId);

  const usrBalance = new BigDecimal(position.amount0.toFixed());
  const rlpBalance = new BigDecimal(position.amount1.toFixed());
  const token0Price = await getTokenPrice(ctx, USR);
  const token1Price = await getTokenPrice(ctx, RLP);
  const usdValue = usrBalance
    .multipliedBy(token0Price!)
    .plus(rlpBalance.multipliedBy(token1Price!));

  return new PositionSnapshot({
    id: tokenId,
    tickLower: BigInt(tickLower),
    tickUpper: BigInt(tickUpper),
    owner,
    timestampMilli: BigInt(ctx.timestamp.getTime()),
    usrBalance,
    rlpBalance,
    usdValue,
  });
}

async function getPool(ctx: EthContext): Promise<Pool> {
  const poolArgs =
    (await getPoolArgs(ctx, POOL_ADDRESS)) ??
    (await getPoolArgsFromChain(ctx, POOL_ADDRESS));
  const token0 = new Token(Number(NETWORK), USR, 18, "token0", "token0");
  const token1 = new Token(Number(NETWORK), RLP, 18, "token1", "token1");
  const { sqrtPriceX96, liquidity, tick } = poolArgs;
  return new Pool(
    token0,
    token1,
    500,
    sqrtPriceX96.toString(),
    liquidity.toString(),
    Number(tick)
  );
}

async function getPoolArgsFromChain(ctx: EthContext, poolAddress: string) {
  const poolContract = getCLPoolContractOnContext(ctx, poolAddress);
  const liquidity = await poolContract.liquidity();
  const { sqrtPriceX96, tick } = await poolContract.slot0();
  return { sqrtPriceX96, liquidity, tick };
}

async function getPositionInfo(
  ctx: EthContext,
  tokenId: string
): Promise<PositionInfo> {
  const nfpmContract = getNonfungiblePositionManagerContractOnContext(
    ctx,
    NONFUNGIBLE_POSITION_MANAGER_CONTRACT
  );
  const positionResponse = await nfpmContract.positions(tokenId);
  return {
    token0: positionResponse.token0,
    token1: positionResponse.token1,
    // fee: Number(positionResponse.fee),
    tickLower: Number(positionResponse.tickLower),
    tickUpper: Number(positionResponse.tickUpper),
    liquidity: positionResponse.liquidity.toString(),
  };
}

async function getPositionOwner(
  ctx: EthContext,
  tokenId: string
): Promise<string> {
  const nfpmContract = getNonfungiblePositionManagerContractOnContext(
    ctx,
    NONFUNGIBLE_POSITION_MANAGER_CONTRACT
  );
  return await nfpmContract.ownerOf(tokenId);
}

async function checkNFT(ctx: EthContext, tokenId: string): Promise<boolean> {
  try {
    // positions(tokenId) call may fail
    const positionResponse = await getPositionInfo(ctx, tokenId);
    return (
      positionResponse.token0.toLowerCase() === USR.toLowerCase() &&
      positionResponse.token1.toLowerCase() === RLP.toLowerCase()
    );
  } catch (e) {
    console.error(
      `positions(${tokenId}) call failed at txn ${ctx.transactionHash}:`,
      e?.message
    );
    return false;
  }
}
