// Edge collection helpers. Edges in flowgo are undirected — only one
// edge can connect any pair of boxes, regardless of which side claimed
// to be the "from" first. These functions return new arrays rather
// than mutating their input.

export interface EdgeLike {
  readonly from: string;
  readonly to: string;
  readonly fromHandle?: string | undefined;
  readonly toHandle?: string | undefined;
}

const samePair = (a: EdgeLike, b: EdgeLike): boolean =>
  (a.from === b.from && a.to === b.to) ||
  (a.from === b.to && a.to === b.from);

// Add `edge` to the collection, dropping any prior edge that already
// connected the same pair (in either direction). Pure: returns a new
// array; the input is unmodified.
export const addOrReplaceEdge = <E extends EdgeLike>(
  edges: readonly E[],
  edge: E,
): E[] => {
  const out = edges.filter((e) => !samePair(e, edge));
  out.push(edge);
  return out;
};

// Remove every edge whose `from` or `to` references one of the
// supplied ids. Used when a box (or set of boxes) is deleted.
export const dropEdgesReferencing = <E extends EdgeLike>(
  edges: readonly E[],
  removedIds: ReadonlySet<string>,
): E[] => edges.filter((e) => !removedIds.has(e.from) && !removedIds.has(e.to));
