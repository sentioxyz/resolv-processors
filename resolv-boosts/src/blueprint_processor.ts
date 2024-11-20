import { ERC721Processor } from "@sentio/sdk/eth/builtin";
import { BLUEPRINT_ADDRESS, BLUEPRINT_NETWORK } from "./config.js";
import { isNullAddress } from "@sentio/sdk/eth";
import { ERC721Context } from "@sentio/sdk/eth/builtin/erc721";
import { filterSnapshots, updateBoost } from "./util.js";

ERC721Processor.bind({
  network: BLUEPRINT_NETWORK,
  address: BLUEPRINT_ADDRESS,
}).onEventTransfer(async (event, ctx) => {
  const accounts = [event.args.from, event.args.to].filter(
    (acc) => !isNullAddress(acc)
  );
  const newSnapshots = await Promise.all(
    accounts.map((account) => processAccount(ctx, account))
  );
  await ctx.store.upsert(filterSnapshots(newSnapshots));
});

async function processAccount(ctx: ERC721Context, account: string) {
  const balance = await ctx.contract.balanceOf(account);
  return updateBoost(ctx, account, "blueprint", balance > 0);
}
