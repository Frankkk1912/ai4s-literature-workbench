import { afterEach, describe, expect, it } from 'vitest';
import { createPdfjsLoader, loadPdfjs } from '../../src/lib/pdfjs-loader.js';

afterEach(() => {
  delete (globalThis as any).pdfjsWorker;
});

describe('loadPdfjs', () => {
  it('registers the worker so a bundle does not need to find it by path', async () => {
    delete (globalThis as any).pdfjsWorker;
    const loader = createPdfjsLoader({
      main: () => import('pdfjs-dist/legacy/build/pdf.mjs' as any),
      worker: () => import('pdfjs-dist/legacy/build/pdf.worker.mjs' as any),
    });
    const pdfjs = await loader();
    expect(typeof pdfjs.getDocument).toBe('function');
    expect((globalThis as any).pdfjsWorker?.WorkerMessageHandler).toBeDefined();
  });

  it('shares one load between callers', () => {
    expect(loadPdfjs()).toBe(loadPdfjs());
  });

  it('does not cache a failed load', async () => {
    let attempts = 0;
    const loader = createPdfjsLoader({
      main: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('first import fails');
        return { getDocument: () => undefined };
      },
      worker: async () => ({ WorkerMessageHandler: {} }),
    });
    await expect(loader()).rejects.toThrow('first import fails');
    await expect(loader()).resolves.toHaveProperty('getDocument');
  });

  it('still returns pdfjs when only the worker import fails', async () => {
    const loader = createPdfjsLoader({
      main: async () => ({ getDocument: () => undefined }),
      worker: async () => {
        throw new Error('no worker here');
      },
    });
    await expect(loader()).resolves.toHaveProperty('getDocument');
    expect((globalThis as any).pdfjsWorker).toBeUndefined();
  });
});
