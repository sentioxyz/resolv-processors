import { ERC20Processor } from "@sentio/sdk/eth/builtin";
import { EthContext, isNullAddress } from "@sentio/sdk/eth";
import { ARB_USDC, HYPERLIQUID_BRIDGE, HYPERLIQUID_NETWORK } from "./config.js";
import { filterSnapshots, updateBoost } from "./util.js";

ERC20Processor.bind({
  network: HYPERLIQUID_NETWORK,
  address: ARB_USDC,
}).onEventTransfer(
  async (event, ctx) => {
    if (event.args.value <= 0) {
      return;
    }
    const accounts = [event.args.from, event.args.to].filter(
      (acc) => !isNullAddress(acc)
    );
    const newSnapshots = await Promise.all(
      accounts.map((account) => processAccount(ctx, account))
    );
    await ctx.store.upsert(filterSnapshots(newSnapshots));
  },
  ERC20Processor.filters.Transfer(null, HYPERLIQUID_BRIDGE)
);

async function processAccount(ctx: EthContext, account: string) {
  return updateBoost(ctx, account, "hyperliquid", true);
}
