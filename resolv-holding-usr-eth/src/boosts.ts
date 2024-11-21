import { EthContext } from "@sentio/sdk/eth";
import { Mutex } from "async-mutex";

interface Boost {
  account: string;
  timestampMilli: number;
  dinero: boolean;
  blueprint: boolean;
}

const updateIntervalMilli = 10 * 60 * 1000; // 10 minutes

const mutex = new Mutex();
let lastUpdateTimestampMilli = 0;
let accountBoosts: { [account: string]: Boost[] } = {};

fetchBoosts();

export async function getBoostMultiplier(ctx: EthContext, account: string) {
  const boosts = await getBoosts(ctx, account);
  let ret = 1;
  if (boosts.dinero) {
    ret *= 2;
  }
  if (boosts.blueprint) {
    ret *= 2;
  }
  return ret;
}

export async function getBoosts(ctx: EthContext, account: string) {
  return getBoostsByTime(ctx.timestamp.getTime(), account);
}

export async function getBoostsByTime(timestampMilli: number, account: string) {
  account = account.toLowerCase();
  const defaultBoost = <Boost>{
    account,
    timestampMilli,
    dinero: false,
    blueprint: false,
  };

  const allBoosts = await mutex.runExclusive(fetchBoosts);
  const boosts = allBoosts[account];
  if (!boosts) {
    return defaultBoost;
  }
  let l = 0,
    r = boosts.length - 1;
  while (l < r) {
    const m = Math.ceil((l + r) / 2);
    if (boosts[m].timestampMilli <= timestampMilli) {
      l = m;
    } else {
      r = m - 1;
    }
  }
  return boosts[l].timestampMilli <= timestampMilli ? boosts[l] : defaultBoost;
}

export async function fetchBoosts() {
  if (Date.now() - lastUpdateTimestampMilli < updateIntervalMilli) {
    return accountBoosts;
  }
  const limit = 10000;
  let offset = 0;
  let tot = 0;
  let ret: { [account: string]: Boost[] } = {};
  while (true) {
    const sql = `
    select lower(account) as account, toUnixTimestamp(timestamp) * 1000 as timestampMilli, dinero, blueprint 
    from boosts 
    order by timestamp asc
    limit ${limit} 
    offset ${offset}`;
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error("api key not set");
    }
    const resp = await fetch(
      "https://app.sentio.xyz/api/v1/analytics/resolv/resolv-boosts/sql/execute",
      {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sqlQuery: {
            sql,
            size: 10000,
          },
        }),
      }
    ).then((res) => res.json());
    if (!resp.result) {
      console.error("empty resp", resp);
      throw new Error("empty resp");
    }
    for (const row of resp.result.rows) {
      const { account, timestampMilli, dinero, blueprint } = row;
      if (!ret[account]) {
        ret[account] = [];
      }
      ret[account].push({
        account,
        timestampMilli,
        dinero: dinero == 1,
        blueprint: blueprint == 1,
      });
    }
    tot += resp.result.rows.length;
    offset += limit;
    console.log("got boosts rows", resp.result.rows.length);
    if (resp.result.rows.length < limit) {
      break;
    }
  }
  console.log("successfully updated boosts, size:", tot);
  lastUpdateTimestampMilli = Date.now();
  accountBoosts = ret;
  return ret;
}
