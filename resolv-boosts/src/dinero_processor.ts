import { ERC20Processor } from "@sentio/sdk/eth/builtin";
import { EthContext, isNullAddress } from "@sentio/sdk/eth";
import { DINERO_APXETH, DINERO_NETWORK, DINERO_PXETH } from "./config.js";
import { getERC20ContractOnContext } from "@sentio/sdk/eth/builtin/erc20";
import { filterSnapshots, updateBoost } from "./util.js";

ERC20Processor.bind({
  network: DINERO_NETWORK,
  address: DINERO_APXETH,
}).onEventTransfer(async (event, ctx) => {
  const accounts = [event.args.from, event.args.to].filter(
    (acc) => !isNullAddress(acc)
  );
  const newSnapshots = await Promise.all(
    accounts.map((account) => processAccount(ctx, account))
  );
  await ctx.store.upsert(filterSnapshots(newSnapshots));
});

ERC20Processor.bind({
  network: DINERO_NETWORK,
  address: DINERO_PXETH,
}).onEventTransfer(async (event, ctx) => {
  const accounts = [event.args.from, event.args.to].filter(
    (acc) => !isNullAddress(acc)
  );
  const newSnapshots = await Promise.all(
    accounts.map((account) => processAccount(ctx, account))
  );
  await ctx.store.upsert(filterSnapshots(newSnapshots));
});

async function processAccount(ctx: EthContext, account: string) {
  const apxETH = getERC20ContractOnContext(ctx, DINERO_APXETH);
  const pxETH = getERC20ContractOnContext(ctx, DINERO_PXETH);
  const apxETHBalance = await apxETH.balanceOf(account);
  const pxETHBalance = await pxETH.balanceOf(account);
  return updateBoost(
    ctx,
    account,
    "dinero",
    apxETHBalance > 0 || pxETHBalance > 0
  );
}
