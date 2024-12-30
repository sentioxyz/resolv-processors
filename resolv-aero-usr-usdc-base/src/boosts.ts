import { EthContext } from "@sentio/sdk/eth";

interface Boost {
  account: string;
  dinero: boolean;
  blueprint: boolean;
  hyperliquid: boolean;
}

const S1Milli = 1733961600000; // 2024-12-12 00:00:00

let lastUpdateTimestampMilli = 0;
let accountBoosts: { [account: string]: Boost } = {};

export async function getBoostMultiplier(ctx: EthContext, account: string) {
  const ts = ctx.timestamp.getTime();
  const boosts = await getBoosts(account);
  let ret = 1;
  if (boosts.dinero) {
    ret += (ts < S1Milli) ? 0.5 : 0.1;
  }
  if (boosts.blueprint) {
    ret += (ts < S1Milli) ? 0.25 : 0.25;
  }
  if (boosts.hyperliquid) {
    ret += (ts < S1Milli) ? 0.5 : 0.1;
  }
  return ret;
}

export async function getBoosts(account: string) {
  account = account.toLowerCase();
  const defaultBoost = <Boost>{
    account,
    dinero: false,
    blueprint: false,
    hyperliquid: false,
  };
  return accountBoosts[account] ?? defaultBoost;
}

export async function updateBoosts(ctx: EthContext) {
  const limit = 10000;
  let offset = 0;
  let tot = 0;
  let ret: { [account: string]: Boost } = {};
  while (true) {
    const params = {
      limit,
      offset,
      timestamp: ctx.timestamp.getTime() / 1000,
    };
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error("api key not set");
    }
    const resp = await fetch(
      "https://endpoint.sentio.xyz/resolv/resolv-boosts/user-boosts",
      {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      }
    ).then((res) => res.json());
    if (!resp.syncSqlResponse.result) {
      console.error("empty resp", resp);
      throw new Error("empty resp");
    }
    const rows = resp.syncSqlResponse.result.rows || [];
    for (const row of rows) {
      const { account, dinero_boost, blueprint_boost, hyperliquid_boost } = row;
      ret[account] = {
        account,
        dinero: dinero_boost == 1,
        blueprint: blueprint_boost == 1,
        hyperliquid: hyperliquid_boost == 1,
      };
    }
    tot += rows.length;
    offset += limit;
    // console.log("got boosts rows", rows.length);
    if (rows.length < limit) {
      break;
    }
  }
  console.log(`successfully updated boosts, timestamp: ${ctx.timestamp.getTime()}, size: ${tot}`);
  lastUpdateTimestampMilli = ctx.timestamp.getTime();
  accountBoosts = ret;
  return ret;
}
