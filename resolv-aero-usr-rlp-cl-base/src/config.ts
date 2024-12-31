import { EthChainId, EthContext, getProvider } from "@sentio/sdk/eth";
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
export const DAILY_POINTS = 30;

export const NETWORK = EthChainId.BASE;
export const NONFUNGIBLE_POSITION_MANAGER_CONTRACT =
  "0x827922686190790b37229fd06084350e74485b72";

export const POOL_ADDRESS = "0xf4D5f114d029657Bd55511b359d2A0Ad73620d17"; // USR/RLP
export const POOL_START_BLOCK = 24304142;
export const USR = "0x35E5dB674D8e93a03d814FA0ADa70731efe8a4b9";
export const RLP = "0xC31389794Ffac23331E0D9F611b7953f90AA5fDC";

export const GAUGE_ADDRESS: string | undefined = undefined;

export function getTokenPrice(ctx: EthContext, token: string) {
  if (token.toLowerCase() == USR.toLowerCase()) {
    return 1;
  }
  if (token.toLowerCase() == RLP.toLowerCase()) {
    return 1;
  }
  throw new Error(`unsupported token: ${token}`);
}
