import * as http from 'http';
import * as https from 'https';
import { env } from '@config/env';

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * GET with the request path sent EXACTLY as given.
 *
 * Browsers and Playwright's APIRequestContext normalise the URL first
 * ("/frontend/../../etc/passwd" becomes "/etc/passwd", "%2e%2e" is treated as
 * "..") so they can never send a real path-traversal attempt. Node's http
 * module does not touch the path, which is what security cases such as
 * TC-FEH-04-06 need.
 */
export function rawGet(pathAndQuery: string): Promise<RawResponse> {
  const target = new URL(env.baseURL);
  const client = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(
      {
        hostname: target.hostname,
        port: target.port || undefined,
        path: pathAndQuery,
        headers: { host: target.host },
        timeout: 15_000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
      },
    );
    request.on('timeout', () => request.destroy(new Error(`Timed out: GET ${pathAndQuery}`)));
    request.on('error', reject);
  });
}
