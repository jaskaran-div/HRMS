type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Supabase returns at most 1000 rows per request; this keeps asking until everything is loaded. */
export async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}
