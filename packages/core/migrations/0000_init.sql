CREATE TABLE "blocks" (
	"height" bigint PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"proposer" text NOT NULL,
	"tx_count" integer NOT NULL,
	"total_txs" bigint NOT NULL,
	"app_hash" text,
	"validators_hash" text,
	"signed" smallint,
	"missed" smallint
);
--> statement-breakpoint
CREATE TABLE "events" (
	"tx_hash" text NOT NULL,
	"idx" integer NOT NULL,
	"height" bigint NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"pkg_path" text,
	"type" text,
	"attrs" jsonb,
	"from" text,
	"to" text,
	"amount" numeric,
	"denom" text,
	"bytes_delta" bigint,
	CONSTRAINT "events_tx_hash_idx_pk" PRIMARY KEY("tx_hash","idx")
);
--> statement-breakpoint
CREATE TABLE "missed_signatures" (
	"height" bigint NOT NULL,
	"validator" text NOT NULL,
	CONSTRAINT "missed_signatures_height_validator_pk" PRIMARY KEY("height","validator")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"path" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"creator" text NOT NULL,
	"height" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"files" jsonb NOT NULL,
	"source_bytes" integer NOT NULL,
	"max_deposit" text,
	"status" text DEFAULT 'live' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"status" text NOT NULL,
	"tiers" text,
	"yes_pct" double precision,
	"no_pct" double precision,
	"abstain_pct" double precision,
	"executor" text,
	"body" text,
	"votes" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"chain_id" text NOT NULL,
	"head_height" bigint,
	"chain_height" bigint,
	"indexer_height" bigint,
	"signature_floor" bigint,
	"active_rpc" text,
	"validators_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_transfers" (
	"tx_hash" text NOT NULL,
	"idx" integer NOT NULL,
	"height" bigint NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"standard" text NOT NULL,
	"from" text,
	"to" text,
	"value" text NOT NULL,
	CONSTRAINT "token_transfers_tx_hash_idx_pk" PRIMARY KEY("tx_hash","idx")
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"key" text PRIMARY KEY NOT NULL,
	"realm" text NOT NULL,
	"symbol" text NOT NULL,
	"standard" text NOT NULL,
	"registered" boolean DEFAULT false NOT NULL,
	"name" text,
	"decimals" smallint,
	"total_supply" numeric,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"hash" text PRIMARY KEY NOT NULL,
	"height" bigint NOT NULL,
	"tx_index" integer NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"success" boolean NOT NULL,
	"signer" text,
	"gas_wanted" bigint NOT NULL,
	"gas_used" bigint NOT NULL,
	"fee" numeric NOT NULL,
	"fee_denom" text,
	"memo" text,
	"kinds" text[] NOT NULL,
	"addresses" text[] NOT NULL,
	"pkg_paths" text[] NOT NULL,
	"funcs" text[] NOT NULL,
	"messages" jsonb NOT NULL,
	"error" text,
	"log" text,
	"storage_delta" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usernames" (
	"address" text PRIMARY KEY NOT NULL,
	"name" text,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validator_sets" (
	"hash" text PRIMARY KEY NOT NULL,
	"height" bigint NOT NULL,
	"members" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validators" (
	"address" text PRIMARY KEY NOT NULL,
	"pub_key" text,
	"voting_power" bigint DEFAULT 0 NOT NULL,
	"in_set" boolean DEFAULT false NOT NULL,
	"moniker" text,
	"description" text,
	"server_type" text,
	"operator" text,
	"first_seen_height" bigint,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "blocks_time_idx" ON "blocks" USING btree ("time");--> statement-breakpoint
CREATE INDEX "blocks_hash_idx" ON "blocks" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "blocks_proposer_idx" ON "blocks" USING btree ("proposer","height");--> statement-breakpoint
CREATE INDEX "blocks_unsigned_idx" ON "blocks" USING btree ("height") WHERE "blocks"."signed" is null;--> statement-breakpoint
CREATE INDEX "events_pkg_idx" ON "events" USING btree ("pkg_path","height");--> statement-breakpoint
CREATE INDEX "events_kind_idx" ON "events" USING btree ("kind","height");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type","height");--> statement-breakpoint
CREATE INDEX "missed_validator_idx" ON "missed_signatures" USING btree ("validator","height");--> statement-breakpoint
CREATE INDEX "packages_creator_idx" ON "packages" USING btree ("creator");--> statement-breakpoint
CREATE INDEX "packages_height_idx" ON "packages" USING btree ("height");--> statement-breakpoint
CREATE INDEX "token_transfers_token_idx" ON "token_transfers" USING btree ("token","height");--> statement-breakpoint
CREATE INDEX "token_transfers_from_idx" ON "token_transfers" USING btree ("from","height");--> statement-breakpoint
CREATE INDEX "token_transfers_to_idx" ON "token_transfers" USING btree ("to","height");--> statement-breakpoint
CREATE INDEX "txs_height_idx" ON "transactions" USING btree ("height","tx_index");--> statement-breakpoint
CREATE INDEX "txs_signer_idx" ON "transactions" USING btree ("signer","height");--> statement-breakpoint
CREATE INDEX "txs_addresses_idx" ON "transactions" USING gin ("addresses");--> statement-breakpoint
CREATE INDEX "txs_pkg_paths_idx" ON "transactions" USING gin ("pkg_paths");--> statement-breakpoint
CREATE INDEX "txs_kinds_idx" ON "transactions" USING gin ("kinds");--> statement-breakpoint
CREATE INDEX "txs_time_idx" ON "transactions" USING btree ("time");--> statement-breakpoint
CREATE INDEX "usernames_name_idx" ON "usernames" USING btree ("name");