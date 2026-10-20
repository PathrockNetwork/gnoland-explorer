import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  // Only used by `drizzle-kit push`. We apply migrations via src/migrate.ts.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://gnoland:gnoland@localhost:5432/gnoland_explorer",
  },
  verbose: true,
  strict: true,
});
