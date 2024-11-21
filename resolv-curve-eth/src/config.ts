import { EthChainId, EthContext, getProvider } from "@sentio/sdk/eth";
import { getCurveStableSwapNGContract } from "./types/eth/curvestableswapng.js";
import { getPriceBySymbol } from "@sentio/sdk/utils";
import { getERC20Contract } from "@sentio/sdk/eth/builtin/erc20";

interface Config {
  address: string;
  gauge?: string;
  gaugeStartBlock?: number;
}

export const DAILY_POINTS = 15;
export const MILLISECOND_PER_DAY = 60 * 60 * 1000 * 24;

export const NETWORK = EthChainId.ETHEREUM;
export const configs: Config[] = [
  {
    address: "0x3ee841f47947fefbe510366e4bbb49e145484195", // USR-USDC
    gauge: "0xf589273a91622f1f48c0cd378881f0b3e6c40a95",
    gaugeStartBlock: await getCreationBlock(
      NETWORK,
      "0xf589273a91622f1f48c0cd378881f0b3e6c40a95"
    ),
  },
  {
    address: "0xc907ba505c2e1cbc4658c395d4a2c7e6d2c32656", // USR-RLP
    gauge: "0x52ed9f154f25dd0abc67edb15dce90fd92d8b22f",
    gaugeStartBlock: await getCreationBlock(
      NETWORK,
      "0x52ed9f154f25dd0abc67edb15dce90fd92d8b22f"
    ),
  },
];

export const poolInfos = await Promise.all(
  configs.map(async (config) => {
    const c = getCurveStableSwapNGContract(NETWORK, config.address);
    const token0 = await c.coins(0);
    const token1 = await c.coins(1);
    const token0Decimals = Number(
      await getERC20Contract(NETWORK, token0).decimals()
    );
    const token1Decimals = Number(
      await getERC20Contract(NETWORK, token1).decimals()
    );
    return {
      address: config.address,
      token0,
      token1,
      token0Decimals,
      token1Decimals,
    };
  })
);

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

export function getConfig(address: string) {
  return configs.find((config) => config.address === address);
}

export function getPoolInfo(address: string) {
  return poolInfos.find((poolInfo) => poolInfo.address === address);
}

export function getTokenPrice(ctx: EthContext, token: string) {
  if (token.toLowerCase() == "0x66a1e37c9b0eaddca17d3662d6c05f4decf3e110") {
    // USR
    return 1;
  }
  if (token.toLowerCase() == "0x4956b52ae2ff65d74ca2d61207523288e4528f96") {
    // RLP
    return 1;
  }
  if (token.toLowerCase() == "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") {
    // USDC
    return getPriceBySymbol("usdc", ctx.timestamp);
  }
  throw new Error(`unsupported token: ${token}`);
}
