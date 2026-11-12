export interface Table {
  title: string | null;
  code?: string | null;
  intro?: string | null;
  dice: string | null;
  columns: string[];
  rows: string[][];
  notes?: string | null;
  continued?: boolean;
  blank_rows?: number;
}

export type Block =
  | { type: "para"; text: string; page: number }
  | { type: "heading"; level: number; text: string; page: number }
  | { type: "table"; table: Table; page: number }
  | { type: "image"; src: string; page: number };

export interface Section {
  id: string;
  book: string;
  title: string;
  level: number;
  chapter: string | null;
  pages: number[];
  blocks: Block[];
}

export interface Book {
  slug: string;
  title: string;
  missing_pages: number[];
  page_images: number[];
}

export interface Library {
  books: Book[];
  sections: Section[];
}
