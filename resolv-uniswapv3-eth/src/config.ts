import { EthChainId, EthContext, getProvider } from "@sentio/sdk/eth";
import { getUniswapV3PoolContract } from "./types/eth/uniswapv3pool.js";
import { getERC20Contract } from "@sentio/sdk/eth/builtin/erc20";
import { getPriceBySymbol } from "@sentio/sdk/utils";

export interface PoolInfo {
  address: string;
  token0: string;
  token0Decimals: number;
  token1: string;
  token1Decimals: number;
  fee: number;
}

export const MILLISECOND_PER_HOUR = 60 * 60 * 1000 * 24;
export const DAILY_POINTS = 15;

export const NETWORK = EthChainId.ETHEREUM;
// export const UNISWAP_V3_FACTORY = "0x5bd1f6735b80e58aac88b8a94836854d3068a13a";
export const NONFUNGIBLE_POSITION_MANAGER_CONTRACT =
  "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

const POOL_ADDRESSES = [
  "0x8Bb9cD887Dd51c5aA8d7dA9e244c94beC035e47c", // USR/USDC
];

export const configs: PoolInfo[] = await Promise.all(
  POOL_ADDRESSES.map(async (address) => {
    const c = getUniswapV3PoolContract(NETWORK, address);
    const [token0, token1, fee] = await Promise.all([
      c.token0(),
      c.token1(),
      c.fee(),
    ]);
    return {
      address,
      token0,
      token0Decimals: Number(
        await getERC20Contract(NETWORK, token0).decimals()
      ),
      token1,
      token1Decimals: Number(
        await getERC20Contract(NETWORK, token1).decimals()
      ),
      fee: Number(fee),
    };
  })
);

export const POOL_START_BLOCK = Math.min(
  ...(await Promise.all(
    POOL_ADDRESSES.map((address) => getCreationBlock(NETWORK, address))
  ))
);

export function getPoolInfo(address: string) {
  return configs.find(
    (config) => config.address.toLowerCase() === address.toLowerCase()
  );
}

async function getCreationBlock(
  network: EthChainId,
  address: string
): Promise<number> {
  const provider = getProvider(network);
  let l = 0;
  let r = await provider.getBlockNumber();
  while (l < r) {
    const m = Math.floor((l + r) / 2);
    const code = await provider.getCode(address, m);
    if (code.length > 2) {
      r = m;
    } else {
      l = m + 1;
    }
  }
  return l;
}

export function getTokenPrice(ctx: EthContext, token: string) {
  if (token.toLowerCase() == "0x66a1e37c9b0eaddca17d3662d6c05f4decf3e110") {
    // USR
    return 1;
  }
  if (token.toLowerCase() == "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") {
    // USDC
    return getPriceBySymbol("usdc", ctx.timestamp);
  }
  throw new Error(`unsupported token: ${token}`);
}
