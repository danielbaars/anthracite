import {
  footerTitle,
  footerFooter,
  legacyFooterFooter,
} from '../create_pr_body_footer';

export function updatePrBodyFooter(
  body: string | undefined,
  footer: string
): string {
  if (!body) {
    return footer;
  }

  // Get the core title and footer text without extra whitespace
  const titleText = footerTitle.trim().replace(/^\s*\n+|\n+\s*$/g, '');

  const escapedTitleText = titleText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedFooterText = [footerFooter, legacyFooterFooter]
    .map((text) => text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  // Strip every existing footer block (and the blank lines before it), wherever
  // it sits in the body — not just at the very end. Anchoring to end-of-body
  // meant that if a bot appended content after the footer, we couldn't find the
  // old footer and appended a second one (duplicate). Removing all of them and
  // re-appending a single footer keeps exactly one, and preserves any other
  // content (e.g. bot sections) that followed it.
  const footerBlock = new RegExp(
    `\\s*${escapedTitleText}[\\s\\S]*?(?:${escapedFooterText})`,
    'g'
  );

  return body.replace(footerBlock, '').trimEnd() + footer;
}
