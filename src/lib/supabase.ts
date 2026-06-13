import { createClient } from "@supabase/supabase-js";

// No auth: the public anon key is shipped to the browser and RLS allows
// anon read/insert on the `expenses` table. Both Luca and Irish share it.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonKey);

export type Person = "luca" | "irish";

export type Expense = {
  id: string;
  created_at: string;
  person: Person;
  amount: number; // dollars spent (positive shrinks the bank)
  note: string | null;
  category: string | null; // category slug, see CATEGORIES in BankApp
  gif_url: string | null; // optional GIPHY gif attached to the transaction
  from_reward: boolean; // paid from earned reward money, not the $20 bank
};

// A shared savings goal funded out of the bank balance. `saved` is the running
// total moved in from the bank; `target` is the price tag. `image_url` points
// at an uploaded photo in the public `goals` storage bucket.
export type Goal = {
  id: string;
  created_at: string;
  title: string;
  subtitle: string | null;
  target: number;
  saved: number;
  image_url: string | null;
  is_current: boolean; // the one featured at the top of the Goals screen
};

// A reward you only let yourself have once a task is done. `kind` is either a
// real-world "treat" (e.g. lashes) or "cash" (a dollar amount you've earned the
// right to spend). The reward unlocks in two steps: complete the task
// (`done_at` set) → claim the reward (`claimed_at` set).
export type Reward = {
  id: string;
  created_at: string;
  title: string; // the reward itself, e.g. "Lash extensions"
  task: string; // what must be completed to unlock it
  kind: "treat" | "cash";
  amount: number | null; // dollar value when kind === "cash"
  person: Person | null; // who it's for (optional)
  image_url: string | null; // optional photo, stored in the public `goals` bucket
  done_at: string | null; // when the task was marked complete
  claimed_at: string | null; // when the reward was redeemed
};
