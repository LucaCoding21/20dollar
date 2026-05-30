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
};
