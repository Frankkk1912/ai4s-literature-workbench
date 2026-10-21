import { z } from 'zod';
import type { ToolDefinition } from '../registry/registry.js';
import { ok } from '../registry/registry.js';
import { startSetupSession } from '../lib/setup-session.js';

const open_setup: ToolDefinition = {
  name: 'open_setup',
  title: 'Open the key-entry page',
  description:
    'Open the local setup page in the user\'s default browser so they can paste an optional key into a masked form. The page opens already signed in, offers one key at a time with a reason and a link to get it, and can be skipped. Pass `keys` with only the keys that unlock something the user asked for (zotero, pubmed, easyscholar). Tell the user in plain words that a page has opened and what to do there. Never ask the user for a key in chat and never pass one to this tool; this tool does not accept or return keys. If `opened` is false the browser could not be launched: give the user `url` and the `fallback_code` to type into it, or point them to the double-click setup file named in INSTALL.md. Call setup_status afterwards to check the result; a Zotero key needs the app restarted before it takes effect.',
  inputSchema: {
    keys: z
      .array(z.enum(['zotero', 'pubmed', 'easyscholar']))
      .optional()
      .describe('Which keys to offer, in order. Omit for all three.'),
    language: z.enum(['zh', 'en']).optional().describe('Language the page opens in. Defaults to Chinese.'),
  },
  annotations: { readOnlyHint: false, openWorldHint: false },
  handler: async (args: { keys?: Array<'zotero' | 'pubmed' | 'easyscholar'>; language?: 'zh' | 'en' }) => {
    const session = await startSetupSession({ keys: args.keys, uiLanguage: args.language });
    const minutes = Math.round((session.expiresAt - Date.now()) / 60_000);
    const zh = args.language !== 'en';
    const message = session.opened
      ? zh
        ? '我已在你的浏览器里打开了设置页，请在页面里粘贴密钥。密钥不会出现在聊天里。'
        : 'I opened the setup page in your browser. Paste the key there; it never appears in this chat.'
      : zh
        ? `没能自动打开浏览器。请在浏览器里打开 ${session.pageUrl} ，并输入配对码。配对码约 ${minutes} 分钟内有效。`
        : `I could not open your browser. Open ${session.pageUrl} yourself and type in the code. The code is valid for about ${minutes} minutes.`;
    // The code travels in the result only when the browser could not be opened: then it is the
    // only way into the page. When the browser opened, the page already holds it.
    return ok(
      {
        opened: session.opened,
        url: session.pageUrl,
        keys: session.keys,
        expires_in_minutes: minutes,
        ...(session.opened ? {} : { fallback_code: session.code }),
        message,
      },
      message,
    );
  },
};

export default open_setup;
