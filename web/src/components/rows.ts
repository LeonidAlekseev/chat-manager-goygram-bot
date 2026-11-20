// #112: one <table> markup — a card per row on a phone, table columns from md up (the /v2 journal)
export const rows = {
  table: "block w-full text-sm md:table",
  head: "hidden text-left text-xs text-muted-foreground md:table-header-group",
  th: "border-b py-2 pe-4 font-bold",
  body: "block md:table-row-group",
  // phone: when | status on the first line, the rest stacked under it
  tr: "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b py-3 last:border-0 md:table-row md:align-top",
  td: "col-start-1 min-w-0 break-words md:table-cell md:py-3 md:pe-4",
  when: "col-start-1 font-mono text-xs text-muted-foreground tabular-nums md:table-cell md:py-3 md:pe-4 md:text-sm md:whitespace-nowrap",
  status: "col-start-2 row-start-1 md:table-cell md:py-3 md:pe-4",
}
