/** gno.land building blocks for the transaction inspector: messages, events, token transfers, address links. */
import { SourceView } from "./SourceView";
import { useEffect, useState, type ReactNode } from "react";
import type { Message, Names, TokenInfo, TokenRow, TokenTransfer, TxEvent } from "../api";
import { addrHref, blockHref, bytes, coinText, coinsText, fmt, gnowebHref, isAddr, middle, pkgHref, shortPath, txHref } from "../lib";
import { splitTokenKey, tokenAmount, tokenIndex, tokenRoute } from "../transactionExplorer";
import { Chip } from "./ui";

/** Address with its @username when known; plain text when it is the page's own address. */
export function AddrLink({ address, names, current, head = 8, tail = 4, empty = "—" }: { address: string | null | undefined; names?: Names; current?: string | null; head?: number; tail?: number; empty?: ReactNode }) {
  if (!address) return <span className="txe-muted-inline">{empty}</span>;
  const name = names?.[address];
  const text = name ? `@${name}` : middle(address, head, tail);
  if (current && address === current) return <span className="txe-self" title={address}>{text}</span>;
  return (
    <a className={`txe-address-link${name ? " named" : ""}`} href={addrHref(address)} title={address} onClick={(e) => e.stopPropagation()}>
      {text}
    </a>
  );
}

export function PkgLink({ path, full = false }: { path: string | null | undefined; full?: boolean }) {
  if (!path) return <span className="txe-muted-inline">—</span>;
  return (
    <a className="txe-address-link txe-pkg" href={pkgHref(path)} title={path} onClick={(e) => e.stopPropagation()}>
      {full ? path : shortPath(path)}
    </a>
  );
}

export function TxLink({ hash, head = 8, tail = 4 }: { hash: string; head?: number; tail?: number }) {
  return (
    <a className="txe-address-link" href={txHref(hash)} title={hash} onClick={(e) => e.stopPropagation()}>
      {middle(hash, head, tail)}
    </a>
  );
}

/** Token key → symbol link to the token page, with a NFT badge for GRC721. */
export function TokenLabel({ token, standard, meta }: { token: string; standard?: string; meta?: Pick<TokenInfo, "name" | "symbol"> | null }) {
  const { realm, symbol } = splitTokenKey(token);
  return (
    <span className="txe-token">
      <a className="txe-address-link" href={tokenRoute(token)} title={`${meta?.name ?? symbol} · ${realm}`} onClick={(e) => e.stopPropagation()}>
        {meta?.symbol ?? symbol}
      </a>
      {standard === "grc721" && <em className="txe-nft">NFT</em>}
    </span>
  );
}

/** Loads the shared token list once; null until it arrives (or if it fails). */
export function useTokenIndex(): Map<string, TokenRow> | null {
  const [idx, setIdx] = useState<Map<string, TokenRow> | null>(null);
  useEffect(() => {
    let cancelled = false;
    tokenIndex().then((m) => !cancelled && setIdx(m)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return idx;
}

export function TokenAmount({ value, standard, decimals }: { value: string; standard?: string; decimals: number | null | undefined }) {
  const a = tokenAmount(value, standard, decimals);
  return (
    <span className="txe-amount" title={a.raw ? "Raw integer amount: the token's decimals are not known" : value}>
      {a.text}
      {a.raw && <small> raw</small>}
    </span>
  );
}

const MSG_TITLE: Record<string, string> = {
  MsgCall: "Call",
  MsgAddPackage: "Deploy package",
  MsgRun: "Run script",
  BankMsgSend: "Send",
  MsgEnablePackage: "Approve package",
  MsgRejectPackage: "Reject package",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const coinsOrNone = (c: string | null | undefined) => (c ? coinsText(c) : <span className="txe-muted-inline">none</span>);

function FileList({ files }: { files: { name: string; size?: number }[] | null | undefined }) {
  if (!files?.length) return <span className="txe-muted-inline">No files</span>;
  const total = files.reduce((s, f) => s + (f.size ?? 0), 0);
  return (
    <ul className="txe-files">
      {files.map((f) => (
        <li key={f.name}>
          <code>{f.name}</code>
          <span>{f.size === undefined ? "—" : bytes(f.size)}</span>
        </li>
      ))}
      <li className="total">
        <span>
          {files.length} file{files.length === 1 ? "" : "s"}
        </span>
        <span>{bytes(total)}</span>
      </li>
    </ul>
  );
}

/** One transaction message, rendered by kind. */
export function MessageView({ m, index, count, names }: { m: Message; index: number; count: number; names: Names }) {
  const v = m.value ?? {};
  const title = MSG_TITLE[m.kind] ?? `${m.route}/${m.type}`;
  let head: ReactNode = null;
  let body: ReactNode;
  switch (m.kind) {
    case "MsgCall": {
      const args: (string | null)[] | null = Array.isArray(v.args) ? v.args : null;
      head = (
        <>
          <PkgLink path={v.pkg_path} />
          <span className="txe-func">.{v.func}</span>
        </>
      );
      body = (
        <>
          <Field label="Caller">
            <AddrLink address={v.caller} names={names} head={10} tail={6} />
          </Field>
          <Field label="Realm">
            <PkgLink path={v.pkg_path} full />
            {v.pkg_path && (
              <a className="txe-ext" href={gnowebHref(v.pkg_path)} target="_blank" rel="noreferrer">
                gnoweb ↗
              </a>
            )}
          </Field>
          <Field label="Function">
            <code className="txe-code-inline">{v.func ?? "—"}</code>
          </Field>
          <Field label={`Arguments${args ? ` (${args.length})` : ""}`}>
            {args?.length ? (
              <ol className="txe-args">
                {args.map((a, i) => (
                  <li key={i}>
                    {a !== null && isAddr(a) ? <AddrLink address={a} names={names} head={10} tail={6} /> : <code>{a === null ? "null" : a === "" ? '""' : a}</code>}
                  </li>
                ))}
              </ol>
            ) : (
              <span className="txe-muted-inline">No arguments</span>
            )}
          </Field>
          <Field label="Send">{coinsOrNone(v.send)}</Field>
          <Field label="Max storage deposit">{v.max_deposit ? coinsText(v.max_deposit) : <span className="txe-muted-inline">not set</span>}</Field>
        </>
      );
      break;
    }
    case "MsgAddPackage":
      head = <PkgLink path={v.package?.path} />;
      body = (
        <>
          <Field label="Creator">
            <AddrLink address={v.creator} names={names} head={10} tail={6} />
          </Field>
          <Field label="Package path">
            <PkgLink path={v.package?.path} full />
            {v.package?.path && (
              <a className="txe-ext" href={gnowebHref(v.package.path)} target="_blank" rel="noreferrer">
                gnoweb ↗
              </a>
            )}
          </Field>
          <Field label="Package name">
            <code className="txe-code-inline">{v.package?.name ?? "—"}</code>
          </Field>
          <Field label="Files">
            <FileList files={v.package?.files} />
          </Field>
          <Field label="Deposit">{coinsOrNone(v.deposit)}</Field>
          <Field label="Max storage deposit">{v.max_deposit ? coinsText(v.max_deposit) : <span className="txe-muted-inline">not set</span>}</Field>
          {v.send ? <Field label="Send">{coinsText(v.send)}</Field> : null}
        </>
      );
      break;
    case "MsgRun":
      head = <span className="txe-func">{v.package?.name ?? "main"}</span>;
      body = (
        <>
          <Field label="Caller">
            <AddrLink address={v.caller} names={names} head={10} tail={6} />
          </Field>
          <Field label="Script package files">
            <FileList files={v.package?.files} />
          </Field>
          {(v.script as { name: string; body: string }[] | undefined)?.map((f) => (
            <div key={f.name} className="txe-script">
              <SourceView text={f.body} name={f.name} maxHeight={420} />
            </div>
          ))}
          <Field label="Send">{coinsOrNone(v.send)}</Field>
          <Field label="Max storage deposit">{v.max_deposit ? coinsText(v.max_deposit) : <span className="txe-muted-inline">not set</span>}</Field>
          <p className="txe-muted txe-field-note">A run executes an ephemeral script package with the caller's authority; it is not stored on chain.</p>
        </>
      );
      break;
    case "BankMsgSend":
      head = <span className="txe-func">{coinsText(v.amount)}</span>;
      body = (
        <>
          <div className="txe-flow">
            <AddrLink address={v.from_address} names={names} head={10} tail={6} />
            <span aria-label="to">→</span>
            <AddrLink address={v.to_address} names={names} head={10} tail={6} />
          </div>
          <Field label="Amount">
            <strong className="txe-strong">{coinsText(v.amount)}</strong>
          </Field>
        </>
      );
      break;
    case "MsgEnablePackage":
      head = <PkgLink path={v.pkg_path} />;
      body = (
        <>
          <Field label="Approver">
            <AddrLink address={v.approver} names={names} head={10} tail={6} />
          </Field>
          <Field label="Package">
            <PkgLink path={v.pkg_path} full />
          </Field>
          <Field label="Package hash">
            <code className="txe-code-inline">{v.pkg_hash ?? "—"}</code>
          </Field>
          <Field label="Deployed at height">{v.pkg_height ? <a className="txe-address-link" href={blockHref(Number(v.pkg_height))}>#{fmt(Number(v.pkg_height))}</a> : "—"}</Field>
        </>
      );
      break;
    case "MsgRejectPackage":
      head = <PkgLink path={v.pkg_path} />;
      body = (
        <>
          <Field label="Sender">
            <AddrLink address={v.sender} names={names} head={10} tail={6} />
          </Field>
          <Field label="Package">
            <PkgLink path={v.pkg_path} full />
          </Field>
        </>
      );
      break;
    default:
      body = <pre className="txe-json">{JSON.stringify(v, null, 2)}</pre>;
  }
  return (
    <section className={`txe-message txe-msg-${m.kind}`}>
      <h3>
        <span className="txe-msg-index">{count > 1 ? `#${index + 1}` : "Message"}</span>
        <span className="txe-msg-kind">{title}</span>
        {head && <span className="txe-msg-target">{head}</span>}
      </h3>
      <dl className="txe-fields">{body}</dl>
    </section>
  );
}

/** GRC20/GRC721 transfers parsed from a transaction's events. */
export function TokenTransferList({ transfers, names, tokens }: { transfers: TokenTransfer[]; names: Names; tokens: Map<string, TokenRow> | null }) {
  return (
    <div className="txe-table-scroll">
      <table className="txe-mini-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>From</th>
            <th>To</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((t) => {
            const meta = tokens?.get(t.token) ?? null;
            return (
              <tr key={t.idx}>
                <td>
                  <TokenLabel token={t.token} standard={t.standard} meta={meta} />
                </td>
                <td>
                  <AddrLink address={t.from} names={names} empty={<em className="txe-mint">mint</em>} />
                </td>
                <td>
                  <AddrLink address={t.to} names={names} empty={<em className="txe-mint">burn</em>} />
                </td>
                <td>
                  <TokenAmount value={t.value} standard={t.standard} decimals={meta?.decimals} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AttrValue({ value, names }: { value: string; names: Names }) {
  if (isAddr(value)) return <AddrLink address={value} names={names} head={10} tail={6} />;
  if (/^gno\.land\/[rp]\/[A-Za-z0-9_/-]+$/.test(value)) return <PkgLink path={value} full />;
  return <code>{value === "" ? '""' : value}</code>;
}

const EVENT_LABEL: Record<TxEvent["kind"], string> = {
  gno: "Event",
  storage_deposit: "Storage deposit",
  storage_unlock: "Storage unlock",
  transfer: "Coin transfer",
  unknown: "Unknown",
};
const EVENT_TONE: Record<TxEvent["kind"], "ok" | "warn" | "bad" | "brand" | "muted"> = {
  gno: "brand",
  storage_deposit: "warn",
  storage_unlock: "ok",
  transfer: "muted",
  unknown: "muted",
};

/** GnoVM events, storage deposits/unlocks and coin transfers, in emission order. */
export function EventList({ events, names }: { events: TxEvent[]; names: Names }) {
  return (
    <ol className="txe-events">
      {events.map((e) => (
        <li key={e.idx} className={`txe-event ${e.kind}`}>
          <div className="txe-event-head">
            <span className="txe-event-idx">{e.idx}</span>
            <Chip tone={EVENT_TONE[e.kind] ?? "muted"}>{EVENT_LABEL[e.kind] ?? e.kind}</Chip>
            {e.type && <strong>{e.type}</strong>}
            {e.pkg_path && <PkgLink path={e.pkg_path} />}
          </div>
          {e.kind === "gno" && e.attrs && e.attrs.length > 0 && (
            <dl className="txe-attrs">
              {e.attrs.map((a, i) => (
                <div key={i}>
                  <dt>{a.key}</dt>
                  <dd>
                    <AttrValue value={a.value} names={names} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {(e.kind === "storage_deposit" || e.kind === "storage_unlock") && (
            <p className="txe-event-line">
              <b className={(e.bytes_delta ?? 0) >= 0 ? "up" : "down"}>
                {(e.bytes_delta ?? 0) > 0 ? "+" : ""}
                {bytes(e.bytes_delta)}
              </b>
              <span>
                {e.kind === "storage_deposit" ? "locked" : "refunded"} {e.amount ? coinText(e.amount, e.denom) : "—"}
              </span>
            </p>
          )}
          {e.kind === "transfer" && (
            <p className="txe-event-line">
              <AddrLink address={e.from} names={names} head={10} tail={6} />
              <span>→</span>
              <AddrLink address={e.to} names={names} head={10} tail={6} />
              <b>{e.amount ? coinText(e.amount, e.denom) : "—"}</b>
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
