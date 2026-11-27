import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Serves the built React SPA from the API process (dev-only ALB hosting, when CloudFront is not available).
 * Mirrors the CloudFront setup: real files are served as-is, extension-less paths get index.html,
 * and /api/* is never touched.
 */
export function serveSpa(app: NestExpressApplication, webDir: string): void {
  const root = path.resolve(webDir);
  const indexHtml = path.join(root, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(`SERVE_WEB_DIR is set but ${indexHtml} does not exist`);
  }

  app.useStaticAssets(root, {
    index: false,
    setHeaders: (res: Response, filePath: string) => {
      // Vite fingerprints everything under assets/, so it can be cached forever; index.html must not be.
      const immutable = filePath.startsWith(path.join(root, 'assets') + path.sep);
      res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const isPageRequest = (req.method === 'GET' || req.method === 'HEAD') && !req.path.includes('.');
    if (!isPageRequest || req.path === '/api' || req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}
