import type { Components } from "react-markdown";

// Markdown tables are the #1 mobile breakage: rendered full-width they squish
// every column to one word per line, and without a scroll container they force
// the whole page to pan. Wrapping each table in .md-table-wrap (globals.css)
// keeps columns at a readable width and scopes the horizontal scroll to the
// table itself. Shared by every ReactMarkdown call site.
export const mdComponents: Components = {
  table: ({ node: _node, ...props }) => (
    <div className="md-table-wrap">
      <table {...props} />
    </div>
  ),
};
