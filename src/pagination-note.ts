/**
 * The pagination capability and note for one endpoint record. Kept free of
 * imports, @urbankitstudio/atlas included, because the monorepo's root test
 * (cli-search-note-parity.test.ts) imports it, and the root CI job never
 * installs this package's dependencies.
 *
 * @urbankitstudio/atlas publishes `supportsPagination` and `maxRecordCount` on
 * EndpointRecord from 0.6.30, the floor of this CLI's range (^0.6.30); both keys
 * are optional, and a record without them pages. Same rule as the package's
 * offersPagination: only the literal false says no.
 */
export type PaginationKeys = { supportsPagination?: boolean | null; maxRecordCount?: number | null };

export function offersPagination(ep: PaginationKeys): boolean {
  return ep.supportsPagination !== false;
}
export function maxRecordCount(ep: PaginationKeys): number | null {
  const n = ep.maxRecordCount;
  return typeof n === "number" ? n : null;
}

/**
 * The sentences a layer flagged supportsPagination:false adds after whichever
 * search note applies. Word for word the hosted paginationTail in
 * api/_lib/search-capability.ts (cli-search-note-parity.test.ts in the monorepo
 * holds them equal); every clause was measured on the Mississippi statewide
 * layers on 2026-10-12/13.
 */
export function paginationTail(ep: PaginationKeys): string {
  if (offersPagination(ep)) return "";
  const cap = maxRecordCount(ep);
  const capText = cap !== null ? cap.toLocaleString("en-US") : "its declared maximum of";
  return (
    " This layer refuses resultRecordCount and resultOffset (no pagination): send one request without them." +
    ` It returns at most ${capText} rows and sets exceededTransferLimit when more match, so narrow the where clause or the geometry instead of paging.` +
    " Queries other than by FID (the object id) scan the whole layer (1.5 to 20 s); returnDistinctValues and orderByFields are silently ignored, and outStatistics fails."
  );
}
