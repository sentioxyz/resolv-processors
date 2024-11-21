import { EthChainId, EthContext } from "@sentio/sdk/eth";
import { getERC20Contract } from "@sentio/sdk/eth/builtin/erc20";
import { getPriceBySymbol } from "@sentio/sdk/utils";

export const DAILY_POINTS = 15;
export const MILLISECOND_PER_DAY = 60 * 60 * 1000 * 24;

export const NETWORK = EthChainId.ETHEREUM;
export const RLP = "0x4956b52ae2ff65d74ca2d61207523288e4528f96";
export const TOKEN_DECIMALS = await getERC20Contract(NETWORK, RLP).decimals();

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
