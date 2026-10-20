import { describe, expect, it } from "vitest";
import {
  evalValue,
  importsOf,
  isHash,
  isTokenKey,
  normalizeHash,
  parseCoins,
  parseProposal,
  parseProposalList,
  parseTokenRegistry,
  parseTx,
  parseUserData,
  parseValoper,
  parseVotes,
  ugnotOf,
  type RawTx,
} from "../src";

describe("coins and hashes", () => {
  it("parses coin strings", () => {
    expect(parseCoins("30093ugnot")).toEqual([{ amount: "30093", denom: "ugnot" }]);
    expect(parseCoins("1ugnot,5/gno.land/r/foo:bar")).toEqual([
      { amount: "1", denom: "ugnot" },
      { amount: "5", denom: "/gno.land/r/foo:bar" },
    ]);
    expect(parseCoins("")).toEqual([]);
    expect(ugnotOf("7ugnot,3foo,2ugnot")).toBe(9n);
  });

  it("normalises base64url and hex hashes to standard base64", () => {
    const b64 = "1u8+zNzStDKZknA6bTLnIw48Oiy7Keg1S0H3hRFIc5E=";
    expect(isHash(b64)).toBe(true);
    expect(normalizeHash("1u8-zNzStDKZknA6bTLnIw48Oiy7Keg1S0H3hRFIc5E")).toBe(b64);
    const hex = Buffer.from(b64, "base64").toString("hex");
    expect(normalizeHash(`0x${hex}`)).toBe(b64);
  });

  it("only accepts token keys safe for qeval", () => {
    expect(isTokenKey("gno.land/r/gnoswap/gns.GNS")).toBe(true);
    expect(isTokenKey('gno.land/r/x.Y")+panic("')).toBe(false);
  });
});

describe("parseTx", () => {
  const raw: RawTx = {
    hash: "dHWSWsnHlClDC/ZjhLAcLu4UdqsaaQco3f/yNeElhRY=",
    index: 0,
    block_height: 944028,
    success: true,
    gas_wanted: 7000000,
    gas_used: 3160705,
    memo: "",
    gas_fee: { amount: 7000, denom: "ugnot" },
    messages: [
      {
        route: "vm",
        typeUrl: "exec",
        value: { __typename: "MsgCall", caller: "g18dd5mstjqlcg9ngqpg26azeya6wqg7upd9t8xa", send: "", pkg_path: "gno.land/r/demo/foo", func: "Heartbeat", args: null },
      },
      {
        route: "vm",
        typeUrl: "add_package",
        value: {
          __typename: "MsgAddPackage",
          creator: "g18dd5mstjqlcg9ngqpg26azeya6wqg7upd9t8xa",
          package: { name: "bar", path: "gno.land/p/demo/bar", files: [{ name: "bar.gno", body: "package bar\n" }] },
        },
      },
    ],
    response: {
      log: "",
      error: "",
      events: [
        { __typename: "StorageDepositEvent", bytes_delta: 120, fee_delta: { amount: 12000, denom: "ugnot" }, pkg_path: "gno.land/r/demo/foo" },
        { __typename: "StorageUnlockEvent", bytes_delta: 20, fee_refund: { amount: 2000, denom: "ugnot" }, pkg_path: "gno.land/r/demo/foo", refund_withheld: false },
        {
          __typename: "GnoEvent",
          type: "Transfer",
          pkg_path: "gno.land/p/nt/grc20/v0",
          attrs: [
            { key: "token", value: "gno.land/r/gnoswap/gns.GNS.0000000" },
            { key: "from", value: "" },
            { key: "to", value: "g1pm5kng23plegteadapdennyank8pz63u0t92e5" },
            { key: "value", value: "141421356" },
          ],
        },
      ],
    },
  };
  const p = parseTx(raw, new Date("2026-10-20T00:00:00Z"));

  it("indexes kinds, paths, functions and addresses", () => {
    expect(p.tx.kinds).toEqual(["vm/exec", "vm/add_package"]);
    expect(p.tx.pkgPaths).toEqual(["gno.land/r/demo/foo", "gno.land/p/demo/bar"]);
    expect(p.tx.funcs).toEqual(["gno.land/r/demo/foo.Heartbeat"]);
    expect(p.tx.signer).toBe("g18dd5mstjqlcg9ngqpg26azeya6wqg7upd9t8xa");
    expect(p.tx.addresses).toContain("g1pm5kng23plegteadapdennyank8pz63u0t92e5");
  });

  it("nets storage deposits against unlocks", () => {
    expect(p.tx.storageDelta).toBe(100);
    expect(p.events[1]!.bytesDelta).toBe(-20);
  });

  it("stores file sizes instead of bodies and records the deployed package", () => {
    expect(p.tx.messages[1]!.value.package.files).toEqual([{ name: "bar.gno", size: 12 }]);
    expect(p.packages).toHaveLength(1);
    expect(p.packages[0]).toMatchObject({ path: "gno.land/p/demo/bar", kind: "pure", sourceBytes: 12 });
  });

  it("extracts GRC20 transfers keyed by registry key", () => {
    expect(p.transfers).toEqual([
      expect.objectContaining({ token: "gno.land/r/gnoswap/gns.GNS", standard: "grc20", from: null, value: "141421356" }),
    ]);
  });
});

describe("realm renders", () => {
  it("parses a valopers profile", () => {
    const md = `Valoper's details:
## berty-validator-1
mainnet founding validator (berty-validator-1)

- Operator Address: g1qynsu9dwj9lq0m5fkje7jh6qy3md80ztqnshhm
- Signing Address: g1l983yy3kpmapyzcfy53y5charfxupa5czjalea
- Signing PubKey: gpub1pggj7ard9eg82cjtv4u52epjx56nzwgjyg9zqn8u6cc4dgrzu9u8hztvlmqrvqt7mzju577xjdxjqxf8m5gjypaz798f5d
- Server Type: cloud
`;
    expect(parseValoper("g1qynsu9dwj9lq0m5fkje7jh6qy3md80ztqnshhm", md)).toEqual({
      operator: "g1qynsu9dwj9lq0m5fkje7jh6qy3md80ztqnshhm",
      moniker: "berty-validator-1",
      description: "mainnet founding validator (berty-validator-1)",
      signing: "g1l983yy3kpmapyzcfy53y5charfxupa5czjalea",
      serverType: "cloud",
    });
  });

  it("parses users realm entries", () => {
    expect(
      parseUserData(`(&(struct{("g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m" .uverse.address),("aeddi" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)`),
    ).toEqual({ address: "g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m", name: "aeddi", deleted: false });
    expect(parseUserData("(nil *gno.land/r/sys/users.UserData)")).toBeNull();
  });

  it("parses GovDAO list, proposal and votes pages", () => {
    const list = `## Proposals
### [Prop #14 - Add valoper lurien to the valset](/r/gov/dao:14)
Author: [@aeddi](/u/aeddi)

Status: ACTIVE

Tiers eligible to vote: T1, T2, T3

---

### [Prop #12 - Add valoper Mithrandir to the valset](/r/gov/dao:12)
Author: g1ecsuj0q572jr0dhu29q9njtnmw03hyu7tyyvv6

Status: ACCEPTED

Tiers eligible to vote: T1, T2, T3

---

**1** | [2](?page=2) | [3](?page=3)`;
    const { proposals, pages } = parseProposalList(list);
    expect(pages).toBe(3);
    expect(proposals).toEqual([
      { id: 14, title: "Add valoper lurien to the valset", author: "@aeddi", status: "ACTIVE", tiers: "T1, T2, T3" },
      { id: 12, title: "Add valoper Mithrandir to the valset", author: "g1ecsuj0q572jr0dhu29q9njtnmw03hyu7tyyvv6", status: "ACCEPTED", tiers: "T1, T2, T3" },
    ]);

    const detail = parseProposal(`## Prop #14 - Add valoper lurien to the valset
Author: [@aeddi](/u/aeddi)

Add operator g1rppw28c4u4h2pmf46q3956uv44zjwapelctsac (lurien) to the active valset.

Executor created in: \`gno.land/r/sys/validators/v0\`

---

### Stats
- YES PERCENT: 33.33333333333333%
- NO PERCENT: 0%
- ABSTAIN PERCENT: 0%`);
    expect(detail).toMatchObject({ author: "@aeddi", executor: "gno.land/r/sys/validators/v0", yesPct: 33.33333333333333, noPct: 0, abstainPct: 0 });
    expect(detail.body).toBe("Add operator g1rppw28c4u4h2pmf46q3956uv44zjwapelctsac (lurien) to the active valset.");

    const votes = parseVotes(`# Proposal #14 - Vote List

YES from T1 (VPPM 3):

- [@aeddi](/u/aeddi)
- g1ecsuj0q572jr0dhu29q9njtnmw03hyu7tyyvv6

NO from T1 (VPPM 3):

`);
    expect(votes).toEqual({ YES: { T1: ["@aeddi", "g1ecsuj0q572jr0dhu29q9njtnmw03hyu7tyyvv6"] }, NO: { T1: [] } });
  });

  it("parses the GRC20 registry and qeval values", () => {
    const md = `- **Bubble Rumble BUBBLE \\(wrapped\\)** - [gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/wbubble](/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/wbubble).BUBBLE - [info](/r/nt/grc20reg/v0:gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/wbubble.BUBBLE)`;
    expect(parseTokenRegistry(md)).toEqual([
      {
        key: "gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/wbubble.BUBBLE",
        realm: "gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/wbubble",
        symbol: "BUBBLE",
        name: "Bubble Rumble BUBBLE (wrapped)",
      },
    ]);
    expect(evalValue("(6 int)")).toBe("6");
    expect(evalValue("(1000000000000 int64)")).toBe("1000000000000");
    expect(evalValue('("Perun" string)')).toBe("Perun");
  });
});

describe("scripts", () => {
  it("finds a MsgRun script's gno.land imports", () => {
    const body = `package main

import (
	"gno.land/r/gov/dao"
	valset "gno.land/r/sys/validators/v0"
	"strings"
)
import "gno.land/p/nt/ufmt/v0"
`;
    expect(importsOf(body)).toEqual(["gno.land/r/gov/dao", "gno.land/r/sys/validators/v0", "gno.land/p/nt/ufmt/v0"]);
  });
});
