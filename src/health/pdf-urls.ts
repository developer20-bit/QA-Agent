import { createRequire } from "node:module";
import { parseUrlsFromText } from "./load-urls.js";

const require = createRequire(import.meta.url);

/** Extract text from a PDF buffer and parse URLs the same way as .txt uploads. */
export async function extractUrlsFromPdfBuffer(buffer: Buffer): Promise<string[]> {
  const pdfParse = require("pdf-parse") as (b: Buffer) => Promise<{ text: string }>;
  const data = await pdfParse(buffer);
  return parseUrlsFromText(data.text ?? "");
}
