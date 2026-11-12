# Transcribe rows for the 2D6 Companion

You are helping the owner of a PDF read cells of its tables exactly, so an app can verify them against hashes.
You have the PDF, `book-todo.json` and `crop.mjs`. Write `book-pack.json`. Do not add anything from memory or
from the internet: the text must be what is printed in this PDF.

## The to-do file

`book-todo.json` is `{ book, edition, items }`. Each item is one field to read:

- `id`: copy it into the pack unchanged.
- `page`: 1-based page number in the PDF.
- `box`: `[x0, y0, x1, y1]`, fractions (0 to 1) of the page, origin top left, on the page as drawn with `rotate`
  extra degrees clockwise. `null` when the location is unknown: find the cell on the page by context.
- `rotate`: degrees to pass to `crop.mjs` (0, 90, 180 or 270).
- `kind`: `text`, `ocr` or `dice` (a dice cell holds die pictures, not digits).
- `columns`: for a table cell or a column header, `{ count, index }`, the number of columns and this cell's
  0-based column. The id's last number is the same column, and the one before it is the row (-1 is the header).
- `dice`: the table's dice spec, such as `2D6`, when it has one.

An id looks like `<section>#<field>:<block>:<row>:<col>`. The field is one of `cell`, `col` (column header),
`title`, `intro`, `notes`, `para` or `heading`.

## Looking at a cell

Render the cell, then Read the PNG it prints:

    node crop.mjs <pdf> <page> <x0> <y0> <x1> <y1> 4 <rotate>

The full-page view is shrunk, so small print and dice pips are NOT reliable at page size. Always crop.
- For a cell, crop its box. The crop includes a little of its surroundings.
- For **dice columns**, crop only the dice column, about 10 to 12 rows at a time, at scale 6. Count pips one die
  at a time. Never guess a pip count from a wide crop.
- When `box` is null, crop the table region you found, read the row and column by position, and use the
  neighbouring cells to line the row up.

## Rules

- **Copy the text exactly** as printed: British spelling, the capitals as printed, punctuation. Do not
  summarise, correct, translate or skip anything. A wrong character fails the check.
- Join lines that wrap inside a cell with a single space. Do not add line breaks.
- **Dice pictures** are written as the pip count in square brackets, one per die: one die showing 4 is `[4]`;
  two dice showing 5 and 4 are `[5][4]`; groups joined by a printed plus sign are `[5][4]+[1]`.
- Other symbols or icons, such as a small drawn symbol in a cell, are written in braces: `{icon}`.
- Subscript units are written inline, with no space: `9gc`.
- Spanning or merged cells: repeat the printed value in each cell the item names.
- Running page numbers and decorative borders are not part of any cell.
- Do not invent a value for a cell you cannot read. Leave that item out of the pack and list it in your reply.

## Output: `book-pack.json`

    {
      "book": "<same as the to-do file>",
      "edition": "<same as the to-do file>",
      "items": [
        { "id": "<id from the to-do file>", "text": "<the cell text>" }
      ]
    }

- Valid UTF-8 JSON. Inside a string, write a double quote as `\"`.
- Exactly these keys and no others. `text` is at most 2000 characters.
- One entry per item you read, in the order of the to-do file. Write the file in batches if it is long,
  and keep what you have written, since the list can run to hundreds of items.

Neutral examples of the text format (invented, not from the book): a roll cell `7`, a dice cell `[3][6]`,
a result cell `Gain 5gc and a {icon} token`.

When you finish, say how many items you wrote and list any ids you skipped and why.
