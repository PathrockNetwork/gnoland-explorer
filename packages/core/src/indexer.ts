/**
 * Client for the official gno.land tx-indexer (github.com/gnolang/tx-indexer),
 * which decodes amino transactions into GraphQL. It is the transaction source
 * for both the indexer and the API, the way yaci is for the Secret explorer.
 */

const TIMEOUT_MS = 30_000;
/** The indexer silently truncates every list query at this many results. */
export const RESULT_CAP = 10_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function indexerUrlFromEnv(): string {
  return process.env.TX_INDEXER_URL ?? "https://indexer.gno.land/graphql/query";
}

/** Message value fields requested from the indexer, shared by every query. */
const MESSAGE_FIELDS = `
  route typeUrl
  value {
    __typename
    ... on BankMsgSend { from_address to_address amount }
    ... on MsgCall { caller send pkg_path func args max_deposit }
    ... on MsgAddPackage { creator send max_deposit package { name path files { name body } } }
    ... on MsgRun { caller send max_deposit package { name path files { name body } } }
    ... on MsgEnablePackage { approver pkg_path pkg_hash pkg_height }
    ... on MsgRejectPackage { sender pkg_path }
    ... on UnexpectedMessage { raw }
  }`;

const EVENT_FIELDS = `
  __typename
  ... on GnoEvent { type pkg_path attrs { key value } }
  ... on StorageDepositEvent { bytes_delta fee_delta { amount denom } pkg_path }
  ... on StorageUnlockEvent { bytes_delta fee_refund { amount denom } pkg_path refund_withheld }
  ... on TransferEvent { from to coins }
  ... on UnknownEvent { value }`;

export const TX_FIELDS = `
  hash index block_height success gas_wanted gas_used memo
  gas_fee { amount denom }
  messages { ${MESSAGE_FIELDS} }
  response { log error events { ${EVENT_FIELDS} } }`;

export const BLOCK_FIELDS = `height hash time num_txs total_txs proposer_address_raw app_hash validators_hash`;

export type RawBlock = {
  height: number;
  hash: string;
  time: string;
  num_txs: number;
  total_txs: number;
  proposer_address_raw: string;
  app_hash: string;
  validators_hash: string;
};

export type RawMemPackage = { name: string; path: string; files: { name: string; body: string }[] | null };

export type RawMessage = {
  route: string;
  typeUrl: string;
  value: { __typename: string; [k: string]: any };
};

export type RawEvent = { __typename: string; [k: string]: any };

export type RawTx = {
  hash: string;
  index: number;
  block_height: number;
  success: boolean;
  gas_wanted: number;
  gas_used: number;
  memo: string;
  gas_fee: { amount: number; denom: string } | null;
  messages: RawMessage[];
  response: { log: string; error: string; events: RawEvent[] | null };
};

export type Supply = { denom: string; height: number; total: string; locked: string; spendable: string };

export class TxIndexer {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(
    readonly url: string = indexerUrlFromEnv(),
    private rps = Number(process.env.TX_INDEXER_RPS ?? 5),
  ) {
    this.tokens = rps;
  }

  async query<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    await this.take();
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok && res.status !== 422) throw new Error(`tx-indexer: HTTP ${res.status}`);
        const json: any = await res.json();
        if (json.errors?.length) throw new Error(`tx-indexer: ${json.errors[0].message}`);
        return json.data as T;
      } catch (err) {
        lastErr = err;
        await sleep(500 * 2 ** attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async latestHeight(): Promise<number> {
    const d = await this.query<{ latestBlockHeight: number }>(`{ latestBlockHeight }`);
    return d.latestBlockHeight;
  }

  /** Blocks with lo ≤ height ≤ hi, ascending. */
  async blocks(lo: number, hi: number): Promise<RawBlock[]> {
    // The indexer answers null for an empty result and for a negative bound.
    const d = await this.query<{ getBlocks: RawBlock[] | null }>(
      `query($lt: Int!${lo > 0 ? ", $gt: Int!" : ""}) { getBlocks(where: { height: { lt: $lt${lo > 0 ? ", gt: $gt" : ""} } }, order: { height: ASC }) { ${BLOCK_FIELDS} } }`,
      lo > 0 ? { gt: lo - 1, lt: hi + 1 } : { lt: hi + 1 },
    );
    return d.getBlocks ?? [];
  }

  /**
   * Transactions with lo ≤ height ≤ hi, in chain order. A page that hits the
   * result cap may end mid-block, so its last height is dropped and fetched
   * again as the start of the next page.
   */
  async txs(lo: number, hi: number): Promise<RawTx[]> {
    const out: RawTx[] = [];
    let from = lo;
    while (from <= hi) {
      const d = await this.query<{ getTransactions: RawTx[] | null }>(
        `query($lt: Int!${from > 0 ? ", $gt: Int!" : ""}) { getTransactions(where: { block_height: { lt: $lt${from > 0 ? ", gt: $gt" : ""} } }, order: { heightAndIndex: ASC }) { ${TX_FIELDS} } }`,
        from > 0 ? { gt: from - 1, lt: hi + 1 } : { lt: hi + 1 },
      );
      const page = d.getTransactions ?? [];
      if (page.length < RESULT_CAP) {
        out.push(...page);
        break;
      }
      const last = page[page.length - 1]!.block_height;
      if (last === from) throw new Error(`more than ${RESULT_CAP} transactions in block ${from}`);
      out.push(...page.filter((t) => t.block_height < last));
      from = last;
    }
    return out;
  }

  async tx(hash: string): Promise<RawTx | null> {
    const d = await this.query<{ getTransactions: RawTx[] | null }>(
      `query($h: String!) { getTransactions(where: { hash: { eq: $h } }) { ${TX_FIELDS} } }`,
      { h: hash },
    );
    return d.getTransactions?.[0] ?? null;
  }

  /** Supply of a denom as the indexer tracks it (total, locked, spendable). */
  async supply(denom = "ugnot"): Promise<Supply> {
    const d = await this.query<{ getSupply: Supply }>(`query($d: String!) { getSupply(denom: $d) { denom height total locked spendable } }`, { d: denom });
    return d.getSupply;
  }

  private async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.rps, this.tokens + ((now - this.lastRefill) / 1000) * this.rps);
      this.lastRefill = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(Math.ceil(((1 - this.tokens) / this.rps) * 1000));
    }
  }
}
