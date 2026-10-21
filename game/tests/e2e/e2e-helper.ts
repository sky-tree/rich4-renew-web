import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PageDiagnostics {
  consoleLogs: string[];
  networkErrors: { url: string; status: number; statusText: string }[];
  uncaughtErrors: string[];
}

/**
 * Attaches diagnostics collectors to the Playwright page.
 * Sanitizes any potential TURN credentials, tokens or passwords from logs.
 */
export function setupDiagnostics(page: Page): PageDiagnostics {
  const diag: PageDiagnostics = {
    consoleLogs: [],
    networkErrors: [],
    uncaughtErrors: [],
  };

  const sanitize = (text: string) => {
    return text
      .replace(/credential=([^&\s]+)/gi, 'credential=[REDACTED]')
      .replace(/token=([^&\s]+)/gi, 'token=[REDACTED]')
      .replace(/password=([^&\s]+)/gi, 'password=[REDACTED]')
      .replace(/turn:[^@]+@/gi, 'turn:[REDACTED]@');
  };

  page.on('console', msg => {
    diag.consoleLogs.push(`[${msg.type()}] ${sanitize(msg.text())}`);
  });

  page.on('pageerror', err => {
    diag.uncaughtErrors.push(sanitize(err.stack || err.message));
  });

  page.on('response', resp => {
    if (resp.status() >= 400) {
      diag.networkErrors.push({
        url: sanitize(resp.url()),
        status: resp.status(),
        statusText: resp.statusText(),
      });
    }
  });

  return diag;
}

/**
 * Asserts that the page loaded cleanly without any fatal boot error screen (#boot-err)
 * and without unhandled script exceptions.
 */
export async function assertCleanBoot(page: Page, diag: PageDiagnostics) {
  // Check boot-err element
  const bootErr = page.locator('#boot-err');
  const hasBootErr = await bootErr.count();
  if (hasBootErr > 0) {
    const text = await bootErr.textContent();
    throw new Error(`Fatal #boot-err screen displayed: ${text}`);
  }

  // Check uncaught errors
  expect(diag.uncaughtErrors, `Uncaught page errors detected: ${diag.uncaughtErrors.join('\n')}`).toEqual([]);
}

/**
 * Dumps sanitized diagnostic evidence to test-results if a test fails.
 */
export function saveFailureEvidence(testInfo: TestInfo, diag: PageDiagnostics) {
  if (testInfo.status !== testInfo.expectedStatus) {
    const outDir = join(testInfo.outputDir, 'evidence');
    mkdirSync(outDir, { recursive: true });

    writeFileSync(
      join(outDir, 'console.log'),
      diag.consoleLogs.join('\n'),
      'utf8',
    );

    writeFileSync(
      join(outDir, 'network-errors.json'),
      JSON.stringify(diag.networkErrors, null, 2),
      'utf8',
    );

    writeFileSync(
      join(outDir, 'uncaught-errors.json'),
      JSON.stringify(diag.uncaughtErrors, null, 2),
      'utf8',
    );
  }
}
