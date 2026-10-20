/**
 * Loads pdfjs-dist once, for both the compiled `dist/` layout and a single-file bundle.
 *
 * pdfjs starts its parser "worker" by importing a file next to itself by relative path.
 * That file does not exist inside an esbuild bundle, so every parse would fail with a
 * generic error. pdfjs first checks `globalThis.pdfjsWorker`, so importing the worker
 * module here (which esbuild then includes) and registering it makes both layouts work.
 */
export interface PdfjsImporters {
  main: () => Promise<any>;
  worker: () => Promise<any>;
}

/** Builds a loader that caches its result. A failed load is not cached, so a later call retries. */
export function createPdfjsLoader(importers: PdfjsImporters): () => Promise<any> {
  let pending: Promise<any> | undefined;

  async function load(): Promise<any> {
    const pdfjs = await importers.main();
    if (!(globalThis as any).pdfjsWorker) {
      try {
        (globalThis as any).pdfjsWorker = await importers.worker();
      } catch (error) {
        // Not fatal when running from source, where pdfjs finds its worker by path.
        process.stderr.write(`pdfjs worker could not be registered: ${(error as Error).message}\n`);
      }
    }
    return pdfjs;
  }

  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

/** Resolves to the pdfjs module (legacy build, which runs under Node without a DOM). */
export const loadPdfjs = createPdfjsLoader({
  main: () => import('pdfjs-dist/legacy/build/pdf.mjs' as any),
  worker: () => import('pdfjs-dist/legacy/build/pdf.worker.mjs' as any),
});
