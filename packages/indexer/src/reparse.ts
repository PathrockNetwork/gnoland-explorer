/**
 * Re-decode already indexed transactions after a parser change:
 *   pnpm --filter @gnoland-explorer/indexer reparse vm/run
 * Refetches every transaction of the given kind from the tx-indexer and
 * rewrites its row and events. Blocks, packages and signatures are untouched.
 */
import { sql } from "drizzle-orm";
import { TxIndexer, createDb, events, loadEnv, parseTx, tokenTransfers, transactions } from "@gnoland-explorer/core";

loadEnv();
const kind = process.argv[2];
if (!kind) throw new Error("usage: reparse <kind>, e.g. vm/run");

const { db, pool } = createDb();
const txIndexer = new TxIndexer();
const { rows } = await pool.query<{ hash: string; time: Date }>(`select hash, time from transactions where kinds @> $1`, [[kind]]);
for (const { hash, time } of rows) {
  const raw = await txIndexer.tx(hash);
  if (!raw) continue;
  const p = parseTx(raw, time);
  await db.transaction(async (tx) => {
    const { hash: _h, ...update } = p.tx;
    await tx.update(transactions).set(update).where(sql`${transactions.hash} = ${hash}`);
    await tx.delete(events).where(sql`${events.txHash} = ${hash}`);
    if (p.events.length) await tx.insert(events).values(p.events);
    await tx.delete(tokenTransfers).where(sql`${tokenTransfers.txHash} = ${hash}`);
    if (p.transfers.length) await tx.insert(tokenTransfers).values(p.transfers);
  });
}
console.log(`reparsed ${rows.length} ${kind} transactions`);
await pool.end();
