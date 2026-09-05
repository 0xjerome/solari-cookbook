import { BrowserSession, type Solari } from "@solarisdk/browser";
import { chromium } from "patchright-core";
import { bounded } from "./policy.js";

// launch() in SDK 0.1.3 does not set a connection timeout. Own the session ID
// before connecting so a failed/hung connection can still be released.
export async function openSession(
  client: Solari,
  signal: AbortSignal,
): Promise<BrowserSession> {
  const creation = client.sessions.create({ stealth: false, recording: false });
  void creation
    .then(async (session) => {
      if (signal.aborted) await client.sessions.releaseAndWait(session.id);
    })
    .catch(() => {});
  const session = await bounded(creation, signal);
  try {
    const connection = chromium.connect(session.wsEndpoint, { timeout: 15000 });
    void connection
      .then(async (browser) => {
        if (signal.aborted) await browser.close();
      })
      .catch(() => {});
    const browser = await bounded(connection, signal);
    return new BrowserSession(client, session, browser);
  } catch (error) {
    await bounded(
      client.sessions.releaseAndWait(session.id),
      AbortSignal.timeout(12000),
    ).catch(() => {});
    throw error;
  }
}
