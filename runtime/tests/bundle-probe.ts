// Not a vitest file. scripts/verify-bundles.mjs bundles this with the shipped bundle
// options and runs it from a folder with no node_modules, to prove exact-page PDF
// extraction works from a single-file bundle. extractPdfPages swallows every error and
// returns null, so a broken pdfjs worker would otherwise go unnoticed.
import { extractPdfPages } from '../src/features/fulltext/pdf-pages.js';

const PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 41 >> stream
BT /F1 24 Tf 20 100 Td (Hello PDF) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`;

const pages = await extractPdfPages(new TextEncoder().encode(PDF));
process.stdout.write(`PROBE_RESULT ${JSON.stringify({ pageCount: pages?.length ?? null, text: pages?.join(' ') ?? null })}\n`);
