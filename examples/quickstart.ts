/**
 * Quickstart — run against a local stack (https://api.localhost) or your server.
 *
 *   npx tsx examples/quickstart.ts
 *
 * Set ONECODE_URL and ONECODE_ANON_KEY (from the dashboard → Admin → API keys).
 */
import { createClient } from "../src/index";

const url = process.env.ONECODE_URL ?? "https://api.localhost";
const anonKey = process.env.ONECODE_ANON_KEY ?? "";

const oc = createClient(url, anonKey);

async function main() {
  // 1. Read public data with just the anon key.
  const { data: todos, error } = await oc.from("todos").select("*").limit(5);
  if (error) throw error;
  console.log("todos:", todos);

  // 2. Sign in, then writes go out as the authenticated user automatically.
  const signin = await oc.auth.signInWithPassword({
    email: process.env.ONECODE_EMAIL ?? "you@example.com",
    password: process.env.ONECODE_PASSWORD ?? "",
  });
  if (signin.error) {
    console.warn("sign-in skipped:", signin.error.message);
    return;
  }
  console.log("signed in as:", signin.data.user.email);

  const inserted = await oc.from("todos").insert({ title: "from the SDK" }).select();
  console.log("inserted:", inserted.data);

  // 3. Realtime (requires the table to have realtime enabled in the dashboard).
  const channel = oc
    .channel("todos")
    .on("*", (msg) => console.log("change:", msg.type, msg.new ?? msg.old))
    .subscribe((status) => console.log("realtime:", status));

  // 4. Call an edge function.
  const fn = await oc.functions.invoke("hello", { body: { name: "world" } });
  console.log("function result:", fn.data);

  setTimeout(() => channel.unsubscribe(), 10_000);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
