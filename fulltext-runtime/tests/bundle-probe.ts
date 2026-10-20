// Not a vitest file. scripts/verify-bundles.mjs bundles this with the shipped bundle
// options and runs it from a folder with no node_modules, to prove the PDF parser works
// from a single-file bundle (pdfjs finds its worker by relative path unless registered).
import { verifyPdf } from '../src/verification.js';

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

const result = await verifyPdf(new TextEncoder().encode(PDF), { doi: '10.1000/example', title: 'Hello PDF' });
process.stdout.write(`PROBE_RESULT ${JSON.stringify({ pageCount: result.pageCount, titleMatch: result.titleMatch })}\n`);
