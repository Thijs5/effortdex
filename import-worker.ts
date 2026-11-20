import { decodeTransferPayload } from './lib/transfer.ts';
import { previewRosterImport } from './lib/store.ts';
import type { ExportedParty } from './lib/store.ts';

export type ImportRequest =
  | { type: 'preview'; source: File | string; locals: Parameters<typeof previewRosterImport>[1] }
  | { type: 'apply'; selected: string[] };

export type ImportResponse =
  | { type: 'preview'; parties: ReturnType<typeof previewRosterImport> }
  | { type: 'apply'; parties: ExportedParty[]; selected: string[] }
  | { type: 'error' };

let imported: ExportedParty[] = [];

self.addEventListener('message', async (event: MessageEvent<ImportRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'preview') {
      const payload = typeof request.source === 'string' ? request.source : (await request.source.text()).trim();
      imported = await decodeTransferPayload(payload);
      const parties = previewRosterImport(imported, request.locals);
      self.postMessage({ type: 'preview', parties } satisfies ImportResponse);
    } else {
      const selected = new Set(request.selected);
      const parties = imported.flatMap(party => {
        const pokemon = party.pokemon.filter(entry => selected.has(entry.uid));
        return pokemon.length ? [{ ...party, pokemon }] : [];
      });
      self.postMessage({ type: 'apply', parties, selected: request.selected } satisfies ImportResponse);
    }
  } catch {
    self.postMessage({ type: 'error' } satisfies ImportResponse);
  }
});
