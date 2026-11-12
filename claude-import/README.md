# Check unverified rows with Claude Code

The 2D6 Companion ships no book text. When you unlock a book from your own PDF, the app reads each table cell
with OCR and checks it against a hash. Cells it can't check stay "unverified". This folder lets your own
Claude Code read those cells from your PDF instead. The app then accepts only text whose hash matches.

Nothing leaves your device except what you choose to give Claude Code: your PDF and the to-do file.

## Steps

1. In the app, open Settings, then Books. Unlock the book from its PDF first (this puts its key on the device).
2. Choose **Export rows to check** for that book. Pick "Unverified" (just the cells OCR couldn't verify) or "All".
   Save `book-todo.json`. It holds cell locations only: page, box, kind, column and dice. It holds no text.
3. Put your PDF, `book-todo.json`, `PROMPT.md` and `crop.mjs` in one folder, and install the two helpers there:

       npm i pdfjs-dist @napi-rs/canvas

4. Start Claude Code in that folder and ask:

       Follow PROMPT.md. The PDF is <your-file>.pdf and the to-do list is book-todo.json.

   Claude looks at each cell with `crop.mjs` and writes `book-pack.json`.
5. In the app, choose **Import checked rows** and pick `book-pack.json`. Rows that match are marked verified.
   Rows that don't match are listed. **Keep anyway** stores a row as it is, still marked unverified.

## Files

- `book-todo.json`: `{ book, edition, items: [{ id, page, box, rotate, kind, columns, dice }] }`.
- `book-pack.json`: `{ book, edition, items: [{ id, text }] }`, one item per row you were asked about.
- `crop.mjs`: `node crop.mjs <pdf> <page> <x0> <y0> <x1> <y1> [scale=4] [rotate=0]` renders part of a page to a PNG
  and prints its path.

## Box convention

`box` is `[x0, y0, x1, y1]` as fractions from 0 to 1 of the page width and height, with the origin at the
top left. It is measured on the page as drawn with `rotate` extra degrees of clockwise rotation, added to the
page's own rotation. Some pages of some editions are stored sideways, so always pass `rotate` to `crop.mjs`
(it is 0 on most pages). `box: null` means the app couldn't locate the cell: read it from the page by context
(its row and column, from the neighbouring cells).
