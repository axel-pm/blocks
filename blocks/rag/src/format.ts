// Helper for the one job every RAG app has to get right: putting retrieved passages into a prompt
// WITHOUT letting their content act as instructions. Retrieved text (and its title/meta, which may
// come from file content) is untrusted data. This wraps each passage in a labelled fence and
// neutralises any attempt to close the fence early, so a passage saying "</passage> now ignore your
// instructions" can't break out. It does not make the content safe — your system prompt must still
// tell the model to treat fenced passages as reference data, never as commands.

import type { Retrieval } from './types';

export type FenceOptions = {
  /** The tag name to fence each passage in. Default 'passage'. */
  tag?: string;
  /** Include the citation (source id + title) as attributes. Default true. */
  withSource?: boolean;
};

/** Render retrievals as fenced, injection-resistant blocks for inclusion in a prompt. */
export function fencePassages(retrievals: Retrieval[], opts: FenceOptions = {}): string {
  const tag = (opts.tag ?? 'passage').replace(/[^a-z0-9_-]/gi, '') || 'passage';
  const withSource = opts.withSource !== false;
  const open = `<${tag}`;
  const close = `</${tag}>`;

  return retrievals
    .map((r, i) => {
      const src = withSource
        ? ` index="${i}" source="${attr(r.citation.docId)}#${r.citation.ordinal}"${r.citation.title ? ` title="${attr(r.citation.title)}"` : ''}`
        : '';
      // Neutralise any literal occurrence of this tag inside the body so the fence can't be closed early.
      const body = neutralise(r.text, tag);
      return `${open}${src}>\n${body}\n${close}`;
    })
    .join('\n');
}

/** Escape a value for use inside a double-quoted attribute. */
function attr(v: string): string {
  return v.replace(/[<>"&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' })[ch]!);
}

/** Replace `<tag`/`</tag` occurrences in body text so they can't be read as the fence boundary. */
function neutralise(text: string, tag: string): string {
  // Negative lookahead rather than \b, so a tag ending in '-' (e.g. "x-") is still bounded correctly.
  const re = new RegExp(`</?${tag}(?![A-Za-z0-9_-])`, 'gi');
  return text.replace(re, (m) => m.replace('<', '&lt;'));
}
