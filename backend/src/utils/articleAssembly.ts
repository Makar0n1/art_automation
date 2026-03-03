/**
 * Shared article assembly utilities
 * Used by both the generation queue and the edit controllers
 */

export interface AssemblyBlock {
  id: number;
  type: string;
  heading: string;
  content?: string;
}

/**
 * Remove AI-duplicated headings from block content.
 * AI sometimes repeats the heading inside the content — strip it.
 */
export function stripLeadingHeading(content: string, blockHeading?: string): string {
  let cleaned = content.replace(/^#{1,6}\s+[^\n]+\n+/, '').trim();

  if (blockHeading && blockHeading.trim()) {
    const headingText = blockHeading.trim();
    const firstLine = cleaned.split('\n')[0].trim();
    if (firstLine === headingText) {
      cleaned = cleaned.substring(cleaned.indexOf('\n') + 1).trim();
    }
  }

  return cleaned;
}

/**
 * Assemble a full markdown article from blocks.
 * h1 → #, intro → no heading, h2/conclusion → ##, h3 → ###, faq → ##
 */
export function assembleArticleFromBlocks(blocks: AssemblyBlock[]): string {
  let article = '';
  for (const block of blocks) {
    const cleanContent = stripLeadingHeading(block.content || '', block.heading);
    if (block.type === 'h1') {
      article += `# ${cleanContent}\n\n`;
    } else if (block.type === 'intro') {
      article += `${cleanContent}\n\n`;
    } else if (block.type === 'h2' || block.type === 'conclusion') {
      article += `## ${block.heading}\n\n${cleanContent}\n\n`;
    } else if (block.type === 'h3') {
      article += `### ${block.heading}\n\n${cleanContent}\n\n`;
    } else if (block.type === 'faq') {
      article += `## ${block.heading}\n\n${cleanContent}\n\n`;
    }
  }
  return article.trim();
}
